import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, wordKeyFromHash } from './api'
import Discover, { type DiscoverRequest } from './Discover'
import Write from './Write'
import { PrivacyModal } from './Modals'
import * as store from './docs'
import type { Config } from './types'
import './styles.css'
import './lab.css'

/** Decode document links without allowing malformed fragments to crash the app. */
function documentId(hash: string): string | null {
  try { return hash.startsWith('#/doc/') ? decodeURIComponent(hash.slice(6)) : null }
  catch { return null }
}

/** Two destinations share one brand and a moving active marker. */
function TopNavigation({ writing, onWrite, onDiscover, onPrivacy }: {
  writing: boolean; onWrite: () => void; onDiscover: () => void; onPrivacy: () => void
}) {
  return <header className="lab-header">
    <a href="#/" className="lab-brand" onClick={onDiscover} aria-label="KhamLink Discover"><span className="lab-brand-symbol" aria-hidden="true"><i /><i /><i /><i /></span><span>Kham<span>Link</span><small>คำเชื่อมความคิด</small></span></a>
    <nav className={`lab-nav${writing ? ' nav-writing' : ''}`} aria-label="เมนูหลัก"><button aria-current={!writing ? 'page' : undefined} onClick={onDiscover}>Discover<span>↗</span></button><button aria-current={writing ? 'page' : undefined} onClick={onWrite}>Write<span>↗</span></button><i /></nav>
    <button className="lab-about" onClick={onPrivacy}><span className="lab-live-dot" /><span>ภาษาไทย เชื่อมถึงกัน</span><span className="about-icon">i</span></button>
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
  const writing = route.startsWith('#/write') || route.startsWith('#/doc/')
  const docId = documentId(route)

  useEffect(() => {
    /** Preserve browser back/forward and existing direct links. */
    const navigate = () => {
      setRoute(location.hash)
      const term = wordKeyFromHash(location.hash)
      if (term) setRequest({ term, key: Date.now() })
    }
    addEventListener('hashchange', navigate)
    return () => removeEventListener('hashchange', navigate)
  }, [])
  useEffect(() => { const controller = new AbortController(); api<Config>('/config', undefined, controller.signal).then(setConfig).catch(() => undefined); return () => controller.abort() }, [])
  useEffect(() => { store.save(docs) }, [docs])
  useEffect(() => { document.documentElement.dataset.theme = 'light' }, [])

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
