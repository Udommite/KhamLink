import { describe, expect, it } from 'vitest'
import { layoutGraph, isPathLink, type GraphNode, type GraphLink } from './semantic-graph'

const nodes: GraphNode[] = Array.from({ length: 12 }, (_, index) => ({ id: String(index), word: `word ${index}` }))
const links: GraphLink[] = nodes.slice(1).map(node => ({ source: '0', target: node.id, kind: 'related' }))

describe('semantic constellation', () => {
  /** Stable layout keeps the focused word at the center and limits surrounding clutter. */
  it('lays out deterministically with a bounded focused neighborhood', () => {
    const result = layoutGraph(nodes, links, '0', [], false, true)
    expect(result).toEqual(layoutGraph(nodes, links, '0', [], false, true))
    expect(result[0]).toMatchObject({ id: '0', x: 500, y: 220 })
    expect(result).toHaveLength(9)
    expect(new Set(result.map(node => `${node.x},${node.y}`)).size).toBe(result.length)
    expect(layoutGraph(nodes, links, '0', [], true, true)).toHaveLength(5)
  })
  /** Only consecutive traversed words form the active path. */
  it('keeps explored path words and recognizes consecutive edges', () => {
    expect(isPathLink({ source: '1', target: '0', kind: 'related' }, ['1', '0', '2'])).toBe(true)
    expect(isPathLink({ source: '1', target: '2', kind: 'related' }, ['1', '0', '2'])).toBe(false)
    expect(layoutGraph(nodes, links, '0', ['10', '11', '0'], false, true).map(node => node.id)).toContain('11')
    expect(layoutGraph([], [], 'missing', [], false, true)).toEqual([])
  })
})
