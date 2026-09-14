import { useEffect, useState, type CSSProperties } from 'react'
import { api } from './api'
import type { Explanation, Related, Word } from './types'
import { DefinitionSource } from './WordCard'
import { readableText } from './discovery-data'
import './comparison.css'

interface Comparison { words: Word[]; errors: { word_id: string; message: string }[] }

/** Compare canonical headwords supplied by the shared dock (REQ-UX-024). The set being
    compared is edited on the dock, beside the mode switch — this panel is the result. */
export default function ComparisonWorkspace({ seed = [], onExplore }: { seed?: string[]; onExplore: (term: string) => void }) {
  const seedKey = JSON.stringify(seed.map(term => term.trim()).filter(Boolean))
  const terms: string[] = JSON.parse(seedKey)
  const [result, setResult] = useState<Comparison | null>(null)
  const [related, setRelated] = useState<Record<string, Related | null>>({})
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  /** Cancel dictionary, relation and AI work together when chips change or unmount. */
  useEffect(() => {
    const controller = new AbortController()
    const word_ids: string[] = JSON.parse(seedKey)
    setBusy(false); setError(''); setResult(null); setRelated({}); setExplanation(null); setAiBusy(false)
    if (!word_ids.length) return
    if (new Set(word_ids).size !== word_ids.length) { setError('Choose different words to compare.'); return }
    /** Match the existing API's code-point bounds; it has no fixed column cap. */
    if (word_ids.some(term => Array.from(term).length > 512) || word_ids.reduce((sum, term) => sum + Array.from(term).length, 0) > 4096) {
      setError('Comparison allows 512 characters per word and 4096 characters in total.'); return
    }
    /** Related data is optional and settles per word without delaying dictionary evidence. */
    async function loadRelated(word: Word) {
      try {
        const map = await api<Related>(`/words/${encodeURIComponent(word.word_id)}/related`, undefined, controller.signal)
        if (!controller.signal.aborted) setRelated(previous => ({ ...previous, [word.word_id]: map }))
      } catch {
        if (!controller.signal.aborted) setRelated(previous => ({ ...previous, [word.word_id]: null }))
      }
    }
    /** Show one word via lookup; only request grounded comparison for two or more complete words. */
    async function compare() {
      setBusy(true)
      try {
        const data = word_ids.length === 1
          ? { words: [await api<Word>(`/words/${encodeURIComponent(word_ids[0])}`, undefined, controller.signal)], errors: [] }
          : await api<Comparison>('/compare', { word_ids }, controller.signal)
        if (controller.signal.aborted) return
        setResult(data); setBusy(false)
        data.words.forEach(word => { void loadRelated(word) })
        if (data.errors.length || data.words.length < 2) return
        setAiBusy(true)
        try {
          const ai = await api<Explanation>('/compare/explanations', { word_ids: data.words.map(word => word.word_id) }, controller.signal)
          if (!controller.signal.aborted) setExplanation(ai)
        } catch {
          if (!controller.signal.aborted) setExplanation({ state: 'unavailable', claims: [], evidence: [], provenance: 'AI_GENERATED_METADATA' })
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not load these words. Try again.')
      } finally {
        if (!controller.signal.aborted) { setBusy(false); setAiBusy(false) }
      }
    }
    void compare()
    return () => controller.abort()
  }, [seedKey, retry])

  /** Compare sets independent of API ordering, keeping source and AI provenance distinct. */
  function relationKey(map: Related | null | undefined) {
    if (!map || !['available', 'no_relationships'].includes(map.state) || map.semantic_neighbours_state !== 'available') return null
    return JSON.stringify([...new Set([
      ...map.relationships.map(edge => `${edge.provenance}:${edge.type}:${edge.word}`),
      ...map.semantic_neighbours.map(node => `AI:semantic:${node.word}`),
    ])].sort())
  }

  const words = result?.words || []
  const fields = [
    { label: 'Headword', values: words.map(word => word.word) },
    { label: 'Part of speech', values: words.map(word => word.definitions[0]?.part_of_speech || null) },
    { label: 'Register', values: words.map(word => word.definitions[0]?.metadata.register || null) },
    { label: 'Primary sense', values: words.map(word => word.definitions[0]?.text || null) },
    { label: 'Related-word set', values: words.map(word => relationKey(related[word.word_id])) },
  ]

  return <section className="comparison-workspace" aria-label="Compare words">
    {/* One compact line: the sheet's job is the table, and every row of preamble is a row
        of table the reader has to scroll to reach. */}
    <div className="comparison-intro"><h2>เทียบคำ</h2><p>วางคำไว้ข้างกัน แล้วมองให้เห็นความต่าง</p></div>
    {terms.length < 2 && <p className="comparison-hint">{terms.length ? 'Add another word using the search box below to compare.' : 'Add words using the search box below to start a comparison.'}</p>}
    {error && <p role="alert" className="comparison-error">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Try again</button></p>}
    {busy && <p role="status">Gathering definitions and sources…</p>}
    {result && <>
      {result.errors.map(item => <p className="comparison-error" role="alert" key={item.word_id}>{item.word_id}: {item.message}</p>)}
      {words.length > 0 && <div className="comparison-matrix-scroll" role="region" tabIndex={0} aria-label="Dictionary comparison fields">
        <table className="comparison-matrix" style={{ '--comparison-count': words.length } as CSSProperties}>
          <caption>Field-by-field comparison · shaded cells differ; matching cells are labelled Same.</caption>
          <tbody>{fields.map((field, row) => <tr key={field.label}>
            <th scope="row">{field.label}</th>
            {words.map((word, index) => {
              /** Missing evidence is unknown, never proof that words agree or differ. */
              const value = field.values[index]
              const status = value === null ? 'unknown' : words.length < 2 ? 'single' : field.values.some((other, at) => at !== index && other !== null && other === value) ? 'same' : field.values.some(other => other !== null && other !== value) ? 'different' : 'unknown'
              const sense = word.definitions[0]
              const map = related[word.word_id]
              return <td key={word.word_id} className={`comparison-cell is-${status}`}>
                {status !== 'single' && <small className="comparison-cell-status">{status === 'same' ? 'Same' : status === 'different' ? 'Different' : 'Not enough data'}</small>}
                {row === 0 ? <button className="comparison-headword" onClick={() => onExplore(word.word)} lang="th">{word.word} ↗</button> : row === 4 ? <>
                  {map === undefined ? <p role="status">Loading related words…</p> : map === null ? <p>Related words unavailable.</p> : <>
                    <p className="comparison-related-label">Dictionary relationships</p>
                    {/* Wrapping chips, not one word per line — a dozen neighbours per cell
                        turned a five-row table into a page of scrolling. */}
                    <div className="comparison-relations">{map.relationships.length ? map.relationships.map(edge => <button className="comparison-relation" key={edge.relationship_id} onClick={() => onExplore(edge.word)}>{edge.word}<small>{edge.type} · {edge.provenance === 'SOURCE_DATA' ? edge.source.name : edge.provenance === 'CURATED_METADATA' ? 'Curated' : 'AI'}</small></button>) : <p>{['available', 'no_relationships'].includes(map.state) ? 'None recorded.' : 'Dictionary relationships unavailable.'}</p>}</div>
                    <p className="comparison-related-label">Semantic neighbours · AI</p>
                    <div className="comparison-relations">{map.semantic_neighbours.length ? map.semantic_neighbours.map(node => <button className="comparison-relation" key={node.word_id} onClick={() => onExplore(node.word)}>{node.word}</button>) : <p>{map.semantic_neighbours_state === 'available' ? 'None returned.' : 'AI neighbours unavailable.'}</p>}</div>
                  </>}
                </> : <p lang={value ? 'th' : undefined}>{value ? readableText(value) : 'Not recorded in the source.'}</p>}
                {row === 3 && sense && <DefinitionSource source={sense.source} definition={sense} />}
              </td>
            })}
          </tr>)}</tbody>
        </table>
      </div>}
      {(terms.length >= 2 && words.length > 0) && <section className="comparison-ai" aria-labelledby="comparison-ai-title" aria-busy={aiBusy}>
        <div className="comparison-ai-heading"><span aria-hidden="true">✳</span><div><h2 id="comparison-ai-title">{explanation?.mode === 'extractive' ? 'Source extracts' : 'The difference, explained'}</h2><p>{explanation?.mode === 'extractive' ? 'AI comparison · extractive text selected from the definitions above' : 'AI comparison · grounded in the definitions above'}</p></div></div>
        {aiBusy ? <p role="status">Reading the evidence across all {result.words.length} words…</p> : explanation?.state === 'grounded' ? <>
          {explanation.claims.map((claim, index) => <div className="comparison-claim" key={index}><h3 lang="th">{claim.word}</h3><p lang="th">{claim.text}</p><div className="comparison-citations">{claim.evidence_ids.map(id => {
            /** Resolve each citation against returned evidence rather than inventing source labels. */
            const evidence = explanation.evidence.find(item => item.definition_id === id)
            return evidence ? <span key={id}>{evidence.source.name} · {evidence.source.version} · definition {evidence.number}</span> : null
          })}</div></div>)}
          <p className="comparison-limitation">{explanation.limitation}</p>
        </> : <p className="comparison-unavailable">{explanation?.text || (result.errors.length ? 'Resolve the missing words to compare all selected words.' : 'AI comparison is unavailable. The dictionary evidence above is still available.')}<br /><small>Use the source definitions to assess meaning. Unsupported usage rules are not inferred.</small></p>}
      </section>}
    </>}
  </section>
}
