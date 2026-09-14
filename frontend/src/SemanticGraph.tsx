import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { isPathLink, layoutGraph, type GraphLink, type GraphNode } from './semantic-graph'
import './semantic-graph.css'

export type { GraphNode, GraphLink } from './semantic-graph'
type Props = { nodes: GraphNode[]; links: GraphLink[]; activeId: string; path: string[]; onSelect: (node: GraphNode) => void; busy?: boolean; intro?: boolean; onReset?: () => void }

const relationLabels: Record<string, string> = { semantic: 'ใกล้ความหมาย · AI', related: 'เกี่ยวข้อง', similar: 'ความหมายคล้าย', opposite: 'ตรงข้าม', broader: 'ความหมายกว้างกว่า', narrower: 'เฉพาะเจาะจงกว่า', confused_with: 'มักสับสน', 'confused-with': 'มักสับสน' }

/** A persistent, keyboard-accessible constellation with a quiet deterministic layout. */
export default function SemanticGraph({ nodes, links, activeId, path, onSelect, busy = false, intro = false, onReset }: Props) {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches)
  const [focused, setFocused] = useState(true)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const positioned = useMemo(() => layoutGraph(nodes, links, activeId, path, mobile && !showAll, focused), [nodes, links, activeId, path, mobile, showAll, focused])
  const byId = useMemo(() => new Map(positioned.map(node => [node.id, node])), [positioned])
  const visibleLinks = links.filter(link => byId.has(link.source) && byId.has(link.target))

  /** Listen only at the responsive breakpoint instead of rerendering for every resized pixel. */
  useEffect(() => {
    const media = window.matchMedia('(max-width: 640px)')
    /** Keep graph density appropriate for the available screen. */
    const update = () => setMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  /** Each selection restores the camera while retaining the explored path. */
  useEffect(() => { setPan({ x: 0, y: 0 }); setZoom(1) }, [activeId])

  /** Capture only blank canvas drags, preserving native button interaction. */
  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    drag.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  /** Move the camera in CSS pixels independently of the graph's semantic coordinates. */
  function movePan(event: PointerEvent<HTMLDivElement>) {
    if (drag.current) setPan({ x: drag.current.startX + event.clientX - drag.current.x, y: drag.current.startY + event.clientY - drag.current.y })
  }
  /** Release captured gestures without changing selection. */
  function endPan() { drag.current = null; setDragging(false) }
  /** Restore a predictable view after zooming or panning. */
  function recenter() { setPan({ x: 0, y: 0 }); setZoom(1) }

  return <section className={`semantic-graph ${intro ? 'graph-intro' : ''} ${busy ? 'graph-busy' : ''}`} aria-label="เครือข่ายความหมาย · Interactive word graph" aria-busy={busy}>
    <div className="graph-caption"><span className="graph-live-dot" /> LANGUAGE, CONNECTED <span className="graph-caption-count">{nodes.length.toString().padStart(2, '0')} WORDS</span></div>
    <div className={`graph-viewport ${dragging ? 'is-dragging' : ''}`} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
      <div className="graph-camera" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="graph-lines" viewBox="0 0 1000 460" preserveAspectRatio="none" aria-hidden="true">
          {visibleLinks.map((link, index) => {
            const source = byId.get(link.source)!
            const target = byId.get(link.target)!
            const active = isPathLink(link, path)
            return <g key={`${link.source}-${link.target}-${link.kind}`} className={`graph-edge ${active ? 'is-path' : ''} ${/ai|semantic|generated/i.test(`${link.provenance} ${link.kind}`) ? 'is-semantic' : ''}`} style={{ '--edge-delay': `${Math.min(index, 8) * 90 + 180}ms` } as CSSProperties}>
              <path d={`M ${source.x} ${source.y} Q ${(source.x + target.x) / 2} ${(source.y + target.y) / 2 - 14} ${target.x} ${target.y}`} pathLength="1" />
              <circle cx={(source.x + target.x) / 2} cy={(source.y + target.y) / 2 - 7} r={active ? 3 : 2} />
            </g>
          })}
        </svg>
        {positioned.map((node, index) => <div key={node.id} className={`graph-node-position ${node.current ? 'is-center' : ''} ${path.includes(node.id) ? 'is-visited' : ''} ${!node.current && !node.nearby ? 'is-history' : ''}`} style={{ left: `${node.x / 10}%`, top: `${node.y / 4.6}%`, '--node-delay': `${node.current ? 0 : Math.min(index, 8) * 90 + 250}ms`, '--from-x': `${(node.parentX - node.x) * .24}px`, '--from-y': `${(node.parentY - node.y) * .24}px`, '--drift-delay': `${index * -1.7}s` } as CSSProperties}>
          <button type="button" className="graph-node" aria-pressed={node.current} aria-label={`สำรวจ ${node.word}${node.kind ? ` · ${relationLabels[node.kind] || 'เกี่ยวข้อง'}` : ''}`} aria-describedby={node.description ? `preview-${node.id}` : undefined} onClick={() => onSelect(node)}>
            <span className="graph-node-orbit" aria-hidden="true" />
            <span className="graph-node-dot" aria-hidden="true" />
            <span className="graph-node-word" lang="th">{node.word}</span>
            {node.current && <span className="graph-core-label">{busy ? 'DISCOVERING' : 'EXPLORE THIS WORD'}</span>}
            {!node.current && <span className="graph-node-hint">{relationLabels[node.kind || ''] || 'สำรวจความเชื่อมโยง'} <span aria-hidden="true">↗</span></span>}
          </button>
          {node.description && <span className="graph-preview" id={`preview-${node.id}`} role="tooltip">{node.description}</span>}
        </div>)}
      </div>
    </div>
    {path.length > 1 && <nav className="graph-path" aria-label="เส้นทางสำรวจ">{path.map((id, index) => { const node = nodes.find(item => item.id === id); return node ? <button key={`${id}-${index}`} onClick={() => onSelect(node)}>{index > 0 && <span aria-hidden="true">→ </span>}{node.word}</button> : null })}</nav>}
    {listOpen && <div className="graph-list" aria-label="ความเชื่อมโยงทั้งหมด"><div><strong>{nodes.length} คำในเครือข่าย</strong><button aria-label="ปิดรายการคำ" onClick={() => setListOpen(false)}>×</button></div><ul>{links.map(link => { const source = nodes.find(node => node.id === link.source); const target = nodes.find(node => node.id === link.target); return source && target ? <li key={`${link.source}:${link.target}`}><button onClick={() => { onSelect(target); setListOpen(false) }}><span>{source.word} → <b>{target.word}</b></span><small>{relationLabels[link.kind] || 'เกี่ยวข้อง'}</small></button></li> : null })}</ul></div>}
    <div className="graph-bottom"><div className="graph-legend"><span><i />ความเชื่อมโยง</span><span><i className="is-dashed" />AI เชื่อมโยง</span></div>
      <div className="graph-controls" aria-label="Graph controls">
        <button type="button" aria-label="Show all word connections" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>☷</button>
        {mobile && <button type="button" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? 'Less' : 'More'}</button>}
        <button type="button" aria-label="Focus on connected words" aria-pressed={focused} onClick={() => setFocused(!focused)}>Focus</button>
        <button type="button" aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom(value => Math.max(.6, value - .2))}>−</button>
        <button type="button" aria-label="Recenter graph" onClick={recenter}>⌖</button>
        <button type="button" aria-label="Zoom in" disabled={zoom >= 1.8} onClick={() => setZoom(value => Math.min(1.8, value + .2))}>+</button>
        {onReset && path.length > 1 && <button type="button" aria-label="Start a new exploration" onClick={onReset}>↺</button>}
      </div>
    </div>
  </section>
}
