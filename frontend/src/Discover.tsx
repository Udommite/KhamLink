import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, viewTransition } from './api'
import ComparisonWorkspace from './ComparisonWorkspace'
import SemanticGraph from './SemanticGraph'
import WordCard from './WordCard'
import { expandNetwork, readableText, validQuery, type Network } from './discovery-data'
import type { Candidate, Config, Related, SearchResults, Word } from './types'

export interface DiscoverRequest { term?: string; compare?: string[]; key: number }

/** REQ-UX-030: name the failed capability while preserving exact dictionary lookup. */
export function degradedMessage(reason?: string): string {
  const messages: Record<string, string> = {
    SEMANTIC_INDEX_UNAVAILABLE: 'ดัชนีค้นหาความหมายยังไม่พร้อม · ยังค้นหาคำตรงตัวได้',
    EMBEDDING_NOT_CONFIGURED: 'ยังไม่ได้ตั้งค่าบริการค้นหาความหมาย · ยังค้นหาคำตรงตัวได้',
    EMBEDDING_INPUT_INVALID: 'คำอธิบายนี้ใช้ค้นหาความหมายไม่ได้ · ลองปรับข้อความ',
    EMBEDDING_TIMEOUT: 'บริการค้นหาความหมายใช้เวลานานเกินไป · ลองอีกครั้ง',
    EMBEDDING_REQUEST_REJECTED: 'บริการค้นหาความหมายไม่รับคำขอนี้ · ลองปรับคำอธิบาย',
    EMBEDDING_AUTH_FAILED: 'บริการค้นหาความหมายยืนยันสิทธิ์ไม่สำเร็จ · ยังค้นหาคำตรงตัวได้',
    EMBEDDING_CREDIT_REQUIRED: 'บริการค้นหาความหมายมีเครดิตไม่เพียงพอ · ยังค้นหาคำตรงตัวได้',
    EMBEDDING_RATE_LIMITED: 'บริการค้นหาความหมายมีคำขอมากเกินไป · กรุณารอสักครู่',
    EMBEDDING_INVALID_RESPONSE: 'ผลค้นหาความหมายไม่ตรงกับดัชนี · ยังค้นหาคำตรงตัวได้',
    EMBEDDING_UNAVAILABLE: 'บริการค้นหาความหมายไม่พร้อมใช้งาน · ยังค้นหาคำตรงตัวได้',
    EXPANSION_UNAVAILABLE: 'ขยายคำอธิบายไม่ได้ · แสดงผลจากข้อความเดิม',
    RERANKER_UNAVAILABLE: 'จัดอันดับความหมายซ้ำไม่ได้ · โปรดตรวจความหมายจากพจนานุกรม',
    NO_RELIABLE_RESULT: 'ยังไม่มีคำที่ผ่านเกณฑ์ความมั่นใจ · ลองอธิบายอีกแบบ',
  }
  return messages[reason || ''] || 'ค้นหาความหมายได้ไม่ครบ · ยังค้นหาคำตรงตัวได้'
}

/** REQ-UX-021: steering rides on the existing related call, so an unsteered lookup is
    byte-identical to what it was and needs no separate endpoint. */
function relatedPath(wordId: string, steerWord: string, weight: number) {
  const path = `/words/${encodeURIComponent(wordId)}/related`
  const term = steerWord.trim()
  return term && weight > 0 ? `${path}?steer=${encodeURIComponent(term)}&steer_weight=${weight}` : path
}
interface Props { config?: Config; request?: DiscoverRequest; onWrite: () => void }

/** The search control keeps exact and semantic suggestions in one keyboard-operable list. */
function DiscoverSearch({ query, onQuery, onSearch, onChoose, busy, limit, suggestionHost, mode }: {
  query: string; onQuery: (query: string) => void; onSearch: (query: string) => void
  onChoose: (candidate: Candidate) => void; busy: boolean; limit: number; suggestionHost: HTMLElement | null
  mode: 'search' | 'compare'
}) {
  const [suggestions, setSuggestions] = useState<Candidate[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [focused, setFocused] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const show = focused && !dismissed && !busy && suggestions.length > 0

  useEffect(() => {
    const controller = new AbortController()
    setSuggestions([]); setCursor(-1); setSuggesting(false)
    if (!focused || dismissed || busy || !validQuery(query, limit)) return
    const timer = setTimeout(() => {
      setSuggesting(true)
      api<SearchResults>('/search', { query: query.trim(), limit: 5 }, controller.signal)
        .then(found => { if (!controller.signal.aborted) setSuggestions(found.candidates) })
        .catch(() => { /* Explicit search remains available when optional suggestions fail. */ })
        .finally(() => { if (!controller.signal.aborted) setSuggesting(false) })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, focused, dismissed, busy, limit])

  useEffect(() => {
    /** Slash focuses the product's main action without stealing keystrokes from editors. */
    const shortcut = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      if (field.current?.closest('[hidden]')) return
      event.preventDefault(); field.current?.focus()
    }
    addEventListener('keydown', shortcut)
    return () => removeEventListener('keydown', shortcut)
  }, [])

  /** Hide autocomplete before starting the selected query so stale results cannot reopen it. */
  function submit() {
    setDismissed(true)
    if (show && cursor >= 0) onChoose(suggestions[cursor])
    else onSearch(query)
  }

  return (
    <form className={`discover-search${busy ? ' is-searching' : ''}`} role="search" onSubmit={event => { event.preventDefault(); submit() }}>
      <div className="search-line">
        <span className="search-node" aria-hidden="true"><i /></span>
        <input id="discover-query" aria-label="ค้นหาคำหรือความหมาย" ref={field} value={query} onChange={event => { onQuery(event.target.value); setDismissed(false) }}
          onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setCursor(-1) }}
          placeholder={mode === 'compare' ? 'พิมพ์คำที่อยากเทียบ แล้วกด Enter…' : 'พิมพ์คำ หรือเล่าความหมายที่กำลังหา…'} autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={show ? 'search-suggestions' : undefined}
          aria-activedescendant={show && cursor >= 0 ? `suggestion-${cursor}` : undefined} aria-describedby="search-help"
          onKeyDown={event => {
            // Enter is handled here rather than left to implicit form submission: the
            // composition flag this used to consult never cleared for input methods that
            // fire compositionstart without a matching end, which killed the key outright.
            // `isComposing` is per-event and cannot latch.
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') { event.preventDefault(); submit() }
            if (event.key === 'Escape') { setDismissed(true); setCursor(-1) }
            if (show && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault()
              setCursor(previous => (previous + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
            }
          }} />
        {query && <button className="search-clear" type="button" aria-label="ล้างคำค้น" onClick={() => { onQuery(''); field.current?.focus() }}>×</button>}
        <button className="search-submit" type="submit" disabled={busy} aria-label={mode === 'compare' ? 'เพิ่มคำในการเปรียบเทียบ' : 'ค้นหา'}><span>{busy ? 'กำลังค้นหา' : mode === 'compare' ? 'เพิ่มคำ' : 'ค้นหา'}</span>{busy && <i className="lab-spinner" />}</button>
      </div>
      <div className="search-foot"><span id="search-help">{mode === 'compare' ? 'เพิ่มได้หลายคำ · เทียบทีละแถว' : 'ค้นจากคำ · ความหมาย · บริบท'}</span><span>{suggesting ? 'กำลังหาคำแนะนำ…' : <><kbd>/</kbd> เพื่อเริ่มค้นหา</>}</span></div>
      {show && suggestionHost && createPortal(<ul className="search-suggestions" id="search-suggestions" role="listbox" aria-label="คำแนะนำจากพจนานุกรม">
        {suggestions.map((candidate, index) => <li key={candidate.word_id} id={`suggestion-${index}`} role="option" aria-selected={cursor === index}
          onPointerDown={event => event.preventDefault()} onClick={() => { setDismissed(true); onChoose(candidate) }} onPointerEnter={() => setCursor(index)}>
          <div><strong>{candidate.word}</strong><span>{readableText(candidate.description)}</span></div><small>{candidate.match_type === 'exact' ? 'ตรงคำ' : candidate.match_type === 'partial' ? 'คำใกล้เคียง' : 'ใกล้ความหมาย'} ↗</small>
        </li>)}
      </ul>, suggestionHost)}
    </form>
  )
}

/** REQ-UX-021: a steering word plus a weight, biasing which neighbours the graph shows.
    The weight is inert until a word is supplied, so the control cannot mislead. */
function SteerControl({ word, weight, onWord, onWeight, state, applied }: {
  word: string; weight: number; onWord: (value: string) => void; onWeight: (value: number) => void
  state?: Related['steer_state']; applied?: string
}) {
  const armed = Boolean(word.trim())
  return <section className="steer-control" aria-label="ปรับความหมายของคำใกล้เคียง">
    <label htmlFor="steer-word">ปรับความหมายไปทางคำว่า</label>
    <div className="steer-row">
      <input id="steer-word" value={word} placeholder="เช่น อ่อนแอ" autoComplete="off" maxLength={512}
        onChange={event => { onWord(event.target.value); if (!weight) onWeight(.5) }} />
      <button type="button" className="steer-clear" hidden={!armed} onClick={() => { onWord(''); onWeight(0) }}>ล้าง</button>
    </div>
    <div className="steer-row">
      <input type="range" min={0} max={1} step={.05} value={weight} disabled={!armed}
        aria-label={`น้ำหนักการปรับความหมาย ${Math.round(weight * 100)} เปอร์เซ็นต์`}
        onChange={event => onWeight(Number(event.target.value))} />
      <output className="steer-weight">{Math.round(weight * 100)}%</output>
    </div>
    {/* Both notes name the word the SERVER steered by, never the half-typed input: the
        graph on screen reflects the former, so labelling it with the latter would describe
        a neighbourhood that is not being shown. */}
    {armed && state === 'unknown_word' && <p className="steer-note" role="status">ปรับความหมายด้วย “{word.trim()}” ไม่ได้ — แสดงคำใกล้เคียงตามปกติ</p>}
    {armed && state === 'active' && applied && <p className="steer-note" role="status">กำลังเอียงความหมายไปทาง “{applied}”</p>}
  </section>
}

/** Discover evolves one live graph in place; requests are abortable and dictionary data survives map failure. */
export default function Discover({ config, request, onWrite }: Props) {
  const [mode, setMode] = useState<'search' | 'compare'>('search')
  const [compareSeed, setCompareSeed] = useState<string[]>([])
  const [suggestionHost, setSuggestionHost] = useState<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [network, setNetwork] = useState<Network>({ nodes: [{ id: 'seed', word: 'คำ' }], links: [] })
  const [activeId, setActiveId] = useState('seed')
  const [path, setPath] = useState<string[]>([])
  const [word, setWord] = useState<Word>()
  const [related, setRelated] = useState<Related>()
  const [cardOpen, setCardOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<'understanding' | 'searching' | 'graph' | ''>('')
  const [results, setResults] = useState<SearchResults>()
  const [error, setError] = useState('')
  const [mapError, setMapError] = useState(false)
  const [intro, setIntro] = useState(() => {
    try { return !sessionStorage.getItem('khamlink.intro.v1') && !matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
  })
  const [steerWord, setSteerWord] = useState('')
  const [steerWeight, setSteerWeight] = useState(0)
  const steer = useRef({ word: '', weight: 0 })
  steer.current = { word: steerWord, weight: steerWeight }
  const [generation, setGeneration] = useState(0)
  const [history, setHistory] = useState<string[]>([])
  const operation = useRef<AbortController | null>(null)
  const limit = config?.query_limit || 300
  type Snapshot = { network: Network; activeId: string; path: string[]; word?: Word; related?: Related; query: string; results?: SearchResults }
  const current = useRef<Snapshot>({ network, activeId, path, word, related, query, results })
  current.current = { network, activeId, path, word, related, query, results }
  const undo = useRef<{ entries: Snapshot[]; cursor: number }>({ entries: [], cursor: -1 })

  useEffect(() => {
    const stepBack = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey || (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || document.getElementById('discover-main')?.closest('[hidden]')) return
      const stack = undo.current
      if (stack.cursor < 0) return
      event.preventDefault(); operation.current?.abort()
      const saved = stack.entries[stack.cursor--]
      setNetwork(saved.network); setActiveId(saved.activeId); setPath(saved.path); setWord(saved.word); setRelated(saved.related); setQuery(saved.query); setResults(saved.results); setBusy(false); setProgress(''); setError(''); setCardOpen(true)
    }
    addEventListener('keydown', stepBack)
    return () => removeEventListener('keydown', stepBack)
  }, [])

  /** Commit the card first; slow or unavailable graph expansion must not hide the definition. */
  const reveal = useCallback(async (found: Word, controller: AbortController, append: boolean, showCard: boolean, pendingMap: Promise<Related | undefined>) => {
    if (controller.signal.aborted) return
    if (current.current.word && current.current.activeId !== found.word_id) {
      const stack = undo.current
      stack.entries = [...stack.entries.slice(0, stack.cursor + 1), current.current].slice(-40)
      stack.cursor = stack.entries.length - 1
    }
    /** REQ-UX-030: the card is committed immediately, independently of map work. */
    const commit = () => {
      setWord(found); setRelated(undefined); setActiveId(found.word_id); setCardOpen(showCard)
      setPath(previous => append ? previous.includes(found.word_id) ? previous.slice(0, previous.indexOf(found.word_id) + 1) : [...previous, found.word_id] : [found.word_id])
      setNetwork(previous => expandNetwork(append ? previous : { nodes: [], links: [] }, found))
      if (!append) setGeneration(value => value + 1)
    }
    if (append) commit()
    else viewTransition(commit)
    try {
      setProgress('graph')
      const map = await pendingMap
      if (controller.signal.aborted) return
      if (!map) { setMapError(true); return }
      setRelated(map); setNetwork(previous => expandNetwork(previous, found, map))
    } catch {
      if (!controller.signal.aborted) setMapError(true)
    }
  }, [])

  /** Resolve graph clicks by stable ID and preserve the explored path instead of navigating away. */
  const openWord = useCallback(async (key: string, append = true, showCard = true) => {
    operation.current?.abort()
    const controller = new AbortController(); operation.current = controller
    setBusy(true); setError(''); setMapError(false)
    setProgress('searching')
    try {
      /** Both endpoints accept a stable ID or headword; map failure never rejects the card. */
      const pendingMap = api<Related>(relatedPath(key, steer.current.word, steer.current.weight), undefined, controller.signal).catch(() => undefined)
      const found = await api<Word>(`/words/${encodeURIComponent(key)}`, undefined, controller.signal)
      await reveal(found, controller, append, showCard, pendingMap)
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'เปิดข้อมูลคำไม่ได้ กรุณาลองอีกครั้ง')
    } finally { if (!controller.signal.aborted) { setBusy(false); setProgress('') } }
  }, [reveal])

  /** A single hybrid endpoint handles words and reverse-dictionary descriptions with identical transitions. */
  async function search(value: string) {
    if (!validQuery(value, limit)) {
      setError(value.trim() ? `พิมพ์ได้ไม่เกิน ${limit} ตัวอักษร` : 'พิมพ์คำ หรืออธิบายความหมายที่ต้องการค้นหา')
      return
    }
    operation.current?.abort()
    const controller = new AbortController(); operation.current = controller
    setQuery(value); setBusy(true); setProgress('understanding'); setResults(undefined); setError(''); setMapError(false)
    try {
      /** Paint local description preparation before sending the retrieval request; no fake server stages. */
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (controller.signal.aborted) return
      setProgress('searching')
      const found = await api<SearchResults>('/search', { query: value.trim(), limit: 10 }, controller.signal)
      if (controller.signal.aborted) return
      setResults(found); setHistory(previous => [value.trim(), ...previous.filter(item => item !== value.trim())].slice(0, 4))
      if (found.candidates.length) {
        if (mode === 'compare') { addComparison(found.candidates[0].word); return }
        const pendingMap = api<Related>(relatedPath(found.candidates[0].word_id, steer.current.word, steer.current.weight), undefined, controller.signal).catch(() => undefined)
        const selected = await api<Word>(`/words/${encodeURIComponent(found.candidates[0].word_id)}`, undefined, controller.signal)
        await reveal(selected, controller, false, true, pendingMap)
      }
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'ค้นหาไม่ได้ กรุณาลองอีกครั้ง')
    } finally { if (!controller.signal.aborted) { setBusy(false); setProgress('') } }
  }

  useEffect(() => {
    if (request?.compare) { setCompareSeed([...new Set(request.compare.map(term => term.trim()).filter(Boolean))]); setMode('compare'); setCardOpen(true) }
    else { setMode('search'); void openWord(request?.term || 'คำ', false, true); if (request?.term) setQuery(request.term) }
    return () => operation.current?.abort()
  }, [request, openWord])

  useEffect(() => {
    if (!intro) return
    try { sessionStorage.setItem('khamlink.intro.v1', '1') } catch { /* Session storage is optional. */ }
    const timer = setTimeout(() => setIntro(false), 4500)
    return () => clearTimeout(timer)
  }, [intro])

  /** Moving the slider re-forms the neighbourhood around the same centre — the point of
      REQ-UX-021 is that you steer without re-typing the query. Debounced so a drag is one
      request, not thirty. */
  const lastSteer = useRef('|0')
  useEffect(() => {
    // Keyed on the steering values rather than a "skip the first run" flag: the initial key
    // matches the initial state, so mount is a no-op and StrictMode's second invocation
    // cannot fire a redundant request.
    const key = `${steerWord.trim()}|${steerWeight}`
    if (key === lastSteer.current) return
    lastSteer.current = key
    if (!current.current.word) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      // Resolve the centre when the request actually goes out, not when the slider moved,
      // and join the shared abort chain so a node click and a steer cannot both be in
      // flight. The identity re-check closes the remaining window: without it a steer for
      // word A can resolve after a click has committed word B and pin A's neighbours under
      // B's headword — attributing one entry's model-derived words to another.
      const centre = current.current.word
      if (!centre) return
      operation.current?.abort(); operation.current = controller
      api<Related>(relatedPath(centre.word_id, steerWord, steerWeight), undefined, controller.signal)
        .then(map => {
          if (controller.signal.aborted || current.current.word?.word_id !== centre.word_id) return
          // Replace the neighbourhood but keep the explored path: steering changes which
          // words surround this one, it does not undo how you got here, so the breadcrumb
          // must survive it.
          const { network: live, path: trail } = current.current
          const base: Network = {
            nodes: live.nodes.filter(node => trail.includes(node.id)),
            links: live.links.filter(link => trail.includes(link.source) && trail.includes(link.target)),
          }
          setRelated(map); setNetwork(expandNetwork(base, centre, map)); setGeneration(value => value + 1)
        })
        .catch(() => { /* Steering is an enhancement; the unsteered graph stays on screen. */ })
    }, 280)
    return () => { clearTimeout(timer); controller.abort() }
  }, [steerWord, steerWeight])

  /** The steering control lives in the search panel, so leaving search mode would strand a
      bias the user can no longer see or clear. Drop it with the mode. */
  useEffect(() => { if (mode !== 'search') { setSteerWord(''); setSteerWeight(0) } }, [mode])

  /** Reset creates a fresh language constellation while keeping previous query shortcuts available. */
  function reset() {
    setQuery(''); setResults(undefined); setCardOpen(false); void openWord('คำ', false, false)
  }

  /** Exploration actions share the graph path whether activated from a node or a card. */
  function explore(term: string) { setMode('search'); void openWord(term) }

  /** REQ-UX-024: the dock owns comparison entries; resolved headwords prevent duplicate aliases. */
  function addComparison(term: string) {
    setCompareSeed(previous => previous.includes(term) ? previous : [...previous, term])
    setQuery(''); setResults(undefined); setCardOpen(true)
  }

  /** The same input and suggestions route to the selected mode without remounting the field. */
  function choose(candidate: Candidate) {
    if (mode === 'compare') addComparison(candidate.word)
    else { setQuery(candidate.word); setResults(undefined); void openWord(candidate.word_id, false) }
  }

  /** Return keyboard focus to the graph when its inspector closes. */
  function closeCard() {
    setCardOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.graph-node[aria-pressed="true"]')?.focus())
  }

  return (
    <main id="discover-main" className={`discover${intro ? ' discover-entering' : ''}${cardOpen ? ' has-inspector' : ''}${mode === 'compare' ? ' is-comparing' : ''}`} tabIndex={-1}>
      <h1 className="sr-only">สำรวจคำและความหมาย</h1>
      {/* The opening is the graph arriving, and nothing else. The previous full-viewport
          scrim and slogan card dimmed the header, panel and dock the user had come to use,
          which read as a loading failure rather than a flourish. */}
      <section className="discover-stage" aria-label="สำรวจเครือข่ายคำ">
        <SemanticGraph nodes={network.nodes} links={network.links} activeId={activeId} path={path} onSelect={node => { setMode('search'); if (node.id === 'seed') void openWord('คำ'); else void openWord(node.id) }} busy={busy} intro={intro} onReset={reset} generation={generation} />
      </section>
      <aside className={`discover-inspector ${cardOpen ? 'is-open' : ''}`} aria-label="ข้อมูลคำที่เลือก">
        <div className="suggestion-host" ref={setSuggestionHost} />
        {results && results.candidates.length > 0 && <section className="search-results" aria-label="ผลการค้นหา"><div className="results-heading"><span className="lab-overline">ผลการค้นหา</span><span>{results.candidates.length} คำ{results.has_more ? ' · แสดงผลอันดับแรก' : ''}</span><button onClick={() => setResults(undefined)} aria-label="ปิดผลการค้นหา">×</button></div><div className="result-words">{results.candidates.map((candidate, index) => <button key={candidate.word_id} data-match={candidate.match_type} className={activeId === candidate.word_id ? 'is-selected' : ''} onClick={() => choose(candidate)}><span className="result-index">{String(index + 1).padStart(2, '0')}</span><strong>{candidate.word}</strong><p>{readableText(candidate.description)}</p><span className="result-kind">{candidate.match_type === 'exact' ? '● ตรงคำ' : candidate.match_type === 'semantic' ? '◇ ใกล้ความหมาย · AI' : '◐ คำใกล้เคียง'} <i>↗</i></span></button>)}</div></section>}
        {/* Both modes read from the same dock, but they are not the same panel: one reads a
            single entry top to bottom, the other lines several up side by side. Sharing a
            component here is what produced a comparison table squeezed into a ⅓ column. */}
        {mode === 'search' ? word ? <><button className="mobile-panel-toggle" onClick={() => setCardOpen(!cardOpen)} aria-expanded={cardOpen}>{word.word} · {cardOpen ? 'ย่อความหมาย ↓' : 'ดูความหมาย ↑'}</button><div className="dictionary-content"><WordCard word={word} related={related} onExplore={explore} />
          {/* The steering control belongs beside the neighbours it re-ranks. On the dock it
              expanded downward into the footer and pushed the search box off-screen. */}
          <SteerControl word={steerWord} weight={steerWeight} onWord={setSteerWord} onWeight={setSteerWeight} state={related?.steer_state} applied={related?.steer?.word} />
          <div className="inspector-actions"><button onClick={() => { setCompareSeed([word.word]); setMode('compare'); setCardOpen(true) }}>เปรียบเทียบคำนี้ ⇄</button><button onClick={onWrite}>ไปเขียนต่อ ↗</button></div></div></> : <p role="status">กำลังเปิดพจนานุกรม…</p>
          : <ComparisonWorkspace seed={compareSeed} onExplore={explore} />}
      </aside>
      <section className={`search-dock${mode === 'compare' ? ' search-dock-compare' : ''}`} aria-label="ค้นหาและเปรียบเทียบคำ">
        <div className="mode-row"><div className="search-mode" role="group" aria-label="รูปแบบการค้นหา" onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'search' : event.key === 'End' ? 'compare' : mode === 'search' ? 'compare' : 'search'; setMode(next); setCardOpen(true); event.currentTarget.querySelectorAll('button')[next === 'search' ? 0 : 1]?.focus() } }}><button className={mode === 'search' ? 'is-active' : ''} aria-pressed={mode === 'search'} onClick={() => setMode('search')}><span>↗</span> ค้นหาคำ</button><button className={mode === 'compare' ? 'is-active' : ''} aria-pressed={mode === 'compare'} onClick={() => { setMode('compare'); setCardOpen(true) }}><span>⇄</span> เปรียบเทียบ</button><i className={mode === 'compare' ? 'mode-slider mode-right' : 'mode-slider'} /></div>{mode === 'compare' && (compareSeed.length
          ? <div className="comparison-chips" aria-label="คำที่เลือกเปรียบเทียบ">{compareSeed.map(term => <button key={term} aria-label={`นำ ${term} ออกจากการเปรียบเทียบ`} onClick={() => setCompareSeed(previous => previous.filter(item => item !== term))}>{term} <span aria-hidden="true">×</span></button>)}</div>
          : <span className="mode-caption">ยังไม่ได้เลือกคำ</span>)}
          {/* Staged progress sits on the mode row rather than under the field: below the
              box it pushed the dock taller mid-query and shifted the graph under it. */}
          {busy && <p className="search-progress" role="status" data-stage={progress}>{progress === 'understanding' ? 'กำลังเตรียมคำอธิบายเพื่อค้นหาความหมาย…' : progress === 'graph' ? 'กำลังสร้างเครือข่ายคำ · อ่านความหมายได้แล้ว' : 'กำลังค้นหาคำและความหมาย…'}</p>}</div>
        <DiscoverSearch query={query} onQuery={setQuery} onSearch={value => void search(value)} onChoose={choose} busy={busy} limit={limit} suggestionHost={suggestionHost} mode={mode} />
        <>
          {error && <div className="lab-alert" role="alert"><p>{error}</p><button onClick={() => void search(query)}>ลองอีกครั้ง ↗</button></div>}
          {mapError && <div className="lab-alert" role="status"><p>ยังโหลดคำเชื่อมโยงไม่ได้ ความหมายยังอ่านได้ตามปกติ</p><button onClick={() => word && void openWord(word.word_id)}>โหลดเครือข่ายอีกครั้ง ↗</button></div>}
          {results?.degraded && <p className="lab-notice" role="status">{degradedMessage(results.degraded_reason)}</p>}
          {!busy && results && !results.candidates.length && <div className="search-empty" role="status"><strong>ยังไม่พบคำที่ตรงกับความหมายนี้</strong><p>ลองใช้คำอธิบายสั้นลง หรือเริ่มจากคำใกล้เคียง</p></div>}
          {!results && <div className="try-search"><span>ลองค้นพบ</span>{['คนไข้', 'ความสุข', 'คำที่หมายถึงรักษาของเดิมไว้'].map(term => <button key={term} onClick={() => void search(term)}>{term} <span>↗</span></button>)}</div>}
          {history.length > 0 && <div className="search-history"><span>เส้นทางที่ผ่านมา</span>{history.map(term => <button key={term} onClick={() => void search(term)}>{term}</button>)}</div>}
        </>
      </section>
      <footer className="discover-footer"><span>KhamLink <i>คำเชื่อมความคิด</i></span><p>ความหมายจากพจนานุกรม · ความเชื่อมโยงจากข้อมูลและ AI</p><span>TH / EN</span></footer>
      <span className="sr-only" role="status" aria-live="polite">{busy ? 'กำลังโหลดข้อมูลคำ' : word ? `กำลังสำรวจ ${word.word}` : ''}</span>
    </main>
  )
}
