import React, { useEffect, useRef, useState } from 'react'
import { api, track } from './api'
import type { Category, Explanation, Neighbour, Related, Review, SearchResults, Source, Suggestion, Word } from './types'

export const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
export const thaiNumber = (value: number) => String(value).replace(/\d/g, d => THAI_DIGITS[Number(d)])

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'correctness', label: 'ความถูกต้อง' },
  { id: 'clarity', label: 'ความชัดเจน' },
  { id: 'engagement', label: 'ความน่าอ่าน' },
  { id: 'delivery', label: 'ระดับภาษา' },
]

function Busy({ children = 'กำลังประมวลผล…' }: { children?: React.ReactNode }) {
  return <div className="state"><span className="spinner" aria-hidden="true" />{children}</div>
}
function Problem({ error }: { error: unknown }) {
  if (!error) return null
  return <p className="alert" role="alert">{error instanceof Error ? error.message : 'ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้ง'}</p>
}

/* ---------------- review ---------------- */

export function ReviewPanel({ review, busy, error, activeId, filter, onFilter, onActivate, onAccept, onDismiss, onAnalyze, dirty }: {
  review?: Review; busy: boolean; error: unknown; activeId: string | null
  filter: Set<Category>; onFilter: (next: Set<Category>) => void
  onActivate: (id: string) => void
  onAccept: (suggestion: Suggestion, word: string) => void
  onDismiss: (id: string) => void
  onAnalyze: () => void
  dirty: boolean
}) {
  const counts = CATEGORIES.map(category => ({
    ...category,
    count: (review?.suggestions || []).filter(s => s.category === category.id).length,
  }))
  const shown = (review?.suggestions || []).filter(s => filter.has(s.category))

  return (
    <>
      <div className="side-head">
        <h2>ข้อเสนอแนะ</h2>
        <span className="badge num">{review ? review.suggestions.length : '–'}</span>
        {dirty && <button className="btn btn-sm btn-primary" style={{ marginLeft: 'auto' }} onClick={onAnalyze}>ตรวจใหม่</button>}
      </div>

      <div className="legend" role="group" aria-label="กรองตามประเภท">
        {counts.map(category => {
          const on = filter.has(category.id)
          return (
            <button
              key={category.id}
              data-cat={category.id}
              aria-pressed={on}
              onClick={() => {
                const next = new Set(filter)
                next.has(category.id) ? next.delete(category.id) : next.add(category.id)
                onFilter(next.size ? next : new Set(CATEGORIES.map(c => c.id)))
              }}
            ><b className="num">{category.count}</b>{category.label}</button>
          )
        })}
      </div>

      {busy && <Busy>กำลังตรวจข้อความ…</Busy>}
      <Problem error={error} />
      {review?.degraded && <p className="alert" role="status">ตรวจได้ไม่ครบในขณะนี้ ยังบอกคำที่ไม่พบในพจนานุกรมและสถิติข้อความได้</p>}

      {!busy && review && !review.suggestions.length && (
        <div className="state"><strong>ยังไม่พบอะไรที่ต้องแก้</strong>ทุกคำในข้อความนี้อยู่ในพจนานุกรม และเข้ากับระดับภาษาที่คุณตั้งไว้</div>
      )}
      {!busy && !review && !error && (
        <div className="state"><strong>เริ่มเขียนได้เลย</strong>พิมพ์ข้อความแล้วกด “ตรวจข้อความ” เพื่อดูคำที่ควรทบทวน</div>
      )}
      {!busy && review && shown.length === 0 && review.suggestions.length > 0 && (
        <div className="state">ไม่มีข้อเสนอแนะในประเภทที่เลือก ลองเปิดประเภทอื่น</div>
      )}

      <div className="cards">
        {shown.map(suggestion => (
          <div key={suggestion.id} className="card" data-cat={suggestion.category} data-active={String(suggestion.id === activeId)}>
            <button className="card-kind" onClick={() => onActivate(suggestion.id)} aria-expanded={suggestion.id === activeId}>
              <span className="card-dot" aria-hidden="true" />{suggestion.title}
            </button>
            <p className="target">
              {suggestion.replacements.length === 1
                ? <><s>{suggestion.text}</s> → <b>{suggestion.replacements[0].word}</b></>
                : suggestion.text}
            </p>
            <p className="why">{suggestion.message}</p>
            {suggestion.replacements.length > 1 && (
              <div className="repl">
                {suggestion.replacements.map(replacement => (
                  <button key={replacement.word_id} className="chip" onClick={() => onAccept(suggestion, replacement.word)}>{replacement.word}</button>
                ))}
              </div>
            )}
            <div className="card-actions">
              {suggestion.replacements.length === 1 && (
                <button className="btn btn-sm btn-primary" onClick={() => onAccept(suggestion, suggestion.replacements[0].word)}>ใช้คำนี้</button>
              )}
              <button className="btn btn-sm btn-ghost" onClick={() => onDismiss(suggestion.id)}>ไม่ต้องแก้</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ---------------- the sense stack ---------------- */

const META_LABELS: [string, string][] = [
  ['pronunciation', 'คำอ่าน'], ['ipa', 'สัทอักษร'], ['register', 'ระดับภาษา'],
  ['example', 'ตัวอย่าง'], ['etymology', 'ที่มา'], ['note', 'หมายเหตุ'], ['edition', 'ฉบับ'],
]

export function EntryPanel({ term, onSource, onReplace, onSearch }: {
  term: string
  onSource: (source: Source) => void
  onReplace: (word: string) => void
  onSearch: (query: string) => void
}) {
  const [word, setWord] = useState<Word>()
  const [related, setRelated] = useState<Related>()
  const [error, setError] = useState<unknown>()

  useEffect(() => {
    const controller = new AbortController()
    setWord(undefined); setRelated(undefined); setError(null)
    api<Word>(`/words/${encodeURIComponent(term)}`, undefined, controller.signal)
      .then(found => {
        setWord(found)
        return api<Related>(`/words/${encodeURIComponent(found.word_id)}/related`, undefined, controller.signal)
      })
      .then(setRelated)
      .catch(problem => { if (!controller.signal.aborted) setError(problem) })
    return () => controller.abort()
  }, [term])

  if (error) {
    return (
      <div className="state">
        <strong>ไม่พบ “{term}” ในพจนานุกรม</strong>
        คำนี้อาจสะกดต่างออกไป หรือยังไม่อยู่ในชุดข้อมูลนี้
        <button className="btn btn-sm" onClick={() => onSearch(term)}>ค้นจากความหมายแทน</button>
      </div>
    )
  }
  if (!word) return <Busy>กำลังเปิดคำ…</Busy>

  const first = word.definitions[0]
  const neighbours = related?.semantic_neighbours || []
  return (
    <>
      <div className="entry-head"><h2>{word.word}</h2></div>
      <div className="entry-sub">
        {first.metadata.pronunciation && <span>[{first.metadata.pronunciation}]</span>}
        {first.metadata.ipa && <span className="ipa">{first.metadata.ipa}</span>}
        <span className="prov">ข้อมูลจากพจนานุกรม</span>
      </div>

      <ol className="senses">
        {word.definitions.map(sense => (
          <li className="sense" key={sense.definition_id}>
            <span className="sense-no" aria-hidden="true">{thaiNumber(sense.number)}</span>
            <div>
              <p className="sense-text">
                {sense.part_of_speech && <span className="sense-pos">{sense.part_of_speech}</span>}
                {sense.text}
              </p>
              <div className="sense-meta">
                {META_LABELS.filter(([key]) => key !== 'ipa' && key !== 'pronunciation' && sense.metadata[key]).map(([key, label]) => (
                  <span key={key}><span className="label">{label}: </span>{sense.metadata[key]}</span>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="tiny" style={{ marginTop: 14 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => { onSource(word.source); track('source_opened', { word_id: word.word_id }) }}>
          ตรวจสอบแหล่งข้อมูล
        </button>
      </p>

      {neighbours.length > 0 && (
        <>
          <p className="group-head">คำใกล้เคียงความหมาย <span className="prov prov-ai">AI ประมวลผล</span></p>
          <div className="neighbours">
            {neighbours.map((near: Neighbour) => (
              <button key={near.word_id} className="neighbour" onClick={() => onReplace(near.word)} title={`แทนที่ด้วย ${near.word}`}>
                <b>{near.word}</b><span>{near.description}</span>
              </button>
            ))}
          </div>
          <p className="tiny" style={{ marginTop: 8 }}>คำกลุ่มนี้ระบบหาจากความใกล้เคียงของความหมาย ไม่ใช่ความสัมพันธ์ที่พจนานุกรมประกาศไว้</p>
        </>
      )}

      {related && related.relationships.length > 0 && (
        <>
          <p className="group-head">ความสัมพันธ์ตามพจนานุกรม <span className="prov">แหล่งอ้างอิง</span></p>
          <div className="neighbours">
            {related.relationships.map(edge => (
              <button key={edge.relationship_id} className="neighbour" onClick={() => onReplace(edge.word)}>
                <b>{edge.word}</b><span>{edge.description}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/* ---------------- find a word ---------------- */

export function FindPanel({ seed, onInsert, onOpen }: { seed: string; onInsert: (word: string) => void; onOpen: (word: string) => void }) {
  const [query, setQuery] = useState(seed)
  const [results, setResults] = useState<SearchResults>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [recent, setRecent] = useState<string[]>([])
  const sequence = useRef(0)

  useEffect(() => { if (seed) setQuery(seed) }, [seed])

  async function run(value = query) {
    if (!value.trim()) { setError(new Error('พิมพ์ความหมายที่คุณนึกถึง เช่น “รักษาของเดิมไว้ไม่ให้สูญหาย”')); return }
    const ticket = ++sequence.current
    setBusy(true); setError(null)
    try {
      const found = await api<SearchResults>('/search', { query: value, limit: 10 })
      if (ticket !== sequence.current) return
      setResults(found)
      setRecent(previous => [value, ...previous.filter(item => item !== value)].slice(0, 5))
      track('search_submitted', { length: value.length })
    } catch (problem) {
      if (ticket === sequence.current) setError(problem)
    } finally {
      if (ticket === sequence.current) setBusy(false)
    }
  }

  return (
    <>
      <div className="side-head"><h2>หาคำจากความหมาย</h2></div>
      <form className="panel-form" onSubmit={event => { event.preventDefault(); void run() }}>
        <label htmlFor="find-query" className="tiny">อธิบายความหมายที่ต้องการ แล้วให้ระบบหาคำให้</label>
        <textarea id="find-query" className="field" rows={3} value={query} onChange={event => setQuery(event.target.value)}
          placeholder="เช่น คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย" />
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'กำลังหา…' : 'หาคำ'}</button>
      </form>

      {recent.length > 0 && (
        <div className="recents" style={{ marginBottom: 14 }}>
          {recent.map(item => <button key={item} className="chip" onClick={() => { setQuery(item); void run(item) }}>{item.slice(0, 22)}{item.length > 22 ? '…' : ''}</button>)}
        </div>
      )}

      {busy && <Busy>กำลังค้นจากความหมาย…</Busy>}
      <Problem error={error} />
      {results?.degraded && <p className="alert" role="status">ค้นจากความหมายได้ไม่ครบ ขณะนี้ยังค้นคำตรงตัวได้</p>}

      {!busy && results && !results.candidates.length && (
        <div className="state"><strong>ยังไม่พบคำที่มั่นใจได้</strong>ลองอธิบายให้สั้นลง หรือใช้คำที่พจนานุกรมน่าจะใช้เขียนนิยาม</div>
      )}

      {(results?.candidates || []).map(candidate => (
        <div key={candidate.word_id} className="result">
          <div className="result-top">
            <b>{candidate.word}</b>
            <span className="match" data-type={candidate.match_type}>
              {candidate.match_type === 'exact' ? 'ตรงกับคำค้น' : candidate.match_type === 'partial' ? 'คำขึ้นต้น' : 'ใกล้เคียงความหมาย'}
            </span>
          </div>
          <p>{candidate.description}</p>
          <div className="card-actions">
            <button className="btn btn-sm btn-primary" onClick={() => onInsert(candidate.word)}>แทรกลงข้อความ</button>
            <button className="btn btn-sm btn-ghost" onClick={() => onOpen(candidate.word)}>ดูความหมายเต็ม</button>
          </div>
        </div>
      ))}
      {results && <p className="tiny" style={{ marginTop: 10 }}>วิธีค้น: {results.retrieval_mode?.includes('expanded') ? 'ขยายคำค้นด้วยโมเดลภาษา' : 'ค้นจากดัชนีความหมายโดยตรง'}</p>}
    </>
  )
}

/* ---------------- compare ---------------- */

export function ComparePanel({ seed, onSource }: { seed: string; onSource: (source: Source) => void }) {
  const [left, setLeft] = useState(seed)
  const [right, setRight] = useState('')
  const [words, setWords] = useState<Word[]>()
  const [errors, setErrors] = useState<{ word_id: string; message: string }[]>([])
  const [explanation, setExplanation] = useState<Explanation>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  useEffect(() => { if (seed) setLeft(seed) }, [seed])

  async function compare() {
    if (!left.trim() || !right.trim()) { setError(new Error('กรอกคำให้ครบทั้งสองช่อง')); return }
    setBusy(true); setError(null); setExplanation(undefined)
    try {
      const result = await api<{ words: Word[]; errors: { word_id: string; message: string }[] }>('/compare', { word_ids: [left.trim(), right.trim()] })
      setWords(result.words); setErrors(result.errors || [])
      track('word_compare_started', { count: 2 })
    } catch (problem) { setError(problem) } finally { setBusy(false) }
  }

  async function explain() {
    setBusy(true)
    try { setExplanation(await api<Explanation>('/compare/explanations', { word_ids: [left.trim(), right.trim()] })) }
    catch (problem) { setError(problem) } finally { setBusy(false) }
  }

  return (
    <>
      <div className="side-head"><h2>เทียบสองคำ</h2></div>
      <form className="panel-form" onSubmit={event => { event.preventDefault(); void compare() }}>
        <input className="field" value={left} onChange={event => setLeft(event.target.value)} placeholder="คำแรก" aria-label="คำแรก" />
        <input className="field" value={right} onChange={event => setRight(event.target.value)} placeholder="คำที่สอง" aria-label="คำที่สอง" />
        <button className="btn btn-primary" type="submit" disabled={busy}>เทียบความหมาย</button>
      </form>

      {busy && <Busy />}
      <Problem error={error} />
      {errors.map(problem => <p key={problem.word_id} className="alert">ไม่พบ “{problem.word_id}” ในพจนานุกรม</p>)}

      {!busy && !words && !error && (
        <div className="state"><strong>เลือกสองคำที่คุณลังเล</strong>ระบบจะวางความหมายไว้ข้างกันให้อ่านเทียบได้</div>
      )}

      <div className="compare-cols">
        {(words || []).map(word => (
          <div className="compare-col" key={word.word_id}>
            <h3>{word.word}</h3>
            <ol className="senses">
              {word.definitions.slice(0, 4).map(sense => (
                <li className="sense" key={sense.definition_id}>
                  <span className="sense-no" aria-hidden="true">{thaiNumber(sense.number)}</span>
                  <p className="sense-text">
                    {sense.part_of_speech && <span className="sense-pos">{sense.part_of_speech}</span>}
                    {sense.text}
                  </p>
                </li>
              ))}
            </ol>
            <button className="btn btn-sm btn-ghost" onClick={() => onSource(word.source)}>ตรวจสอบแหล่งข้อมูล</button>
          </div>
        ))}
      </div>

      {words && words.length === 2 && !explanation && (
        <button className="btn" style={{ marginTop: 14, width: '100%' }} onClick={() => void explain()}>ให้ช่วยอธิบายความต่าง</button>
      )}
      {explanation && (
        <>
          <p className="group-head">คำอธิบาย <span className="prov prov-ai">AI ประมวลผล</span></p>
          {explanation.state === 'grounded' ? (
            <div className="claims">
              {explanation.claims.map((claim, index) => (
                <div className="claim" key={index}><p>{claim.text}</p><p className="tiny">{claim.word} · รุ่น {claim.source_version}</p></div>
              ))}
            </div>
          ) : <p className="state">{explanation.text || 'หลักฐานยังไม่พอสำหรับคำอธิบายที่เชื่อถือได้'}</p>}
          {explanation.limitation && <p className="tiny" style={{ marginTop: 10 }}>{explanation.limitation}</p>}
        </>
      )}
    </>
  )
}
