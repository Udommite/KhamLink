import { describe, expect, it } from 'vitest'
import { isPathLink, relationLabel } from './semantic-graph'

describe('semantic constellation', () => {
  /** Only consecutive traversed words form the active path. */
  it('recognises consecutive traversed edges and nothing else', () => {
    expect(isPathLink({ source: '1', target: '0', kind: 'related' }, ['1', '0', '2'])).toBe(true)
    expect(isPathLink({ source: '0', target: '2', kind: 'related' }, ['1', '0', '2'])).toBe(true)
    expect(isPathLink({ source: '1', target: '2', kind: 'related' }, ['1', '0', '2'])).toBe(false)
    expect(isPathLink({ source: '1', target: '0', kind: 'related' }, [])).toBe(false)
  })
  /** The node no longer prints its relation, so the label has to survive as its name. */
  it('names provenance and relation for the accessible label', () => {
    expect(relationLabel({ id: 'a', word: 'a', kind: 'semantic', provenance: 'AI_GENERATED_METADATA' })).toBe('AI · ใกล้ความหมาย')
    expect(relationLabel({ id: 'b', word: 'b', kind: 'synonym', provenance: 'SOURCE_DATA' })).toBe('พจนานุกรม · คำพ้อง')
    expect(relationLabel({ id: 'c', word: 'c' })).toBe('จุดเริ่มต้น')
  })
})
