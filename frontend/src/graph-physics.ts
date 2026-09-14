import type { GraphLink, GraphNode } from './semantic-graph'

export type Particle = GraphNode & { x: number; y: number; vx: number; vy: number; width: number; pinned?: boolean }
export type GraphOverlay = { x: number; y: number; width: number; height: number }
export const GRAPH_CAP = 16

/** Character count is a poor proxy for Thai: สระ and วรรณยุกต์ stack above and below without
 *  adding width, while base consonants run wider than the Latin average the old 10px-per-
 *  character guess was tuned on. So a word like "เป็นปากเสียง" was sized for 12 characters
 *  when it draws as 8, and one like "กก" was given room it never used. Measure instead,
 *  cached per word and size; the count stays as the fallback where there is no canvas. */
const measured = new Map<string, number>()
let pen: CanvasRenderingContext2D | null | undefined
function textWidth(word: string, size: number, weight: number, perCharacter: number): number {
  const key = `${weight} ${size} ${word}`
  const hit = measured.get(key)
  if (hit !== undefined) return hit
  if (pen === undefined) { try { pen = document.createElement('canvas').getContext('2d') } catch { pen = null } }
  let value = Array.from(word).length * perCharacter
  if (pen) {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--ui').trim() || 'sans-serif'
    pen.font = `${weight} ${size}px ${family}`
    value = Math.ceil(pen.measureText(word).width)
  }
  measured.set(key, value)
  return value
}

/** Small bounded graph: orbit targets, springs, group-aware charge and rectangular collision.
 * Positions survive expansion; a fresh search deliberately starts a new simulation. */
export function seedParticles(nodes: GraphNode[], previous: Particle[], center: string, width: number, height: number): Particle[] {
  const fallback = previous.find(node => node.id === center) || { x: width / 2, y: height / 2 }
  return nodes.map((node, index) => {
    const old = previous.find(item => item.id === node.id)
    /** A newly revealed word grows out of the word it was revealed from, not out of the
     *  middle of the canvas — otherwise every expansion looks like the graph restarted. */
    const origin = previous.find(item => item.id === node.parentId) || fallback
    const angle = index * 2.399963
    // The centre draws at 23px/600 against the neighbours' 16px/500, and carries 20px of
    // side padding against their 12px — it is the one word on screen that must never
    // ellipsise, so it is measured at its own type.
    const focus = node.id === center
    const label = textWidth(node.word, focus ? 23 : 16, focus ? 600 : 500, focus ? 14 : 10)
    return { ...node, x: old?.x ?? origin.x + Math.cos(angle) * (26 + (index % 7) * 10), y: old?.y ?? origin.y + Math.sin(angle) * (26 + (index % 7) * 9), vx: old?.vx ?? 0, vy: old?.vy ?? 0, width: Math.min(width - 16, focus ? 300 : 240, Math.max(node.parentId ? 96 : 76, label + (focus ? 46 : 28))) }
  })
}

/** Split N siblings into concentric rings. One ring crowds past ~7 labels at readable radii,
 *  so overflow moves outward rather than squeezing the same circumference tighter. */
function rings(count: number): number[] {
  const sizes: number[] = []
  for (let left = count, capacity = 7; left > 0; capacity += 5) { sizes.push(Math.min(left, capacity)); left -= sizes[sizes.length - 1] }
  return sizes
}

/** Which ring a sibling sits on, and how many share it — a stable slot, so re-rooting moves
 *  nodes to new positions instead of reshuffling everything each tick. */
function orbit(index: number, count: number) {
  let start = 0
  const sizes = rings(count)
  for (let ring = 0; ring < sizes.length; ring++) {
    if (index < start + sizes[ring]) return { ring, slot: index - start, share: sizes[ring] }
    start += sizes[ring]
  }
  return { ring: 0, slot: 0, share: 1 }
}

/** The widest uncovered run between `0` and `span`, given blocking intervals. */
function widestGap(blocks: [number, number][], span: number): [number, number] {
  const merged: [number, number][] = []
  for (const block of blocks.map(([from, to]) => [Math.max(0, from), Math.min(span, to)] as [number, number]).filter(([from, to]) => to > from).sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1]
    if (last && block[0] <= last[1]) last[1] = Math.max(last[1], block[1])
    else merged.push(block)
  }
  let best: [number, number] = [0, 0], edge = 0
  for (const [from, to] of [...merged, [span, span] as [number, number]]) {
    if (from - edge > best[1] - best[0]) best = [edge, from]
    edge = Math.max(edge, to)
  }
  return best[1] > best[0] ? best : [0, span]
}

/** The clear area: where the focused word sits, and how much room its rings have.
 *  Nudging the viewport centre out of whatever covered it left the focus hard against the
 *  panel with half its ring underneath, and rings sized from the viewport spilled under
 *  the dock. Two 1-D sweeps give both the point and the extent. Only the focus is bound
 *  by it — other nodes may still settle behind an overlay (REQ-UX-026). */
function clearArea(width: number, height: number, overlays: GraphOverlay[]) {
  const spans = (boxes: GraphOverlay[], axis: 'x' | 'y') => boxes.map(box => [box[axis], box[axis] + (axis === 'x' ? box.width : box.height)] as [number, number])
  /** Only tall chrome — the dictionary panel — can push the focus sideways. A short bar
   *  that happens to cross the middle would otherwise strand the focus in a 40px slot. */
  const sides = overlays.filter(box => box.height > height * .4)
  const [left, right] = widestGap(spans(sides, 'x'), width)
  const middle = (left + right) / 2
  const bands = overlays.filter(box => box.x < middle + 150 && box.x + box.width > middle - 150)
  const [top, bottom] = widestGap(spans(bands, 'y'), height)
  return {
    x: Math.min(Math.max(middle, 140), width - 140),
    y: Math.min(Math.max((top + bottom) / 2, 60), height - 60),
    halfWidth: Math.max(160, (right - left) / 2),
    halfHeight: Math.max(110, (bottom - top) / 2),
  }
}

/** Group-aware forces share one simulation with drag pins and soft, measured chrome obstacles.
 *  Each node has its own orbit target around its parent, so siblings form a legible star
 *  rather than every node being pulled onto the same focus point (REQ-UX-028b). */
export function tickParticles(nodes: Particle[], links: GraphLink[], center: string, width: number, height: number, overlays: GraphOverlay[] = []) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  /** A node belongs to the word it was revealed from; anything orphaned falls back to focus. */
  const group = (node: Particle) => node.id === center || !node.parentId || node.parentId === node.id || !byId.has(node.parentId) ? center : node.parentId
  const focus = clearArea(width, height, overlays)
  /** Stable angular slots, assigned once per tick from a fixed order. */
  const slots = new Map<string, { ring: number; slot: number; share: number }>()
  const families = new Map<string, Particle[]>()
  for (const node of nodes) {
    if (node.id === center) continue
    const parent = group(node)
    const family = families.get(parent) || []
    family.push(node); families.set(parent, family)
  }
  for (const family of families.values()) family.forEach((node, index) => slots.set(node.id, orbit(index, family.length)))
  /** A ring has to be wide enough to seat its own labels, or the family crowds inward and
   *  shoulders the focused word out of the middle. Widest sibling sets the pitch. */
  const pitch = new Map([...families].map(([id, family]) => [id, Math.max(...family.map(node => node.width)) + 22]))

  const span = Math.min(width, height)
  for (const node of nodes) {
    if (node.id === center) {
      node.vx += (focus.x - node.x) * .12
      node.vy += (focus.y - node.y) * .12
    } else {
      const parent = byId.get(group(node)) || { x: focus.x, y: focus.y }
      const { ring, slot, share } = slots.get(node.id)!
      const own = group(node) === center
      // Sub-groups fan away from the centre instead of wrapping it, so a second-hop
      // cluster reads as hanging off its parent rather than as another ring of the focus.
      const away = own ? 0 : Math.atan2(parent.y - focus.y, parent.x - focus.x)
      // A wider fan needs less radius to seat the same labels, so the cluster stays tight
      // around its parent instead of sprawling far enough to mingle with the next group.
      const sweep = own ? Math.PI * 2 : Math.PI * 1.5
      const angle = away - sweep / 2 + (slot + .5 + (ring % 2) * .5) / share * sweep - (own ? Math.PI / 2 : 0)
      const grow = 1 + ring * .62
      // Rings are measured against the free area, not the viewport: sized from the whole
      // window they pushed half of every outer ring under the dock and the panel.
      const seat = share * (pitch.get(group(node)) || 120) / (sweep || Math.PI * 2)
      const rx = Math.min(focus.halfWidth - 80, Math.max((own ? focus.halfWidth * .55 : span * .15) * grow, seat))
      const ry = Math.min(focus.halfHeight - 40, Math.max((own ? focus.halfHeight * .55 : span * .12) * grow, share * 58 / (sweep || Math.PI * 2)))
      const pull = own ? .055 : .07
      node.vx += (parent.x + Math.cos(angle) * rx - node.x) * pull
      node.vy += (parent.y + Math.sin(angle) * ry - node.y) * pull
    }
    /** Soft repulsion never clips or clamps nodes to the unoccupied rectangle. */
    for (const box of overlays) {
      const dx = node.x - (box.x + box.width / 2), dy = node.y - (box.y + box.height / 2)
      const ox = box.width / 2 + node.width / 2 + 12 - Math.abs(dx), oy = box.height / 2 + 36 - Math.abs(dy)
      if (ox > 0 && oy > 0) {
        if (ox < oy) node.vx += (Math.sign(dx) || -1) * Math.min(ox, 100) * .03
        else node.vy += (Math.sign(dy) || -1) * Math.min(oy, 100) * .03
      }
    }
  }
  /** Links hold their orbit distance loosely; they trail a dragged node without fighting it. */
  for (const link of links) {
    const a = byId.get(link.source), b = byId.get(link.target)
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy))
    const rest = Math.min(group(a) === group(b) ? 150 : span * .30, width * .32)
    const force = (distance - rest) * (group(a) === group(b) ? .006 : .010)
    a.vx += dx / distance * force; a.vy += dy / distance * force
    b.vx -= dx / distance * force; b.vy -= dy / distance * force
  }
  /** Repulsion is stronger between groups than inside one, so families stay cohesive. */
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j], dx = b.x - a.x || .1, dy = b.y - a.y || .1
    const distance = Math.max(10, Math.hypot(dx, dy)), charge = (group(a) === group(b) ? 5200 : 22000) / (distance * distance)
    a.vx -= dx / distance * charge; a.vy -= dy / distance * charge
    b.vx += dx / distance * charge; b.vy += dy / distance * charge
    const overlapX = (a.width + b.width) / 2 + 18 - Math.abs(dx), overlapY = 58 - Math.abs(dy)
    if (overlapX > 0 && overlapY > 0) {
      if (overlapX < overlapY) { const push = Math.sign(dx) * overlapX * .24; a.vx -= push; b.vx += push }
      else { const push = Math.sign(dy) * overlapY * .24; a.vy -= push; b.vy += push }
    }
  }
  for (const node of nodes) {
    if (node.pinned) { node.vx = 0; node.vy = 0; continue }
    node.vx *= .62; node.vy *= .62
    /** Unless the user is dragging it, the focused word converges on the clear point and
     *  stays there; neighbours arrange around it rather than pushing it around. */
    if (node.id === center) { node.x += (focus.x - node.x) * .3; node.y += (focus.y - node.y) * .3; node.vx *= .3; node.vy *= .3 }
    node.x = Math.max(node.width / 2 + 8, Math.min(width - node.width / 2 - 8, node.x + node.vx))
    node.y = Math.max(34, Math.min(height - 34, node.y + node.vy))
  }
  // Project collision constraints after integration. Springs must never leave labels
  // interpenetrating at their equilibrium, even when a node is against the viewport.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = b.x - a.x || .1, dy = b.y - a.y || .1
      const overlapX = (a.width + b.width) / 2 + 12 - Math.abs(dx), overlapY = 56 - Math.abs(dy)
      if (overlapX <= 0 || overlapY <= 0) continue
      if (a.pinned && b.pinned) continue
      /** Shares sum to one, so a resolved overlap is corrected exactly once. The focused
       *  word takes none of it: it holds the middle, and the neighbour moves. */
      const mass = (node: Particle) => node.pinned || node.id === center ? 0 : 1
      const total = mass(a) + mass(b)
      if (!total) continue
      const give = mass(a) / total
      if (overlapX < overlapY) { const push = Math.sign(dx) * (overlapX + .1); a.x -= push * give; b.x += push * (1 - give) }
      else { const push = Math.sign(dy) * (overlapY + .1); a.y -= push * give; b.y += push * (1 - give) }
    }
    for (const node of nodes) {
      if (node.pinned) continue
      node.x = Math.max(node.width / 2 + 8, Math.min(width - node.width / 2 - 8, node.x))
      node.y = Math.max(32, Math.min(height - 32, node.y))
    }
  }
}
