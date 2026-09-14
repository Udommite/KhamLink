import type { GraphLink, GraphNode } from './semantic-graph'

export type Particle = GraphNode & { x: number; y: number; vx: number; vy: number; width: number }
export const GRAPH_CAP = 16

/** Small bounded graph: springs, inverse-square charge and rectangular collision.
 * Positions survive expansion; a fresh search deliberately starts a new simulation. */
export function seedParticles(nodes: GraphNode[], previous: Particle[], center: string, width: number, height: number): Particle[] {
  const origin = previous.find(node => node.id === center) || { x: width / 2, y: height / 2 }
  return nodes.map((node, index) => {
    const old = previous.find(item => item.id === node.id)
    const angle = index * 2.399963
    return { ...node, x: old?.x ?? origin.x + Math.cos(angle) * (30 + index * 11), y: old?.y ?? origin.y + Math.sin(angle) * (30 + index * 9), vx: 0, vy: 0, width: Math.min(190, Math.max(76, Array.from(node.word).length * 10 + 24)) }
  })
}

export function tickParticles(nodes: Particle[], links: GraphLink[], center: string, width: number, height: number) {
  const byId = new Map(nodes.map(node => [node.id, node]))
  for (const node of nodes) {
    node.vx += (width / 2 - node.x) * (node.id === center ? .13 : .002)
    node.vy += (height / 2 - node.y) * (node.id === center ? .13 : .004)
  }
  for (const link of links) {
    const a = byId.get(link.source), b = byId.get(link.target)
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y, distance = Math.max(1, Math.hypot(dx, dy))
    const force = (distance - Math.min(170, width * .26)) * .008
    a.vx += dx / distance * force; a.vy += dy / distance * force
    b.vx -= dx / distance * force; b.vy -= dy / distance * force
  }
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j], dx = b.x - a.x || .1, dy = b.y - a.y || .1
    const distance = Math.max(10, Math.hypot(dx, dy)), charge = 18000 / (distance * distance)
    a.vx -= dx / distance * charge; a.vy -= dy / distance * charge
    b.vx += dx / distance * charge; b.vy += dy / distance * charge
    const overlapX = (a.width + b.width) / 2 + 18 - Math.abs(dx), overlapY = 72 - Math.abs(dy)
    if (overlapX > 0 && overlapY > 0) {
      if (overlapX < overlapY) { const push = Math.sign(dx) * overlapX * .24; a.vx -= push; b.vx += push }
      else { const push = Math.sign(dy) * overlapY * .24; a.vy -= push; b.vy += push }
    }
  }
  for (const node of nodes) {
    node.vx *= .58; node.vy *= .58
    node.x = Math.max(node.width / 2 + 8, Math.min(width - node.width / 2 - 8, node.x + node.vx))
    node.y = Math.max(38, Math.min(height - 38, node.y + node.vy))
  }
  // Project collision constraints after integration. Springs must never leave labels
  // interpenetrating at their equilibrium, even when a node is against the viewport.
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = b.x - a.x || .1, dy = b.y - a.y || .1
      const overlapX = (a.width + b.width) / 2 + 12 - Math.abs(dx), overlapY = 70 - Math.abs(dy)
      if (overlapX <= 0 || overlapY <= 0) continue
      if (overlapX < overlapY) { const push = Math.sign(dx) * (overlapX + .1) / 2; a.x -= push; b.x += push }
      else { const push = Math.sign(dy) * (overlapY + .1) / 2; a.y -= push; b.y += push }
    }
    for (const node of nodes) {
      node.x = Math.max(node.width / 2 + 8, Math.min(width - node.width / 2 - 8, node.x))
      node.y = Math.max(36, Math.min(height - 36, node.y))
    }
  }
}
