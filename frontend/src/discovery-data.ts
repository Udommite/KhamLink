import type { GraphLink, GraphNode } from './semantic-graph'
import type { Related, Word } from './types'

export interface Network { nodes: GraphNode[]; links: GraphLink[] }

/** Preserve source text as text while decoding the corpus's legacy formatting markers. */
export function readableText(text: string): string {
  return text.replace(/&#(\d+);/g, (original, code: string) => {
    const value = Number(code)
    return value <= 0x10ffff ? String.fromCodePoint(value).replace(/\u00a0/g, ' ') : original
  }).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/<\d+t>/g, '\n')
}

/** Match the backend's Unicode code-point limit rather than UTF-16 string length. */
export function validQuery(query: string, limit: number): boolean {
  return Boolean(query.trim()) && Array.from(query.trim()).length <= limit
}

/** Merge one live neighbourhood, retaining prior exploration and stronger source evidence. */
export function expandNetwork(previous: Network, word: Word, related?: Related): Network {
  const nodes = new Map(previous.nodes.map(node => [node.id, node]))
  const links = new Map(previous.links.map(link => [`${link.source}:${link.target}`, link]))
  nodes.set(word.word_id, { id: word.word_id, word: word.word, description: readableText(word.definitions[0]?.text || '') })
  const neighbours = [
    ...(related?.relationships || []).map(edge => ({ id: edge.word_id || edge.to_id, word: edge.word, description: edge.description, kind: edge.type, provenance: edge.provenance })),
    ...(related?.semantic_neighbours || []).map(node => ({ id: node.word_id, word: node.word, description: node.description, kind: 'semantic', provenance: node.provenance })),
  ]
  const seen = new Set<string>([word.word_id])
  for (const node of neighbours) {
    if (!node.id || seen.has(node.id)) continue
    seen.add(node.id)
    nodes.set(node.id, { id: node.id, word: node.word, description: readableText(node.description), kind: node.kind })
    const key = `${word.word_id}:${node.id}`
    const existing = links.get(key)
    if (!existing || existing.provenance === 'AI_GENERATED_METADATA') {
      links.set(key, { source: word.word_id, target: node.id, kind: node.kind, provenance: node.provenance })
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] }
}
