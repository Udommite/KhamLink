import { useEffect, useRef, useState } from 'react'
import Editor from './Editor'
import WordCard from './WordCard'
import { api } from './api'
import { countWords, formalityLabels, type Doc, type Formality } from './docs'
import type { Related, Review, Word } from './types'
import './write.css'

export interface WriteProps {
  docs: Doc[]
  docId: string | null
  onCreate: () => void
  onOpen: (id: string) => void
  onChange: (id: string, patch: Partial<Doc>) => void
  onDelete: (id: string) => void
  onExplore: (term: string) => void
  onCompare: (terms: string[]) => void
}
interface Selection { start: number; end: number; text: string; tokenId: string | null }

/** Replace only the still-matching code-point span; stale selections never edit a different word. */
export function replaceSpan(body: string, range: { start: number; end: number; text: string }, replacement: string): string {
  const chars = Array.from(body)
  if (range.start < 0 || range.end > chars.length || range.start >= range.end || chars.slice(range.start, range.end).join('') !== range.text) return body
  return [...chars.slice(0, range.start), replacement, ...chars.slice(range.end)].join('')
}

/** Keep saved documents and the native Thai editor inside one quiet writing workspace. */
export default function Write(props: WriteProps) {
  const doc = props.docs.find(item => item.id === props.docId)
  return <section className="write-page">
    <div className="write-toolbar">
      <label className="write-picker">YOUR DOCUMENTS
        <select aria-label="Open document" value={doc?.id || ''} onChange={event => props.onOpen(event.target.value)}>
          <option value="" disabled>Choose a document</option>
          {props.docs.map(item => <option key={item.id} value={item.id}>{item.title || 'Untitled document'}</option>)}
        </select>
      </label>
      <button className="write-button" onClick={props.onCreate}>+ New document</button>
      <span className="write-local">Private to this browser</span>
    </div>
    {doc ? <WritingDocument key={doc.id} {...props} doc={doc} /> : <div className="write-empty">
      <span className="write-eyebrow">A LITTLE SPACE TO THINK</span>
      <h1>ให้ความคิด<br />ค่อย ๆ เป็นคำ</h1>
      <p>Write freely. Select a word to discover what it could become.</p>
      <button className="write-button write-primary" onClick={props.onCreate}>Start writing <span aria-hidden="true">↗</span></button>
    </div>}
  </section>
}

/** Reset selection and review state with each document, and discard requests for outdated text. */
function WritingDocument({ doc, onChange, onDelete, onExplore, onCompare }: WriteProps & { doc: Doc }) {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [word, setWord] = useState<Word>()
  const [lookupOverride, setLookupOverride] = useState('')
  const [related, setRelated] = useState<Related>()
  const [lookupError, setLookupError] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [review, setReview] = useState<Review>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const ticket = useRef(0)
  const term = lookupOverride || selection?.tokenId || selection?.text.trim() || ''

  /** A new selection starts a fresh lookup; alternatives keep the original replacement span. */
  useEffect(() => { setLookupOverride('') }, [selection?.start, selection?.end, selection?.text])

  /** Abort earlier lookups so rapidly selecting different words cannot show stale definitions. */
  useEffect(() => {
    const controller = new AbortController()
    setWord(undefined); setRelated(undefined); setLookupError(''); setLookupBusy(Boolean(term))
    if (!term) return
    const timer = setTimeout(() => {
      api<Word>(`/words/${encodeURIComponent(term)}`, undefined, controller.signal)
        .then(found => { if (controller.signal.aborted) return; setWord(found); return api<Related>(`/words/${encodeURIComponent(found.word_id)}/related`, undefined, controller.signal) })
        .then(found => { if (!controller.signal.aborted) setRelated(found) })
        .catch(problem => { if (!controller.signal.aborted) setLookupError(problem instanceof Error ? problem.message : 'Could not look up this selection.') })
        .finally(() => { if (!controller.signal.aborted) setLookupBusy(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [term])

  /** Body or goal changes invalidate all backend offsets and pending review responses. */
  useEffect(() => {
    ticket.current++; setReview(undefined); setActive(null); setBusy(false); setError('')
    return () => { ticket.current++ }
  }, [doc.body, doc.formality])

  /** Explicit review keeps typing uninterrupted and uses the configured backend evidence. */
  async function analyze() {
    const current = ++ticket.current
    setBusy(true); setError('')
    try {
      const result = await api<Review>('/review', { text: doc.body, formality: doc.formality })
      if (ticket.current === current) setReview(result)
    } catch (problem) {
      if (ticket.current === current) setError(problem instanceof Error ? problem.message : 'Review unavailable. Please try again.')
    } finally { if (ticket.current === current) setBusy(false) }
  }

  /** Any edit clears the old selection before its offsets can be reused. */
  function updateBody(body: string) {
    ticket.current++; setSelection(null); setLookupOverride(''); setReview(undefined); setActive(null)
    onChange(doc.id, { body })
  }

  /** Apply alternatives only to the selected source span, including text containing emoji. */
  function replaceSelection(replacement: string) {
    if (selection) updateBody(replaceSpan(doc.body, selection, replacement))
  }

  return <div className="write-workspace">
    <section className="write-paper" aria-label="Writing surface">
      <div className="write-paper-top"><span className="write-eyebrow">WRITE / YOUR OWN WORDS</span><span className="write-count">{countWords(doc.body).toLocaleString()} words</span></div>
      <input className="write-title" aria-label="Document title" value={doc.title} onChange={event => onChange(doc.id, { title: event.target.value })} placeholder="Untitled document" />
      <div className="write-goals">
        <label>Tone <select aria-label="Writing tone" value={doc.formality} onChange={event => onChange(doc.id, { formality: event.target.value as Formality })}>{Object.entries(formalityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <button className="write-button write-review" disabled={busy || !doc.body.trim()} onClick={() => void analyze()}>{busy ? 'Reading your words…' : 'Review writing ↗'}</button>
      </div>
      <Editor value={doc.body} onChange={updateBody} suggestions={review?.suggestions || []} tokens={review?.tokens || []} activeId={active} selection={selection} onActivate={setActive} onSelect={setSelection} placeholder="เริ่มเขียนที่นี่… เลือกคำที่อยากรู้จักให้มากขึ้น" />
      <footer className="write-paper-footer"><span>Your words stay in this browser. Review sends text to the language service.</span><button className="write-text-button" onClick={() => setDeletePending(!deletePending)}>Delete document</button></footer>
      {deletePending && <div className="write-delete" role="alert"><span>Delete this document? You can undo this during the session.</span><button className="write-button" onClick={() => setDeletePending(false)}>Keep it</button><button className="write-button" onClick={() => onDelete(doc.id)}>Delete</button></div>}
    </section>
    <aside className="write-inspector" aria-label="Word tools">
      <div className="write-inspector-heading"><span className="write-eyebrow">BETWEEN THE WORDS</span><span aria-hidden="true">↗</span></div>
      {selection ? <>
        <div className="write-selection-tools"><span>“{selection.text}”</span><button className="write-text-button" onClick={() => setSelection(null)} aria-label="Close word selection">×</button></div>
        <div className="write-context-actions"><button className="write-button" onClick={() => onExplore(word?.word || selection.text)}>Discover ↗</button><button className="write-button" onClick={() => onCompare([selection.text, word?.word !== selection.text ? word?.word || '' : ''])}>Compare ⇄</button></div>
        {lookupBusy && <p role="status">Finding its connections…</p>}
        {word && <WordCard word={word} related={related} compact onExplore={setLookupOverride} onReplace={replaceSelection} />}
        {lookupError && <p className="write-notice" role="status">{lookupError} Try Discover to search by meaning.</p>}
      </> : <div className="write-inspector-empty"><div className="write-mini-network" aria-hidden="true"><span>ความคิด</span><i /><b>คำ</b><i /><span>บริบท</span></div><h2>Every word opens a possibility.</h2><p>เลือกคำในข้อความ เพื่อดูความหมาย สำรวจคำใกล้เคียง หรือหาคำที่ใช่กว่า</p><small>Select text to explore its meaning and alternatives.</small></div>}
      <div className="write-review-results" aria-live="polite">
        {error && <p role="alert">{error}</p>}
        {review && <><span className="write-eyebrow">WRITING NOTES · {review.suggestions.length}</span>{review.degraded && <p className="write-notice">{review.degraded_reason || 'Some review features are unavailable.'}</p>}{!review.suggestions.length && <p>No suggestions in this review.</p>}{review.suggestions.map(suggestion => <article className="write-note" data-active={suggestion.id === active} key={suggestion.id}>
          <button className="write-note-title" onClick={() => setActive(suggestion.id)}>{suggestion.title} <span>“{suggestion.text}”</span></button><p>{suggestion.message}</p>
          {suggestion.replacements.map(replacement => <div className="write-replacement" key={replacement.word}><button className="write-button" onClick={() => updateBody(replaceSpan(doc.body, suggestion, replacement.word))}>Use {replacement.word} ↗</button><small>{replacement.provenance === 'AI_GENERATED_METADATA' ? 'AI suggestion · verify in context' : 'Dictionary / curated suggestion'}</small></div>)}
          <button className="write-text-button" onClick={() => { setReview({ ...review, suggestions: review.suggestions.filter(item => item.id !== suggestion.id) }); setActive(null) }}>Dismiss</button>
        </article>)}</>}
      </div>
    </aside>
  </div>
}
