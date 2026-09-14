export type GraphNode = { id: string; word: string; description?: string; kind?: string }
export type GraphLink = { source: string; target: string; kind: string; provenance?: string }
export type PositionedNode = GraphNode & { x: number; y: number; parentX: number; parentY: number; current: boolean; nearby: boolean }

/** Identify a traversed connection without mistaking unrelated visited nodes for a path. */
export function isPathLink(link: GraphLink, path: string[]) {
  return path.some((id, index) => index > 0 && ((id === link.target && path[index - 1] === link.source) || (id === link.source && path[index - 1] === link.target)))
}

/** Lay out a bounded neighborhood; prior path stays available without running a physics simulation. */
export function layoutGraph(nodes: GraphNode[], links: GraphLink[], activeId: string, path: string[], mobile: boolean, focused: boolean): PositionedNode[] {
  const center = nodes.find(node => node.id === activeId) || nodes[0]
  if (!center) return []
  const neighbors = new Set(links.flatMap(link => link.source === center.id ? [link.target] : link.target === center.id ? [link.source] : []))
  const adjacent = nodes.filter(node => node.id !== center.id && neighbors.has(node.id)).slice(0, mobile ? 4 : 8)
  const chosen = new Set([center.id, ...adjacent.map(node => node.id)])
  const history = nodes.filter(node => !chosen.has(node.id) && (path.includes(node.id) || !focused)).slice(-(mobile ? 2 : 6))
  const ordered = [center, ...adjacent, ...history]
  return ordered.map((node, index) => {
    const current = index === 0
    const nearby = neighbors.has(node.id)
    const slot = index - 1
    const angle = (-145 + (slot % Math.max(adjacent.length, 1)) * (360 / Math.max(adjacent.length, 1))) * Math.PI / 180
    const x = current ? 500 : index <= adjacent.length ? 500 + Math.cos(angle) * (mobile ? 310 : 330) : 90 + (index - adjacent.length - 1) * 150
    const y = current ? 220 : index <= adjacent.length ? 220 + Math.sin(angle) * 148 : 410
    return { ...node, x, y, parentX: 500, parentY: 220, current, nearby }
  })
}
