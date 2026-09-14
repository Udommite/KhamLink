import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api } from './api'
import type { Explanation, Word } from './types'
import WordCard from './WordCard'
import './comparison.css'

interface Comparison { words: Word[]; errors: { word_id: string; message: string }[] }

/** Keep an editable pair while allowing the workspace to grow without a column cap. */
export default function ComparisonWorkspace({ seed = [], onExplore }: { seed?: string[]; onExplore: (term: string) => void }) {
  const [terms, setTerms] = useState(() => seed.length >= 2 ? seed : [seed[0] || '', ''])
  const [result, setResult] = useState<Comparison | null>(null)
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const appliedSeed = useRef(JSON.stringify(seed.length >= 2 ? seed : [seed[0] || '', '']))
  useEffect(() => () => request.current?.abort(), [])

  /** Apply a new comparison seed without resetting state for ordinary parent rerenders. */
  useEffect(() => {
    const next = seed.length >= 2 ? seed : [seed[0] || '', '']
    const nextKey = JSON.stringify(next)
    if (nextKey === appliedSeed.current) return
    appliedSeed.current = nextKey
    request.current?.abort()
    setTerms(next)
    setBusy(false)
    setAiBusy(false)
    setResult(null)
    setExplanation(null)
    setError('')
  }, [seed])

  /** Cancel stale comparisons as soon as their inputs change. */
  function edit(next: string[]) {
    request.current?.abort()
    setTerms(next); setBusy(false); setAiBusy(false); setResult(null); setExplanation(null); setError('')
  }

  /** Fetch dictionary evidence first; an unavailable model never hides the definitions. */
  async function compare(event: FormEvent) {
    event.preventDefault()
    const word_ids = terms.map(term => term.trim())
    if (word_ids.some(term => !term)) { setError('Enter a word in every column, or remove the empty column.'); return }
    if (new Set(word_ids).size !== word_ids.length) { setError('Choose different words to compare.'); return }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(''); setResult(null); setExplanation(null); setAiBusy(false)
    try {
      const data = await api<Comparison>('/compare', { word_ids }, controller.signal)
      if (controller.signal.aborted) return
      setResult(data); setBusy(false)
      if (data.errors.length) return
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

  return <section className="comparison-workspace" aria-label="Compare words">
    <div className="comparison-intro"><h2>Similar words. Different worlds.</h2><p>วางคำไว้ข้างกัน แล้วมองให้เห็นความต่าง</p></div>
    <form onSubmit={compare} className="comparison-form">
      <div className="comparison-inputs">
        {terms.map((term, index) => <div className="comparison-input" key={index}>
          <label htmlFor={`compare-${index}`}>Word {index + 1}</label>
          <input id={`compare-${index}`} value={term} lang="th" autoComplete="off" maxLength={200} placeholder={index === 0 ? 'ประสิทธิภาพ' : index === 1 ? 'ประสิทธิผล' : 'เพิ่มคำที่อยากเทียบ'} onChange={event => edit(terms.map((value, at) => at === index ? event.target.value : value))} />
          {terms.length > 2 && <button type="button" className="comparison-remove" aria-label={`Remove word ${index + 1}`} onClick={() => edit(terms.filter((_, at) => at !== index))}>×</button>}
        </div>)}
      </div>
      <div className="comparison-actions"><button type="button" className="comparison-add" onClick={() => edit([...terms, ''])}>+ Add word</button><button className="comparison-submit" disabled={busy}>{busy ? 'Finding the differences…' : 'Compare words'}<span aria-hidden="true">↗</span></button></div>
    </form>
    {error && <p role="alert" className="comparison-error">{error}</p>}
    {busy && <p role="status">Gathering definitions and sources…</p>}
    {!result && !busy && <p className="comparison-hint">Meaning, usage and nuance — with the source beside every word.</p>}
    {result && <>
      {result.errors.map(item => <p className="comparison-error" role="alert" key={item.word_id}>{item.word_id}: {item.message}</p>)}
      <div className={`comparison-columns ${result.words.length > 3 ? 'comparison-scroll' : ''}`} style={{ '--comparison-count': Math.max(1, result.words.length) } as React.CSSProperties} tabIndex={result.words.length > 3 ? 0 : undefined} aria-label="Dictionary comparison columns">
        {result.words.map(word => <article className="comparison-column" key={word.word_id}>
          <WordCard word={word} compact onExplore={onExplore} />
          {word.curated_metadata.length === 0 && word.ai_generated_metadata.length === 0 && !word.definitions.some(sense => ['register', 'usage', 'note', 'context', 'collocations'].some(key => sense.metadata[key])) && <p className="comparison-missing">Usage and register notes are not available for this entry.</p>}
          <button type="button" className="comparison-explore" onClick={() => onExplore(word.word)}>Explore connections <span aria-hidden="true">↗</span></button>
        </article>)}
      </div>
      <section className="comparison-ai" aria-labelledby="comparison-ai-title" aria-busy={aiBusy}>
        <div className="comparison-ai-heading"><span aria-hidden="true">✳</span><div><h2 id="comparison-ai-title">{explanation?.mode === 'extractive' ? 'Source extracts' : 'The difference, explained'}</h2><p>{explanation?.mode === 'extractive' ? 'AI comparison · extractive text selected from the definitions above' : 'AI comparison · grounded in the definitions above'}</p></div></div>
        {aiBusy ? <p role="status">Reading the evidence across all {result.words.length} words…</p> : explanation?.state === 'grounded' ? <>
          {explanation.claims.map((claim, index) => <div className="comparison-claim" key={index}><h3 lang="th">{claim.word}</h3><p lang="th">{claim.text}</p><div className="comparison-citations">{claim.evidence_ids.map(id => {
            /** Resolve each citation against returned evidence rather than inventing source labels. */
            const evidence = explanation.evidence.find(item => item.definition_id === id)
            return evidence ? <span key={id}>{evidence.source.name} · {evidence.source.version} · definition {evidence.number}</span> : null
          })}</div></div>)}
          <p className="comparison-limitation">{explanation.limitation}</p>
        </> : <p className="comparison-unavailable">{explanation?.text || (result.errors.length ? 'Resolve the missing words to compare all selected words.' : 'AI comparison is unavailable. The dictionary evidence above is still available.')}<br /><small>Use the source definitions to assess meaning. Unsupported usage rules are not inferred.</small></p>}
      </section>
    </>}
  </section>
}
