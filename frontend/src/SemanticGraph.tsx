import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { isPathLink, type GraphLink, type GraphNode } from './semantic-graph'
import { GRAPH_CAP, seedParticles, tickParticles, type Particle } from './graph-physics'
import './semantic-graph.css'

export type { GraphNode, GraphLink } from './semantic-graph'
type Props = { nodes: GraphNode[]; links: GraphLink[]; activeId: string; path: string[]; onSelect: (node: GraphNode) => void; busy?: boolean; intro?: boolean; onReset?: () => void; generation?: number }

export default function SemanticGraph({ nodes, links, activeId, path, onSelect, busy = false, intro = false, onReset, generation = 0 }: Props) {
  const viewport = useRef<HTMLDivElement>(null)
  const particles = useRef<Particle[]>([])
  const lastGeneration = useRef(generation)
  const [size, setSize] = useState({ width: 800, height: 450 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [listOpen, setListOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const visible = useMemo(() => {
    const cap = size.width < 500 ? (size.height < 220 ? 3 : 7) : Math.min(GRAPH_CAP, Math.max(8, Math.floor(size.width * size.height / 17000)))
    const priority = [activeId, ...path.slice().reverse()]
    return [...nodes].sort((a, b) => {
      const rank = (id: string) => priority.includes(id) ? priority.indexOf(id) : priority.length
      return rank(a.id) - rank(b.id)
    }).slice(0, cap)
  }, [nodes, activeId, path, size.width, size.height])
  const visibleLinks = useMemo(() => links.filter(link => visible.some(node => node.id === link.source) && visible.some(node => node.id === link.target)), [visible, links])

  useEffect(() => {
    if (!viewport.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setPan({ x: 0, y: 0 }); setZoom(1) }, [activeId, generation])

  useEffect(() => {
    const root = viewport.current
    if (!root || size.width < 1 || size.height < 1) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const previous = lastGeneration.current === generation ? particles.current : []
    lastGeneration.current = generation
    const simulation = seedParticles(visible, previous, activeId, size.width, size.height)
    particles.current = simulation
    const buttons = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-node]')).map(node => [node.dataset.node, node]))
    const edges = Array.from(root.querySelectorAll<SVGPathElement>('.graph-edge path'))
    const paint = (time: number) => {
      const positions = new Map<string, { x: number; y: number }>()
      simulation.forEach((node, index) => {
        const drift = reduced.matches || node.id === activeId ? 0 : 2
        const x = node.x + Math.sin(time / 1900 + index * 2) * drift
        const y = node.y + Math.cos(time / 2400 + index * 3) * drift
        positions.set(node.id, { x, y })
        const element = buttons.get(node.id)
        if (element) { element.style.left = `${x}px`; element.style.top = `${y}px`; element.style.width = `${node.width}px` }
      })
      visibleLinks.forEach((link, index) => {
        const a = positions.get(link.source), b = positions.get(link.target)
        if (a && b) edges[index]?.setAttribute('d', `M ${a.x} ${a.y} L ${b.x} ${b.y}`)
      })
    }
    let frame = 0, ticks = 0
    const run = (time: number) => {
      if (document.hidden || root.closest('[hidden]')) { frame = requestAnimationFrame(run); return }
      if (ticks < 180) { for (let n = 0; n < 3; n++) tickParticles(simulation, visibleLinks, activeId, size.width, size.height); ticks += 3 }
      paint(time)
      if (!reduced.matches) frame = requestAnimationFrame(run)
    }
    const restart = () => {
      cancelAnimationFrame(frame)
      if (reduced.matches) { for (let i = 0; i < 220; i++) tickParticles(simulation, visibleLinks, activeId, size.width, size.height); paint(0) }
      else frame = requestAnimationFrame(run)
    }
    restart(); reduced.addEventListener('change', restart)
    return () => { cancelAnimationFrame(frame); reduced.removeEventListener('change', restart) }
  }, [visible, visibleLinks, activeId, size, generation])

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    drag.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true)
  }
  return <section className={`semantic-graph ${intro ? 'graph-intro' : ''} ${busy ? 'graph-busy' : ''}`} aria-label="เครือข่ายความหมาย · Interactive word graph" aria-busy={busy}>
    <nav className="graph-path" aria-label="เส้นทางสำรวจ">{path.map((id, index) => { const node = nodes.find(item => item.id === id); return node ? <button key={`${id}-${index}`} aria-current={id === activeId ? 'location' : undefined} onClick={() => onSelect(node)}>{index > 0 && <span aria-hidden="true"> / </span>}{node.word}</button> : null })}</nav>
    <div ref={viewport} className={`graph-viewport ${dragging ? 'is-dragging' : ''}`} onPointerDown={beginPan} onPointerMove={event => { if (drag.current) setPan({ x: drag.current.startX + event.clientX - drag.current.x, y: drag.current.startY + event.clientY - drag.current.y }) }} onPointerUp={() => { drag.current = null; setDragging(false) }} onPointerCancel={() => { drag.current = null; setDragging(false) }}>
      <div className="graph-camera" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="graph-lines" width={size.width} height={size.height} aria-hidden="true">
          {visibleLinks.map(link => <g key={`${link.source}-${link.target}-${link.kind}`} className={`graph-edge ${isPathLink(link, path) ? 'is-path' : ''} ${link.kind === 'semantic' ? 'is-semantic' : ''}`}><path pathLength="1" /></g>)}
        </svg>
        {visible.map(node => <div key={`${generation}-${node.id}`} data-node={node.id} className={`graph-node-position ${node.id === activeId ? 'is-center' : ''}`}>
          <button type="button" className="graph-node" aria-pressed={node.id === activeId} aria-label={`สำรวจ ${node.word}`} onClick={() => onSelect(node)}>
            <span className={`graph-node-dot kind-${node.kind || 'related'}`} aria-hidden="true" />
            <span className="graph-node-word" lang="th">{node.word}</span>
          </button>
        </div>)}
      </div>
    </div>
    {listOpen && <div className="graph-list" aria-label="ความเชื่อมโยงทั้งหมด"><button aria-label="ปิดรายการคำ" onClick={() => setListOpen(false)}>×</button>{nodes.map(node => <button key={node.id} onClick={() => { onSelect(node); setListOpen(false) }}>{node.word}</button>)}</div>}
    <div className="graph-bottom"><div className="graph-legend"><span><i />พจนานุกรม</span><span><i className="is-dashed" />AI เชื่อมโยง</span></div><div className="graph-controls" aria-label="Graph controls">
      <button aria-label="Show all word connections" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>☷</button>
      <button aria-label="Zoom out" disabled={zoom <= .6} onClick={() => setZoom(value => Math.max(.6, value - .2))}>−</button>
      <button aria-label="Recenter graph" onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1) }}>⌖</button>
      <button aria-label="Zoom in" disabled={zoom >= 1.8} onClick={() => setZoom(value => Math.min(1.8, value + .2))}>+</button>
      {onReset && <button aria-label="Start a new exploration" onClick={onReset}>↺</button>}
    </div></div>
  </section>
}
