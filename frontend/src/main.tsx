import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, track } from './api'
import Editor from './Editor'
import { BreakdownModal, GoalsModal, PrivacyModal, SourceModal } from './Modals'
import { CATEGORIES, ComparePanel, EntryPanel, FindPanel, ReviewPanel } from './Rail'
import * as store from './docs'
import { audienceLabels, countWords, excerpt, formalityLabels, isToday, when, type Doc } from './docs'
import type { Category, Config, Review, Source, Suggestion } from './types'
import './styles.css'

/* ---------------- icons (inline: four strokes beat a dependency) ---------------- */
const Icon = ({ d, filled = false }: { d: string; filled?: boolean }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
)
const PATHS = {
  docs: 'M6 3h8l5 5v13H6zM14 3v5h5',
  write: 'M4 20h16M6 16l10-10 3 3-10 10H6z',
  find: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  compare: 'M12 3v18M5 8l-3 4 3 4M19 8l3 4-3 4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sun: 'M12 4v2M12 18v2M4 12H2M22 12h-2M6 6L5 5M18 18l1 1M6 18l-1 1M18 6l1-1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M20 14a8 8 0 1 1-10-10 7 7 0 0 0 10 10z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  back: 'M15 19l-7-7 7-7',
}

/* ---------------- theme ---------------- */
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('khamlink.theme')
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* private window */ }
    return matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('khamlink.theme', theme) } catch { /* ignore */ }
  }, [theme])
  return [theme, () => setTheme(t => (t === 'light' ? 'dark' : 'light'))] as const
}

/* ---------------- dashboard ---------------- */
function Dashboard({ docs, onOpen, onCreate, onDelete, onDuplicate, onPrivacy, theme, toggleTheme, config }: {
  docs: Doc[]; onOpen: (id: string) => void; onCreate: () => void
  onDelete: (id: string) => void; onDuplicate: (id: string) => void
  onPrivacy: () => void; theme: string; toggleTheme: () => void; config?: Config
}) {
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const needle = query.trim().toLowerCase()
  const shown = needle ? docs.filter(d => (d.title + ' ' + d.body).toLowerCase().includes(needle)) : docs
  const groups: [string, Doc[]][] = [
    ['วันนี้', shown.filter(d => isToday(d.updated))],
    ['ก่อนหน้านี้', shown.filter(d => !isToday(d.updated))],
  ]

  return (
    <div className="dash">
      <nav className="dash-nav" aria-label="เมนูหลัก">
        <div className="brand"><span className="brand-mark" aria-hidden="true">คำ</span><span className="brand-name">KhamLink</span></div>
        <a href="#/" aria-current="page"><Icon d={PATHS.docs} />เอกสาร</a>
        <button className="nav-item" onClick={onCreate}><Icon d={PATHS.write} />เขียนงานใหม่</button>
        <div className="spacer" />
        <button className="nav-item" onClick={toggleTheme}><Icon d={theme === 'dark' ? PATHS.sun : PATHS.moon} />{theme === 'dark' ? 'ธีมสว่าง' : 'ธีมมืด'}</button>
        <button className="nav-item" onClick={onPrivacy}><Icon d={PATHS.shield} />ข้อมูลและความเป็นส่วนตัว</button>
      </nav>

      <main className="dash-main" id="main" tabIndex={-1}>
        <div className="dash-head">
          <h1>เอกสาร</h1>
          <button className="btn btn-primary" onClick={onCreate}>+ เขียนงานใหม่</button>
          <div className="search">
            <Icon d={PATHS.find} />
            <input className="field" value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นในเอกสารของคุณ" aria-label="ค้นในเอกสารของคุณ" />
          </div>
        </div>

        {!docs.length && (
          <div className="state" style={{ padding: '70px 20px' }}>
            <strong>เริ่มเขียนงานแรกของคุณ</strong>
            พิมพ์ภาษาไทยลงไป แล้วระบบจะช่วยหาคำที่ตรงความหมายกว่า จากพจนานุกรมฉบับราชบัณฑิตยสภา
            <p><button className="btn btn-primary" onClick={onCreate}>เขียนงานใหม่</button></p>
          </div>
        )}
        {docs.length > 0 && !shown.length && <div className="state">ไม่พบเอกสารที่ตรงกับ “{query}”</div>}

        {groups.filter(([, list]) => list.length).map(([label, list]) => (
          <section className="doc-group" key={label}>
            <h2>{label}</h2>
            <div className="doc-grid">
              {list.map(doc => (
                <div className="doc-card" key={doc.id}>
                  <span className="kind">{formalityLabels[doc.formality]}</span>
                  <div className="doc-menu">
                    <button className="btn btn-ghost btn-sm" aria-label={`ตัวเลือกของ ${doc.title}`} aria-expanded={menu === doc.id}
                      onClick={() => setMenu(menu === doc.id ? null : doc.id)}>···</button>
                    {menu === doc.id && (
                      <div className="menu-pop" role="menu">
                        <button role="menuitem" onClick={() => { setMenu(null); onOpen(doc.id) }}>เปิด</button>
                        <button role="menuitem" onClick={() => { setMenu(null); onDuplicate(doc.id) }}>ทำสำเนา</button>
                        <button role="menuitem" className="danger" onClick={() => { setMenu(null); onDelete(doc.id) }}>ลบ</button>
                      </div>
                    )}
                  </div>
                  <h3><a href={`#/doc/${doc.id}`} onClick={() => track('doc_opened', { id: doc.id })}>{doc.title || store.UNTITLED}</a></h3>
                  <p className="excerpt">{excerpt(doc) || 'ยังไม่มีข้อความ'}</p>
                  <p className="meta">แก้ไข{when(doc.updated)} · {countWords(doc.body)} คำ</p>
                </div>
              ))}
            </div>
          </section>
        ))}
        {config?.source_label && <p className="tiny" style={{ marginTop: 40 }}>{config.source_label}</p>}
      </main>
    </div>
  )
}

/* ---------------- workspace ---------------- */
type Tab = 'review' | 'find' | 'compare'

function Workspace({ doc, onChange, onBack, theme, toggleTheme, config, onPrivacy }: {
  doc: Doc; onChange: (patch: Partial<Doc>) => void; onBack: () => void
  theme: string; toggleTheme: () => void; config?: Config; onPrivacy: () => void
}) {
  const [review, setReview] = useState<Review>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const [dirty, setDirty] = useState(false)
  const [tab, setTab] = useState<Tab>('review')
  const [entry, setEntry] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [filter, setFilter] = useState<Set<Category>>(new Set(CATEGORIES.map(c => c.id)))
  const [selection, setSelection] = useState<{ start: number; end: number; text: string; tokenId: string | null } | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [modal, setModal] = useState<'goals' | 'breakdown' | null>(null)
  const [source, setSource] = useState<Source>()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [findSeed, setFindSeed] = useState('')
  const ticket = useRef(0)

  const analyze = useCallback(async () => {
    if (!doc.body.trim()) { setReview(undefined); setDirty(false); return }
    const mine = ++ticket.current
    setBusy(true); setError(null)
    try {
      const result = await api<Review>('/review', { text: doc.body, formality: doc.formality })
      if (mine !== ticket.current) return
      setReview(result); setDismissed(new Set()); setDirty(false)
      track('review_run', { count: result.suggestions.length })
    } catch (problem) {
      if (mine === ticket.current) setError(problem)
    } finally {
      if (mine === ticket.current) setBusy(false)
    }
  }, [doc.body, doc.formality])

  // Re-check when the goal changes, because the goal decides which register warnings fire.
  useEffect(() => { if (review) void analyze() /* eslint-disable-next-line */ }, [doc.formality])

  const visible = useMemo(
    () => review ? { ...review, suggestions: review.suggestions.filter(s => !dismissed.has(s.id)) } : undefined,
    [review, dismissed],
  )

  function accept(suggestion: Suggestion, word: string) {
    const characters = Array.from(doc.body)
    const next = [...characters.slice(0, suggestion.start), ...Array.from(word), ...characters.slice(suggestion.end)].join('')
    const shift = Array.from(word).length - (suggestion.end - suggestion.start)
    onChange({ body: next })
    // Keep the remaining cards pointing at the right characters instead of re-analysing
    // the whole document for one accepted word.
    setReview(current => current && {
      ...current,
      score: Math.min(100, current.score + 3),
      suggestions: current.suggestions
        .filter(s => s.id !== suggestion.id)
        .map(s => (s.start >= suggestion.end ? { ...s, start: s.start + shift, end: s.end + shift } : s)),
      tokens: current.tokens
        .filter(t => !(t.start >= suggestion.start && t.end <= suggestion.end))
        .map(t => (t.start >= suggestion.end ? { ...t, start: t.start + shift, end: t.end + shift } : t)),
    })
    setActiveId(null)
    setDirty(true)
  }

  function replaceSelection(word: string) {
    if (!selection) return
    const characters = Array.from(doc.body)
    onChange({ body: [...characters.slice(0, selection.start), ...Array.from(word), ...characters.slice(selection.end)].join('') })
    setSelection(null); setEntry(null); setDirty(true)
  }

  function insertAtEnd(word: string) {
    onChange({ body: doc.body + (doc.body && !doc.body.endsWith(' ') ? ' ' : '') + word })
    setDirty(true)
  }

  const openTab = (next: Tab) => { setTab(next); setEntry(null); setSheetOpen(true) }

  return (
    <div className="shell">
      <nav className="rail" aria-label="เมนูหลัก">
        <button className="rail-btn" onClick={onBack} aria-label="กลับไปหน้าเอกสาร"><Icon d={PATHS.back} /><span className="tip">เอกสารทั้งหมด</span></button>
        <button className="rail-btn" aria-pressed={tab === 'review' && !entry} onClick={() => openTab('review')}><Icon d={PATHS.write} /><span className="tip">ข้อเสนอแนะ</span></button>
        <button className="rail-btn" aria-pressed={tab === 'find'} onClick={() => openTab('find')}><Icon d={PATHS.find} /><span className="tip">หาคำจากความหมาย</span></button>
        <button className="rail-btn" aria-pressed={tab === 'compare'} onClick={() => openTab('compare')}><Icon d={PATHS.compare} /><span className="tip">เทียบสองคำ</span></button>
        <button className="rail-btn" onClick={() => setModal('breakdown')}><Icon d={PATHS.chart} /><span className="tip">สรุปข้อความ</span></button>
        <div className="spacer" />
        <button className="rail-btn" onClick={toggleTheme} aria-label="สลับธีม"><Icon d={theme === 'dark' ? PATHS.sun : PATHS.moon} /><span className="tip">{theme === 'dark' ? 'ธีมสว่าง' : 'ธีมมืด'}</span></button>
        <button className="rail-btn" onClick={onPrivacy} aria-label="ข้อมูลและความเป็นส่วนตัว"><Icon d={PATHS.shield} /><span className="tip">ความเป็นส่วนตัว</span></button>
      </nav>

      <div className="workspace">
        <header className="doc-head">
          <input className="doc-title" value={doc.title} aria-label="ชื่อเอกสาร"
            onChange={event => onChange({ title: event.target.value })}
            onBlur={event => { if (!event.target.value.trim()) onChange({ title: store.UNTITLED }) }} />
          <button className="btn" onClick={() => setModal('goals')}>{formalityLabels[doc.formality]}</button>
          <div className="score-chip"><b className="num">{visible ? visible.score : '–'}</b><span>คะแนน</span></div>
        </header>

        <div className="surface" id="main" tabIndex={-1}>
          <Editor
            value={doc.body}
            onChange={body => { onChange({ body }); setDirty(true) }}
            suggestions={visible?.suggestions || []}
            tokens={visible?.tokens || []}
            activeId={activeId}
            selection={selection}
            onActivate={id => { setActiveId(id); setTab('review'); setEntry(null); setSheetOpen(true) }}
            onSelect={range => {
              setSelection(range)
              if (range && range.text.trim()) { setEntry(range.text.trim()); setSheetOpen(true) }
              else setEntry(null)
            }}
            placeholder="เริ่มพิมพ์ภาษาไทยที่นี่ แล้วเลือกคำใดก็ได้เพื่อดูความหมายและคำใกล้เคียง"
          />
        </div>

        {/* The rail collapses to a sheet on narrow screens, so a failed review would
            otherwise fail silently. Say it where the writer is looking. */}
        {Boolean(error) && !sheetOpen && (
          <p className="alert" style={{ margin: '0 28px 12px' }} role="alert">
            {error instanceof Error ? error.message : 'ตรวจข้อความไม่สำเร็จ กรุณาลองอีกครั้ง'}
          </p>
        )}

        <div className="toolbar">
          <span className="count">{countWords(doc.body).toLocaleString('th-TH')} คำ</span>
          <span className="tiny">· {audienceLabels[doc.audience]}</span>
          <div className="spacer" />
          <button className="btn btn-sm" onClick={() => setModal('breakdown')}>สรุปข้อความ</button>
          <button className="btn btn-sm btn-primary" onClick={() => void analyze()} disabled={busy || !doc.body.trim()}>
            {busy ? 'กำลังตรวจ…' : 'ตรวจข้อความ'}
          </button>
        </div>
      </div>

      <aside className="side" data-open={String(sheetOpen)} aria-label="แผงช่วยเขียน">
        <div className="side-tabs" role="tablist">
          {([['review', 'ข้อเสนอแนะ'], ['find', 'หาคำ'], ['compare', 'เทียบคำ']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} className="side-tab" role="tab" aria-selected={tab === id && !entry} onClick={() => openTab(id)}>{label}</button>
          ))}
        </div>
        <div className="side-body">
          {entry ? (
            <>
              <button className="btn btn-sm btn-ghost" style={{ marginBottom: 10 }} onClick={() => setEntry(null)}>← กลับไปข้อเสนอแนะ</button>
              <EntryPanel term={entry} onSource={setSource} onReplace={replaceSelection} onSearch={value => { setEntry(null); setTab('find'); setSelection(null); setFindSeed(value) }} />
            </>
          ) : tab === 'review' ? (
            <ReviewPanel
              review={visible} busy={busy} error={error} activeId={activeId} filter={filter} onFilter={setFilter}
              onActivate={setActiveId} onAccept={accept} onDismiss={id => setDismissed(prev => new Set(prev).add(id))}
              onAnalyze={() => void analyze()} dirty={dirty && !!review}
            />
          ) : tab === 'find' ? (
            <FindPanel seed={findSeed} onInsert={word => (selection ? replaceSelection(word) : insertAtEnd(word))} onOpen={setEntry} />
          ) : (
            <ComparePanel seed={selection?.text.trim() || ''} onSource={setSource} />
          )}
        </div>
      </aside>

      {modal === 'breakdown' && <BreakdownModal review={visible} onClose={() => setModal(null)} />}
      {modal === 'goals' && (
        <GoalsModal formality={doc.formality} audience={doc.audience}
          onChange={next => onChange(next)} onClose={() => setModal(null)} />
      )}
      {source && <SourceModal source={source} config={config} onClose={() => setSource(undefined)} />}
    </div>
  )
}

/* ---------------- root ---------------- */
function App() {
  const [docs, setDocs] = useState<Doc[]>(() => store.load())
  const [route, setRoute] = useState(location.hash)
  const [config, setConfig] = useState<Config>()
  const [privacy, setPrivacy] = useState(false)
  const [toast, setToast] = useState<{ message: string; undo?: () => void } | null>(null)
  const [theme, toggleTheme] = useTheme()

  useEffect(() => {
    const onHash = () => setRoute(location.hash)
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => { api<Config>('/config').then(setConfig).catch(() => undefined) }, [])
  useEffect(() => { store.save(docs) }, [docs])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  const openId = route.startsWith('#/doc/') ? decodeURIComponent(route.slice(6)) : ''
  const current = docs.find(d => d.id === openId)

  function create() {
    const doc = store.create()
    setDocs(previous => [doc, ...previous])
    location.hash = `#/doc/${doc.id}`
  }
  function patch(id: string, changes: Partial<Doc>) {
    setDocs(previous => previous.map(d => (d.id === id ? { ...d, ...changes, updated: Date.now() } : d)))
  }
  function remove(id: string) {
    const victim = docs.find(d => d.id === id)
    if (!victim) return
    setDocs(previous => previous.filter(d => d.id !== id))
    setToast({ message: `ลบ “${victim.title || store.UNTITLED}” แล้ว`, undo: () => { setDocs(previous => [victim, ...previous]); setToast(null) } })
  }
  function duplicate(id: string) {
    const original = docs.find(d => d.id === id)
    if (!original) return
    setDocs(previous => [store.create({ ...original, id: undefined, title: `${original.title} (สำเนา)`, updated: Date.now() }), ...previous])
  }

  return (
    <>
      <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus() }}>ข้ามไปเนื้อหาหลัก</a>
      {current ? (
        <Workspace doc={current} onChange={changes => patch(current.id, changes)} onBack={() => { location.hash = '#/' }}
          theme={theme} toggleTheme={toggleTheme} config={config} onPrivacy={() => setPrivacy(true)} />
      ) : (
        <Dashboard docs={docs} onOpen={id => { location.hash = `#/doc/${id}` }} onCreate={create} onDelete={remove}
          onDuplicate={duplicate} onPrivacy={() => setPrivacy(true)} theme={theme} toggleTheme={toggleTheme} config={config} />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast.message}
          {toast.undo && <button onClick={toast.undo}>เลิกทำ</button>}
        </div>
      )}
      {privacy && <PrivacyModal config={config} onClose={() => setPrivacy(false)} />}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
