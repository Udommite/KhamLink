import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { graphDepths, isPathLink, relationLabel, type GraphLink, type GraphNode } from './semantic-graph'
import { GRAPH_CAP, seedParticles, tickParticles, type GraphOverlay, type Particle } from './graph-physics'
import './semantic-graph.css'

export type { GraphNode, GraphLink } from './semantic-graph'
export { GRAPH_INTRO_MS } from './semantic-graph'
type Props = { nodes: GraphNode[]; links: GraphLink[]; activeId: string; path: string[]; onSelect: (node: GraphNode) => void; busy?: boolean; intro?: boolean; onReset?: () => void; generation?: number }
/** Deterministic hash scatter. Placing motes on a `mod()` lattice in CSS produced a visible
 *  repeating grid the moment the camera moved; this gives irregular positions that are still
 *  identical on every render, so nothing jumps when React re-renders the layer. */
function scatter(index: number, salt: number) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453
  return value - Math.floor(value)
}
/** One placement for every decorative layer: an irregular spot, a size within the layer's
 *  own range, an angle, and its own clock — so no two specks pulse together. Layers spread
 *  well past the viewport on every side (matching insets in CSS) so panning never reaches
 *  the edge of the field. */
const speck = (index: number, salt: number, min: number, range: number) => ({
  '--x': `${(scatter(index, salt) * 100).toFixed(2)}%`,
  '--y': `${(scatter(index, salt + 7) * 100).toFixed(2)}%`,
  '--size': `${(min + scatter(index, salt + 13) * range).toFixed(2)}px`,
  '--twinkle': `${(3.4 + scatter(index, salt + 19) * 5.2).toFixed(2)}s`,
  '--lag': `${(scatter(index, salt + 23) * -14).toFixed(2)}s`,
  '--angle': `${(scatter(index, salt + 29) * 360).toFixed(1)}deg`,
} as CSSProperties)
const MOTES = Array.from({ length: 64 }, (_, index) => index)
const ORBS = Array.from({ length: 7 }, (_, index) => index)
/** Hairlines at loose angles — the faintest echo of the graph's own edges. */
const FILAMENTS = Array.from({ length: 24 }, (_, index) => index)
/** Four-point sparkles, the only decoration that reads as a highlight rather than a dot. */
const GLINTS = Array.from({ length: 11 }, (_, index) => index)
/** Hollow circles, so the field is not made of one shape repeated at three sizes. */
const RINGLETS = Array.from({ length: 18 }, (_, index) => index)

/** "เกี่ยวข้อง · คำ" — the relation and the word it was revealed from, in one line. */
function describe(node: GraphNode, nodes: GraphNode[]): string {
  const parent = node.parentId && node.parentId !== node.id ? node.parentWord || nodes.find(item => item.id === node.parentId)?.word : ''
  return relationLabel(node) + (parent ? ` · ${parent}` : '')
}

/** Render one persistent, keyboard-operable graph with camera and node gestures kept separate. */
export default function SemanticGraph({ nodes, links, activeId, path, onSelect, busy = false, intro = false, onReset, generation = 0 }: Props) {
  const viewport = useRef<HTMLDivElement>(null)
  const particles = useRef<Particle[]>([])
  const lastGeneration = useRef(generation)
  const [size, setSize] = useState({ width: 800, height: 450 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [listOpen, setListOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const heat = useRef(220)
  const paintNow = useRef<() => void>(() => {})
  const camera = useRef({ zoom, pan })
  camera.current = { zoom, pan }
  const nodeDrag = useRef<{ id: string; pointer: number; x: number; y: number; offsetX: number; offsetY: number; vx: number; vy: number; time: number; moved: boolean } | null>(null)
  const suppressClick = useRef<string | null>(null)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const visible = useMemo(() => {
    const cap = size.width < 500 ? 7 : GRAPH_CAP
    const priority = [activeId, ...path.slice().reverse()]
    /** Reserve the active neighbourhood before history fills the unchanged desktop cap. */
    const current = nodes.filter(node => node.parentId === activeId).map(node => node.id)
    priority.splice(1, 0, ...current.filter(id => id !== activeId))
    return [...nodes].sort((a, b) => {
      const rank = (id: string) => priority.includes(id) ? priority.indexOf(id) : priority.length
      return rank(a.id) - rank(b.id)
    }).slice(0, cap)
  }, [nodes, activeId, path, size.width, size.height])
  const visibleLinks = useMemo(() => links.filter(link => visible.some(node => node.id === link.source) && visible.some(node => node.id === link.target)), [visible, links])
  /** Re-rooting evicts the old centre's neighbours the moment the new one's arrive, and a
      plain unmount made the whole constellation blink out and a new one blink in. Departing
      nodes stay mounted, unpositioned, for one fade so the swap reads as a dissolve. They
      are excluded from the simulation, so they simply fade where they last stood. */
  const [leaving, setLeaving] = useState<Particle[]>([])
  const wasVisible = useRef<string[]>([])
  useEffect(() => {
    const present = new Set(visible.map(node => node.id))
    // This effect is declared before the simulation's, so particles.current still holds
    // the outgoing layout and can hand each departing node its last painted position.
    const gone = particles.current.filter(node => wasVisible.current.includes(node.id) && !present.has(node.id))
    wasVisible.current = visible.map(node => node.id)
    if (!gone.length) return
    setLeaving(gone.map(node => ({ ...node })))
    const timer = setTimeout(() => setLeaving([]), 440)
    return () => clearTimeout(timer)
  }, [visible])
  const departing = useMemo(() => leaving.filter(node => !visible.some(item => item.id === node.id)), [leaving, visible])
  const depths = useMemo(() => graphDepths(visible, visibleLinks, activeId), [visible, visibleLinks, activeId])
  const arrival = useMemo(() => new Map([...visible].sort((a, b) => depths.get(a.id)! - depths.get(b.id)!).map((node, index) => [node.id, Math.max(0, index - 1)])), [visible, depths])

  useEffect(() => {
    if (!viewport.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  /** Only a fresh search recentres the camera. Re-rooting onto a node the user can already
      see must not snap the viewport out from under them — the simulation re-arranges the
      same nodes and the camera holds still (REQ-UX-028, "re-arranged, not replaced"). */
  useEffect(() => { setPan({ x: 0, y: 0 }); setZoom(1) }, [generation])

  /** Layout, not passive: a node mounts at the stylesheet's default 50%/50% and only gets a
      real position when the first animation frame paints. As an effect this ran after the
      browser had already drawn that frame, so every new neighbour flashed at the centre of
      the canvas and then jumped outwards. Positioning before paint removes the jump. */
  useLayoutEffect(() => {
    const root = viewport.current
    if (!root || size.width < 1 || size.height < 1) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const previous = lastGeneration.current === generation ? particles.current : []
    lastGeneration.current = generation
    const simulation = seedParticles(visible, previous, activeId, size.width, size.height)
    particles.current = simulation
    const buttons = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-node]')).map(node => [node.dataset.node, node]))
    const edges = Array.from(root.querySelectorAll<SVGPathElement>('.graph-edge path'))
    /** Measure actual overlays rather than reserving a hard-coded inset simulation box. */
    const overlayElements = Array.from(document.querySelectorAll<HTMLElement>('.lab-header,.graph-path,.discover-inspector,.search-dock,.discover-footer,.graph-bottom'))
    let overlays: GraphOverlay[] = []
    const measureOverlays = () => {
      const rect = root.getBoundingClientRect()
      overlays = overlayElements.filter(element => element.getClientRects().length && !element.closest('[hidden]')).map(element => {
        const box = element.getBoundingClientRect()
        return { x: box.left - rect.left, y: box.top - rect.top, width: box.width, height: box.height }
      })
      heat.current = 220
    }
    const overlayObserver = new ResizeObserver(measureOverlays)
    overlayElements.forEach(element => overlayObserver.observe(element))
    measureOverlays()
    /** Settle newly revealed words before their first frame. Seeded at the word they came
        from and handed to the live simulation, a dozen neighbours shot outwards across the
        canvas at once — an explosion rather than an arrival. Pre-ticking puts them near
        their resting orbit, so all the eye sees is them fading in roughly where they
        belong, with the remaining heat doing nothing but a gentle settle. */
    if (simulation.some(node => !previous.some(old => old.id === node.id))) {
      for (let n = 0; n < 70; n++) tickParticles(simulation, visibleLinks, activeId, size.width, size.height, overlays)
    }
    /** Paint directly to keep pointer and simulation frames independent of React rendering. */
    const paint = (time: number) => {
      const positions = new Map<string, { x: number; y: number }>()
      simulation.forEach((node, index) => {
        const drift = reduced.matches || node.id === activeId || node.pinned ? 0 : 2
        const x = node.x + Math.sin(time / 1900 + index * 2) * drift
        const y = node.y + Math.cos(time / 2400 + index * 3) * drift
        positions.set(node.id, { x, y })
        const element = buttons.get(node.id)
        if (element) { element.style.left = `${x}px`; element.style.top = `${y}px`; element.style.width = `${node.width}px`; element.dataset.pinned = String(Boolean(node.pinned)) }
      })
      visibleLinks.forEach((link, index) => {
        /** Draw outward from focus so intro travel follows depth even across reverse links. */
        const reverse = depths.get(link.source)! > depths.get(link.target)!
        const a = positions.get(reverse ? link.target : link.source), b = positions.get(reverse ? link.source : link.target)
        if (a && b) edges[index]?.setAttribute('d', `M ${a.x} ${a.y} L ${b.x} ${b.y}`)
      })
    }
    paintNow.current = () => paint(reduced.matches ? 0 : performance.now())
    let frame = 0, lastTime = 0
    /** Fixed-rate integration makes inertia independent of 60/120/144 Hz displays. */
    const run = (time: number) => {
      if (document.hidden || root.closest('[hidden]')) { frame = requestAnimationFrame(run); return }
      const steps = Math.min(4, Math.floor((time - lastTime) / (1000 / 60)))
      if (steps) lastTime = time
      if (heat.current > 0 || nodeDrag.current) for (let n = 0; n < steps; n++) {
        const { pan: offset, zoom: scale } = camera.current
        const worldOverlays = overlays.map(box => ({ x: (box.x - offset.x) / scale, y: (box.y - offset.y) / scale, width: box.width / scale, height: box.height / scale }))
        tickParticles(simulation, visibleLinks, activeId, size.width, size.height, worldOverlays); heat.current--
      }
      paint(time)
      if (!reduced.matches) frame = requestAnimationFrame(run)
    }
    /** Place every node before this frame reaches the screen. */
    paint(reduced.matches ? 0 : performance.now())
    /** Reduced motion settles once, while explicit dragging remains directly manipulable. */
    const restart = () => {
      cancelAnimationFrame(frame)
      if (reduced.matches) { for (let i = 0; i < 220; i++) tickParticles(simulation, visibleLinks, activeId, size.width, size.height, overlays); paint(0) }
      else frame = requestAnimationFrame(run)
    }
    restart(); reduced.addEventListener('change', restart)
    return () => { cancelAnimationFrame(frame); overlayObserver.disconnect(); reduced.removeEventListener('change', restart); nodeDrag.current = null }
  }, [visible, visibleLinks, activeId, size, generation, depths])

  /** Empty-canvas drag pans; buttons retain their own capture and keyboard activation. */
  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button')) return
    drag.current = { x: event.clientX, y: event.clientY, startX: pan.x, startY: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true)
  }
  /** Convert pointer coordinates through the same origin-zero camera transform as the grid. */
  function pointerWorld(event: PointerEvent) {
    const rect = viewport.current!.getBoundingClientRect()
    return { x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom }
  }
  /** Capture mouse or touch without moving the node until the drag threshold is crossed. */
  function beginNode(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (event.button !== 0 || nodeDrag.current) return
    const node = particles.current.find(item => item.id === id)
    if (!node) return
    event.stopPropagation(); suppressClick.current = null
    const point = pointerWorld(event)
    nodeDrag.current = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, offsetX: node.x - point.x, offsetY: node.y - point.y, vx: 0, vy: 0, time: event.timeStamp, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  /** Pin at the pointer and let linked neighbours follow; release velocity uses elapsed time. */
  function moveNode(event: PointerEvent<HTMLButtonElement>) {
    const state = nodeDrag.current
    if (!state || state.pointer !== event.pointerId) return
    event.stopPropagation()
    if (!state.moved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return
    const node = particles.current.find(item => item.id === state.id)
    if (!node) return
    state.moved = true; node.pinned = true; heat.current = 220
    const point = pointerWorld(event), elapsed = Math.max(8, event.timeStamp - state.time)
    const x = Math.max(node.width / 2 + 8, Math.min(size.width - node.width / 2 - 8, point.x + state.offsetX))
    const y = Math.max(38, Math.min(size.height - 38, point.y + state.offsetY))
    state.vx = Math.max(-18, Math.min(18, (x - node.x) * 16.67 / elapsed)); state.vy = Math.max(-18, Math.min(18, (y - node.y) * 16.67 / elapsed)); state.time = event.timeStamp
    node.x = x; node.y = y
    paintNow.current()
  }
  /** Release returns the node to simulation control; cancellation drops momentum and navigation. */
  function endNode(event: PointerEvent<HTMLButtonElement>) {
    const state = nodeDrag.current
    if (!state || state.pointer !== event.pointerId) return
    event.stopPropagation()
    const node = particles.current.find(item => item.id === state.id)
    const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (node) { node.pinned = false; node.vx = quiet || event.type !== 'pointerup' || event.timeStamp - state.time > 100 ? 0 : state.vx; node.vy = quiet || event.type !== 'pointerup' || event.timeStamp - state.time > 100 ? 0 : state.vy }
    if (state.moved || event.type !== 'pointerup') suppressClick.current = state.id
    nodeDrag.current = null; heat.current = 220; paintNow.current()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <section className={`semantic-graph ${intro ? 'graph-intro' : ''} ${busy ? 'graph-busy' : ''}`} aria-label="เครือข่ายความหมาย · Interactive word graph" aria-busy={busy}>
    <nav className="graph-path" aria-label="เส้นทางสำรวจ">{path.map((id, index) => { const node = nodes.find(item => item.id === id); return node ? <button key={`${id}-${index}`} aria-current={id === activeId ? 'location' : undefined} onClick={() => onSelect(node)}>{index > 0 && <span aria-hidden="true"> / </span>}{node.word}</button> : null })}</nav>
    <div ref={viewport} className={`graph-viewport ${dragging ? 'is-dragging' : ''}`} onPointerDown={beginPan} onPointerMove={event => { if (drag.current) setPan({ x: drag.current.startX + event.clientX - drag.current.x, y: drag.current.startY + event.clientY - drag.current.y }) }} onPointerUp={() => { drag.current = null; setDragging(false) }} onPointerCancel={() => { drag.current = null; setDragging(false) }}>
      <div className="graph-camera" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <div className="graph-grid" aria-hidden="true" />
        {/* Two parallax layers rather than one: the far field drifts slower than the near
            field, which is what makes the canvas read as deep instead of merely busy. */}
        <div className="graph-orbs" aria-hidden="true" style={{ transform: `translate(${-pan.x * .78 / zoom}px, ${-pan.y * .78 / zoom}px)` }}>{ORBS.map(index => <i key={index} style={{ '--orb': index, left: `${(scatter(index, 3) * 116 - 8).toFixed(1)}%`, top: `${(scatter(index, 5) * 116 - 8).toFixed(1)}%` } as CSSProperties} />)}</div>
        <div className="graph-filaments" aria-hidden="true" style={{ transform: `translate(${-pan.x * .62 / zoom}px, ${-pan.y * .62 / zoom}px)` }}>{FILAMENTS.map(index => <i key={index} style={speck(index, 31, 44, 118)} />)}</div>
        <div className="graph-ambient is-far" aria-hidden="true" style={{ transform: `translate(${-pan.x * .55 / zoom}px, ${-pan.y * .55 / zoom}px)` }}>{MOTES.map(index => <i key={index} style={speck(index, 1, 1.6, 3.4)} />)}</div>
        <div className="graph-ringlets" aria-hidden="true" style={{ transform: `translate(${-pan.x * .43 / zoom}px, ${-pan.y * .43 / zoom}px)` }}>{RINGLETS.map(index => <i key={index} style={speck(index, 53, 5, 13)} />)}</div>
        <div className="graph-ambient is-near" aria-hidden="true" style={{ transform: `translate(${-pan.x * .22 / zoom}px, ${-pan.y * .22 / zoom}px)` }}>{MOTES.slice(0, 40).map(index => <i key={index} style={speck(index, 2, 1.6, 3.4)} />)}</div>
        <div className="graph-glints" aria-hidden="true" style={{ transform: `translate(${-pan.x * .32 / zoom}px, ${-pan.y * .32 / zoom}px)` }}>{GLINTS.map(index => <i key={index} style={speck(index, 41, 9, 13)} />)}</div>
        <svg className="graph-lines" width={size.width} height={size.height} aria-hidden="true">
          {visibleLinks.map(link => <g key={`${link.source}-${link.target}-${link.kind}`} style={{ '--beam': arrival.get(depths.get(link.source)! > depths.get(link.target)! ? link.source : link.target) || 0 } as CSSProperties} className={`graph-edge ${isPathLink(link, path) ? 'is-path' : ''} ${link.kind === 'semantic' || link.provenance === 'AI_GENERATED_METADATA' ? 'is-semantic' : 'is-dictionary'}`}><path pathLength="1" /></g>)}
        </svg>
        {/* Each node inherits the beam index of the edge that reaches it, so the intro
            resolves it exactly where its own beam of light lands (REQ-UX-004). */}
        {departing.map(node => <div key={`leaving-${node.id}`} className="graph-node-position is-leaving" aria-hidden="true" style={{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px` }}>
          <span className="graph-node"><span className="graph-node-word" lang="th">{node.word}</span></span>
        </div>)}
        {visible.map(node => <div key={node.id} data-node={node.id} data-parent={node.parentId || node.id} data-relation={node.kind || 'root'} data-provenance={node.provenance} style={{ '--beam': arrival.get(node.id) || 0, '--depth': Math.min(3, depths.get(node.id) || 0) } as CSSProperties} className={`graph-node-position ${node.id === activeId ? 'is-center' : ''} ${node.parentId === activeId ? 'is-active-group' : ''} ${node.kind === 'semantic' || node.provenance === 'AI_GENERATED_METADATA' ? 'is-inferred' : 'is-source'}`}>
          {/* The relation used to print under every headword and turned the canvas into a
              wall of small print. It stays in the accessible name and the tooltip, where it
              answers "related how, to what?" on demand instead of permanently (REQ-UX-028c
              is still carried by border style, dot shape and edge weight). */}
          <button type="button" className="graph-node" aria-pressed={node.id === activeId} aria-label={`สำรวจ ${node.word} · ${describe(node, nodes)}`} title={`${describe(node, nodes)} · ลากเพื่อขยับ`} onPointerDown={event => beginNode(event, node.id)} onPointerMove={moveNode} onPointerUp={endNode} onPointerCancel={endNode} onLostPointerCapture={endNode} onClick={event => { if (event.detail && suppressClick.current === node.id) { suppressClick.current = null; return } onSelect(node) }}>
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
