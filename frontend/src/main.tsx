import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, viewTransition, wordKeyFromHash } from './api'
import Discover, { type DiscoverRequest } from './Discover'
import Write from './Write'
import { PrivacyModal } from './Modals'
import * as store from './docs'
import type { Config } from './types'
import './styles.css'
import './lab.css'
import './redesign.css'

/** Decode document links without allowing malformed fragments to crash the app. */
function documentId(hash: string): string | null {
  try { return hash.startsWith('#/doc/') ? decodeURIComponent(hash.slice(6)) : null }
  catch { return null }
}

/** Light, dark, or whatever the OS says — stored only when the user states a preference,
    so an unset choice keeps following the system instead of freezing on first visit. */
type Theme = 'light' | 'dark' | 'system'
function readTheme(): Theme {
  try { const saved = localStorage.getItem('khamlink.theme'); return saved === 'light' || saved === 'dark' ? saved : 'system' } catch { return 'system' }
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const follow = () => setSystemDark(query.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  useEffect(() => {
    /** The palette lives behind `[data-theme]`, so "system" is resolved here rather than
        duplicated as a second `prefers-color-scheme` copy of every token. */
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { theme === 'system' ? localStorage.removeItem('khamlink.theme') : localStorage.setItem('khamlink.theme', theme) }
    catch { /* Private browsing keeps the choice for this session only. */ }
  }, [theme, dark])
  /* Drawn rather than typed: ☀/☾ sit on the text baseline, so they never centre in a round
     button whatever the line-height, and Windows renders ☀ as a colour emoji. */
  return <button className="lab-theme" aria-pressed={dark} aria-label={dark ? 'ใช้ธีมสว่าง' : 'ใช้ธีมมืด'} title={dark ? 'ใช้ธีมสว่าง' : 'ใช้ธีมมืด'}
    onClick={() => setTheme(dark ? 'light' : 'dark')}>
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      {dark
        ? <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.4v2.4M12 19.2v2.4M2.4 12h2.4M19.2 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" /></>
        : <path d="M20.2 14.6A8.6 8.6 0 1 1 9.4 3.8a6.9 6.9 0 0 0 10.8 10.8Z" strokeLinejoin="round" />}
    </svg>
  </button>
}

/** Two destinations share one brand and a moving active marker. */
function TopNavigation({ writing, onWrite, onDiscover, onPrivacy }: {
  writing: boolean; onWrite: () => void; onDiscover: () => void; onPrivacy: () => void
}) {
  return <header className="lab-header">
    <a href="#/" className="lab-brand" onClick={onDiscover} aria-label="KhamLink Discover — ผู้ช่วยด้านภาษาไทยที่ช่วยให้ทุกความคิดเจอคำที่ใช่"><span className="lab-brand-symbol" aria-hidden="true"><i /><i /><i /><i /></span><span>Kham<span>Link</span><small title="ผู้ช่วยด้านภาษาไทยที่ช่วยให้ทุกความคิดเจอคำที่ใช่">ผู้ช่วยด้านภาษาไทยที่ช่วยให้ทุกความคิดเจอคำที่ใช่</small></span></a>
    <nav className={`lab-nav${writing ? ' nav-writing' : ''}`} aria-label="เมนูหลัก"><button aria-current={!writing ? 'page' : undefined} onClick={onDiscover}>Discover<span>↗</span></button><button aria-current={writing ? 'page' : undefined} onClick={onWrite}>Write<span>↗</span></button><i /></nav>
    <div className="lab-header-end"><ThemeToggle /><button className="lab-about" onClick={onPrivacy}><span className="lab-live-dot" /><span>ภาษาไทย เชื่อมถึงกัน</span><span className="about-icon">i</span></button></div>
  </header>
}

/** Keep saved documents compatible and retain Discover while switching to Write. */
function App() {
  const [docs, setDocs] = useState<store.Doc[]>(() => store.load())
  const [route, setRoute] = useState(location.hash)
  const [config, setConfig] = useState<Config>()
  const [privacy, setPrivacy] = useState(false)
  const [request, setRequest] = useState<DiscoverRequest | undefined>(() => {
    const term = wordKeyFromHash(location.hash)
    return term ? { term, key: 0 } : undefined
  })
  const [removed, setRemoved] = useState<store.Doc>()
  const loaded = useRef(false)
  const writing = route.startsWith('#/write') || route.startsWith('#/doc/')
  const docId = documentId(route)

  useEffect(() => {
    /** Preserve browser back/forward and existing direct links. */
    const navigate = () => {
      const update = () => {
        setRoute(location.hash)
        const term = wordKeyFromHash(location.hash)
        if (term) setRequest({ term, key: Date.now() })
      }
      viewTransition(update)
    }
    addEventListener('hashchange', navigate)
    return () => removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => { const controller = new AbortController(); api<Config>('/config', undefined, controller.signal).then(setConfig).catch(() => undefined); return () => controller.abort() }, [])
  const writer = useRef(store.debouncedSave())
  useEffect(() => {
    /** Mount would otherwise write back exactly what load() just read. */
    if (loaded.current) writer.current.queue(docs)
    loaded.current = true
  }, [docs])
  useEffect(() => {
    /** Flush whatever is still queued before the tab can be discarded. `pagehide` and the
        hidden `visibilitychange` are the only signals a mobile browser reliably delivers
        before tearing a page down; `beforeunload` is not. */
    const save = () => writer.current.flush()
    const onHidden = () => { if (document.visibilityState === 'hidden') save() }
    addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onHidden)
    return () => { removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', onHidden); save() }
  }, [])
  useEffect(() => {
    if (!removed || !writing) return
    const undoDelete = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey || (event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault(); setDocs(previous => [removed, ...previous]); setRemoved(undefined)
    }
    addEventListener('keydown', undoDelete)
    return () => removeEventListener('keydown', undoDelete)
  }, [removed, writing])

  /** Open the most recent document, or invite a fresh one. */
  function openWrite() { location.hash = docs[0] ? `#/doc/${docs[0].id}` : '#/write' }
  /** Create only after an explicit writing action. */
  function createDoc() { const doc = store.create(); setDocs(previous => [doc, ...previous]); location.hash = `#/doc/${doc.id}` }
  /** Update the existing anonymous document records. */
  function patchDoc(id: string, patch: Partial<store.Doc>) { setDocs(previous => previous.map(doc => doc.id === id ? { ...doc, ...patch, updated: Date.now() } : doc)) }
  /** Deletion remains reversible in this session. */
  function deleteDoc(id: string) { setRemoved(docs.find(doc => doc.id === id)); setDocs(previous => previous.filter(doc => doc.id !== id)); location.hash = '#/write' }
  /** Explore selected text without changing the document body. */
  function explore(term: string) { setRequest({ term, key: Date.now() }); location.hash = '#/'; window.scrollTo({ top: 0 }) }
  /** Carry selected words into the shared comparison workspace. */
  function compare(terms: string[]) { setRequest({ compare: terms, key: Date.now() }); location.hash = '#/'; window.scrollTo({ top: 0 }) }

  return <div className="language-lab">
    <a className="skip-link" href={writing ? '#write-main' : '#discover-main'} onClick={event => { event.preventDefault(); document.getElementById(writing ? 'write-main' : 'discover-main')?.focus() }}>ข้ามไปเนื้อหาหลัก</a>
    <TopNavigation writing={writing} onWrite={openWrite} onDiscover={() => { location.hash = '#/' }} onPrivacy={() => setPrivacy(true)} />
    <div hidden={writing}><Discover config={config} request={request} onWrite={openWrite} /></div>
    {writing && <main id="write-main" tabIndex={-1}><Write docs={docs} docId={docId} onCreate={createDoc} onOpen={id => { location.hash = `#/doc/${id}` }} onChange={patchDoc} onDelete={deleteDoc} onExplore={explore} onCompare={compare} /></main>}
    {removed && <div className="toast" role="status">ลบ “{removed.title}” แล้ว <button onClick={() => { setDocs(previous => [removed, ...previous]); setRemoved(undefined) }}>เลิกทำ</button><button aria-label="ปิดข้อความ" onClick={() => setRemoved(undefined)}>×</button></div>}
    {privacy && <PrivacyModal config={config} onClose={() => setPrivacy(false)} />}
  </div>
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
