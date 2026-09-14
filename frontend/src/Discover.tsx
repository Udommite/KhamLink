import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import ComparisonWorkspace from './ComparisonWorkspace'
import SemanticGraph from './SemanticGraph'
import WordCard from './WordCard'
import { expandNetwork, readableText, validQuery, type Network } from './discovery-data'
import type { Candidate, Config, Related, SearchResults, Word } from './types'
import { flushSync } from 'react-dom'

export interface DiscoverRequest { term?: string; compare?: string[]; key: number }
interface Props { config?: Config; request?: DiscoverRequest; onWrite: () => void }

/** The search control keeps exact and semantic suggestions in one keyboard-operable list. */
function DiscoverSearch({ query, onQuery, onSearch, onChoose, busy, limit }: {
  query: string; onQuery: (query: string) => void; onSearch: (query: string) => void
  onChoose: (candidate: Candidate) => void; busy: boolean; limit: number
}) {
  const [suggestions, setSuggestions] = useState<Candidate[]>([])
  const [suggesting, setSuggesting] = useState(false)
  const [focused, setFocused] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const composing = useRef(false)
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
    }, 450)
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
    if (composing.current) return
    setDismissed(true)
    if (show && cursor >= 0) onChoose(suggestions[cursor])
    else onSearch(query)
  }

  return (
    <form className={`discover-search${busy ? ' is-searching' : ''}`} role="search" onSubmit={event => { event.preventDefault(); submit() }}>
      <label htmlFor="discover-query" className="search-prompt">เริ่มจากคำหนึ่งคำ หรือความหมายที่คุณนึกถึง</label>
      <div className="search-line">
        <span className="search-node" aria-hidden="true"><i /></span>
        <input id="discover-query" ref={field} value={query} onChange={event => { onQuery(event.target.value); setDismissed(false) }}
          onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setCursor(-1) }}
          onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
          placeholder="พิมพ์คำ หรือเล่าความหมายที่กำลังหา…" autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded={show} aria-controls={show ? 'search-suggestions' : undefined}
          aria-activedescendant={show && cursor >= 0 ? `suggestion-${cursor}` : undefined} aria-describedby="search-help"
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') { setDismissed(true); setCursor(-1) }
            if (show && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
              event.preventDefault()
              setCursor(previous => (previous + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
            }
          }} />
        {query && <button className="search-clear" type="button" aria-label="ล้างคำค้น" onClick={() => { onQuery(''); field.current?.focus() }}>×</button>}
        <button className="search-submit" type="submit" disabled={busy} aria-label="ค้นหาคำ"><span>{busy ? 'กำลังค้นหา' : 'ค้นพบคำ'}</span>{busy ? <i className="lab-spinner" /> : <span aria-hidden="true">↗</span>}</button>
      </div>
      <div className="search-foot"><span id="search-help">ค้นจากคำ · ความหมาย · บริบท</span><span>{suggesting ? 'กำลังหาคำแนะนำ…' : <><kbd>/</kbd> เพื่อเริ่มค้นหา</>}</span></div>
      {show && <ul className="search-suggestions" id="search-suggestions" role="listbox" aria-label="คำแนะนำจากพจนานุกรม">
        {suggestions.map((candidate, index) => <li key={candidate.word_id} id={`suggestion-${index}`} role="option" aria-selected={cursor === index}
          onPointerDown={event => event.preventDefault()} onClick={() => { setDismissed(true); onChoose(candidate) }} onPointerEnter={() => setCursor(index)}>
          <div><strong>{candidate.word}</strong><span>{readableText(candidate.description)}</span></div><small>{candidate.match_type === 'exact' ? 'ตรงคำ' : candidate.match_type === 'partial' ? 'คำใกล้เคียง' : 'ใกล้ความหมาย'} ↗</small>
        </li>)}
      </ul>}
    </form>
  )
}

/** Discover evolves one live graph in place; requests are abortable and dictionary data survives map failure. */
export default function Discover({ config, request, onWrite }: Props) {
  const [mode, setMode] = useState<'search' | 'compare'>('search')
  const [compareSeed, setCompareSeed] = useState<string[]>()
  const [query, setQuery] = useState('')
  const [network, setNetwork] = useState<Network>({ nodes: [{ id: 'seed', word: 'คำ' }], links: [] })
  const [activeId, setActiveId] = useState('seed')
  const [path, setPath] = useState<string[]>([])
  const [word, setWord] = useState<Word>()
  const [related, setRelated] = useState<Related>()
  const [cardOpen, setCardOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<SearchResults>()
  const [error, setError] = useState('')
  const [mapError, setMapError] = useState(false)
  const [intro, setIntro] = useState(() => {
    try { return !sessionStorage.getItem('khamlink.intro.v1') && !matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
  })
  const [generation, setGeneration] = useState(0)
  const [collapsing, setCollapsing] = useState(false)
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
      setNetwork(saved.network); setActiveId(saved.activeId); setPath(saved.path); setWord(saved.word); setRelated(saved.related); setQuery(saved.query); setResults(saved.results); setBusy(false); setCollapsing(false); setError(''); setCardOpen(true)
    }
    addEventListener('keydown', stepBack)
    return () => removeEventListener('keydown', stepBack)
  }, [])

  /** Commit the card first; slow or unavailable graph expansion must not hide the definition. */
  const reveal = useCallback(async (found: Word, controller: AbortController, append: boolean, showCard: boolean) => {
    if (controller.signal.aborted) return
    if (current.current.word && current.current.activeId !== found.word_id) {
      const stack = undo.current
      stack.entries = [...stack.entries.slice(0, stack.cursor + 1), current.current].slice(-40)
      stack.cursor = stack.entries.length - 1
    }
    if (!append && current.current.word && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCollapsing(true)
      await new Promise(resolve => setTimeout(resolve, 180))
      if (controller.signal.aborted) { setCollapsing(false); return }
    }
    const commit = () => {
      setWord(found); setRelated(undefined); setActiveId(found.word_id); setCardOpen(showCard)
      setPath(previous => append ? previous.includes(found.word_id) ? previous.slice(0, previous.indexOf(found.word_id) + 1) : [...previous, found.word_id] : [found.word_id])
      setNetwork(previous => expandNetwork(append ? previous : { nodes: [], links: [] }, found))
      if (!append) setGeneration(value => value + 1)
      setCollapsing(false)
    }
    if (!append && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(() => flushSync(commit))
    else commit()
    try {
      const map = await api<Related>(`/words/${encodeURIComponent(found.word_id)}/related`, undefined, controller.signal)
      if (controller.signal.aborted) return
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
    try {
      const found = await api<Word>(`/words/${encodeURIComponent(key)}`, undefined, controller.signal)
      await reveal(found, controller, append, showCard)
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'เปิดข้อมูลคำไม่ได้ กรุณาลองอีกครั้ง')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }, [reveal])

  /** A single hybrid endpoint handles words and reverse-dictionary descriptions with identical transitions. */
  async function search(value: string) {
    if (!validQuery(value, limit)) {
      setError(value.trim() ? `พิมพ์ได้ไม่เกิน ${limit} ตัวอักษร` : 'พิมพ์คำ หรืออธิบายความหมายที่ต้องการค้นหา')
      return
    }
    operation.current?.abort()
    const controller = new AbortController(); operation.current = controller
    setQuery(value); setBusy(true); setError(''); setMapError(false); setCardOpen(false)
    try {
      const found = await api<SearchResults>('/search', { query: value.trim(), limit: 10 }, controller.signal)
      if (controller.signal.aborted) return
      setResults(found); setHistory(previous => [value.trim(), ...previous.filter(item => item !== value.trim())].slice(0, 4))
      if (found.candidates.length) {
        const selected = await api<Word>(`/words/${encodeURIComponent(found.candidates[0].word_id)}`, undefined, controller.signal)
        await reveal(selected, controller, false, true)
      }
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem instanceof Error ? problem.message : 'ค้นหาไม่ได้ กรุณาลองอีกครั้ง')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  useEffect(() => {
    if (request?.compare) { setCompareSeed(request.compare); setMode('compare') }
    else { setMode('search'); void openWord(request?.term || 'คำ', false, Boolean(request?.term)); if (request?.term) setQuery(request.term) }
    return () => operation.current?.abort()
  }, [request, openWord])

  useEffect(() => {
    if (!intro) return
    try { sessionStorage.setItem('khamlink.intro.v1', '1') } catch { /* Session storage is optional. */ }
    const timer = setTimeout(() => setIntro(false), 1800)
    return () => clearTimeout(timer)
  }, [intro])

  /** Reset creates a fresh language constellation while keeping previous query shortcuts available. */
  function reset() {
    setQuery(''); setResults(undefined); setCardOpen(false); void openWord('คำ', false, false)
  }

  /** Exploration actions share the graph path whether activated from a node or a card. */
  function explore(term: string) { setMode('search'); void openWord(term) }

  /** Return keyboard focus to the graph when its inspector closes. */
  function closeCard() {
    setCardOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.graph-node[aria-pressed="true"]')?.focus())
  }

  return (
    <main id="discover-main" className={`discover${intro ? ' discover-entering' : ''}${cardOpen ? ' has-inspector' : ''}${collapsing ? ' is-collapsing' : ''}`} tabIndex={-1}>
      <h1 className="sr-only">สำรวจคำและความหมาย</h1>
      {intro && <div className="intro-slogan">ผู้ช่วยด้านภาษาไทยที่ช่วยให้ทุกความคิดเจอคำที่ใช่</div>}
      <section className="discover-stage" aria-label="สำรวจเครือข่ายคำ">
        <SemanticGraph nodes={network.nodes} links={network.links} activeId={activeId} path={path} onSelect={node => { setMode('search'); if (node.id === 'seed') void openWord('คำ'); else void openWord(node.id) }} busy={busy} intro={intro} onReset={reset} generation={generation} />
      </section>
      <aside className={`discover-inspector ${cardOpen ? 'is-open' : ''}`} aria-label="ข้อมูลคำที่เลือก">
        {mode === 'search' ? word ? <><button className="mobile-panel-toggle" onClick={() => setCardOpen(!cardOpen)} aria-expanded={cardOpen}>{word.word} · {cardOpen ? 'ย่อความหมาย ↓' : 'ดูความหมาย ↑'}</button><div className="dictionary-content"><WordCard word={word} related={related} onExplore={explore} /><div className="inspector-actions"><button onClick={() => { setCompareSeed([word.word, '']); setMode('compare'); setCardOpen(true) }}>เปรียบเทียบคำนี้ ⇄</button><button onClick={onWrite}>ไปเขียนต่อ ↗</button></div></div></> : <p role="status">กำลังเปิดพจนานุกรม…</p> : <ComparisonWorkspace seed={compareSeed} onExplore={explore} />}
      </aside>
      <section className={`search-dock${mode === 'compare' ? ' search-dock-compare' : ''}`} aria-label="ค้นหาและเปรียบเทียบคำ">
        <div className="mode-row"><div className="search-mode" role="group" aria-label="รูปแบบการค้นหา" onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'search' : event.key === 'End' ? 'compare' : mode === 'search' ? 'compare' : 'search'; setMode(next); setCardOpen(true); event.currentTarget.querySelectorAll('button')[next === 'search' ? 0 : 1]?.focus() } }}><button className={mode === 'search' ? 'is-active' : ''} aria-pressed={mode === 'search'} onClick={() => setMode('search')}><span>↗</span> ค้นหาคำ</button><button className={mode === 'compare' ? 'is-active' : ''} aria-pressed={mode === 'compare'} onClick={() => { setMode('compare'); setCardOpen(true) }}><span>⇄</span> เปรียบเทียบ</button><i className={mode === 'compare' ? 'mode-slider mode-right' : 'mode-slider'} /></div></div>
        <div hidden={mode !== 'search'}><DiscoverSearch query={query} onQuery={setQuery} onSearch={value => void search(value)} onChoose={candidate => { setQuery(candidate.word); setResults(undefined); void openWord(candidate.word_id, false) }} busy={busy} limit={limit} /></div>
        {mode === 'search' && <>
          {error && <div className="lab-alert" role="alert"><p>{error}</p><button onClick={() => void search(query)}>ลองอีกครั้ง ↗</button></div>}
          {mapError && <div className="lab-alert" role="status"><p>ยังโหลดคำเชื่อมโยงไม่ได้ ความหมายยังอ่านได้ตามปกติ</p><button onClick={() => word && void openWord(word.word_id)}>โหลดเครือข่ายอีกครั้ง ↗</button></div>}
          {results?.degraded && <p className="lab-notice" role="status">การค้นหาความหมายทำงานได้บางส่วน ลองค้นด้วยคำตรงตัวได้</p>}
          {!busy && results && !results.candidates.length && <div className="search-empty" role="status"><strong>ยังไม่พบคำที่ตรงกับความหมายนี้</strong><p>ลองใช้คำอธิบายสั้นลง หรือเริ่มจากคำใกล้เคียง</p></div>}
          {!results && <div className="try-search"><span>ลองค้นพบ</span>{['คนไข้', 'ความสุข', 'คำที่หมายถึงรักษาของเดิมไว้'].map(term => <button key={term} onClick={() => void search(term)}>{term} <span>↗</span></button>)}</div>}
          {results && results.candidates.length > 0 && <section className="search-results" aria-label="ผลการค้นหา"><div className="results-heading"><span className="lab-overline">FOUND IN LANGUAGE</span><span>{results.candidates.length} คำ{results.has_more ? ' · แสดงผลอันดับแรก' : ''}</span></div><div className="result-words">{results.candidates.map((candidate, index) => <button key={candidate.word_id} className={activeId === candidate.word_id ? 'is-selected' : ''} onClick={() => { setQuery(candidate.word); void openWord(candidate.word_id, false) }}><span className="result-index">{String(index + 1).padStart(2, '0')}</span><strong>{candidate.word}</strong><p>{readableText(candidate.description)}</p><span className="result-kind">{candidate.match_type === 'exact' ? 'ตรงคำ' : candidate.match_type === 'semantic' ? 'ใกล้ความหมาย · AI' : 'คำใกล้เคียง'} <i>↗</i></span></button>)}</div></section>}
          {history.length > 0 && <div className="search-history"><span>เส้นทางที่ผ่านมา</span>{history.map(term => <button key={term} onClick={() => void search(term)}>{term}</button>)}</div>}
        </>}
      </section>
      <footer className="discover-footer"><span>KhamLink <i>คำเชื่อมความคิด</i></span><p>ความหมายจากพจนานุกรม · ความเชื่อมโยงจากข้อมูลและ AI</p><span>TH / EN</span></footer>
      <span className="sr-only" role="status" aria-live="polite">{busy ? 'กำลังโหลดข้อมูลคำ' : word ? `กำลังสำรวจ ${word.word}` : ''}</span>
    </main>
  )
}
