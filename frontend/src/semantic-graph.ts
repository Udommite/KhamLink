/** Optional fields accept legacy seeds; expanded nodes always carry reveal provenance. */
export type GraphNode = { id: string; word: string; description?: string; kind?: string; parentId?: string; parentWord?: string; provenance?: string }
export type GraphLink = { source: string; target: string; kind: string; provenance?: string }

export const GRAPH_INTRO_MS = 1600

/** Name the relation on the node itself without presenting inferred metadata as a source. */
export function relationLabel(node: GraphNode): string {
  const names: Record<string, string> = { root: 'จุดเริ่มต้น', related: 'เกี่ยวข้อง', synonym: 'คำพ้อง', opposite: 'คำตรงข้าม', antonym: 'คำตรงข้าม', semantic: 'ใกล้ความหมาย' }
  const origin = node.provenance === 'AI_GENERATED_METADATA' || node.kind === 'semantic' ? 'AI · ' : node.provenance === 'SOURCE_DATA' ? 'พจนานุกรม · ' : node.provenance === 'CURATED_METADATA' ? 'คัดสรร · ' : ''
  return origin + (names[node.kind || 'root'] || node.kind)
}

/** Breadth-first depth choreographs beams from the current focus, including reverse edges. */
export function graphDepths(nodes: GraphNode[], links: GraphLink[], activeId: string): Map<string, number> {
  const depths = new Map<string, number>([[activeId, 0]])
  const queue = [activeId]
  for (const id of queue) for (const edge of links) {
    const next = edge.source === id ? edge.target : edge.target === id ? edge.source : undefined
    if (next && !depths.has(next)) { depths.set(next, depths.get(id)! + 1); queue.push(next) }
  }
  for (const node of nodes) if (!depths.has(node.id)) depths.set(node.id, nodes.length)
  return depths
}

/** Identify a traversed connection without mistaking unrelated visited nodes for a path. */
export function isPathLink(link: GraphLink, path: string[]) {
  return path.some((id, index) => index > 0 && ((id === link.target && path[index - 1] === link.source) || (id === link.source && path[index - 1] === link.target)))
}
