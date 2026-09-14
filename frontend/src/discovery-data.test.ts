import { describe, expect, it } from 'vitest'
import { expandNetwork, readableText, validQuery } from './discovery-data'
import type { Related, Word } from './types'

/** Fixtures keep source relationships distinct from model-generated neighbours. */
const word = { word_id: 'patient', word: 'คนไข้', definitions: [{ text: 'ผู้ป่วย' }] } as Word
const related = {
  relationships: [{ word_id: 'doctor', word: 'แพทย์', type: 'related', description: 'ผู้รักษา', provenance: 'SOURCE_DATA' }],
  semantic_neighbours: [{ word_id: 'doctor', word: 'แพทย์', description: 'ผู้รักษา', provenance: 'AI_GENERATED_METADATA' }, { word_id: 'nurse', word: 'พยาบาล', description: 'ผู้ดูแล', provenance: 'AI_GENERATED_METADATA' }],
} as Related

describe('Discover live graph and input boundaries', () => {
  it('deduplicates neighbours without overwriting source provenance', () => {
    const result = expandNetwork({ nodes: [], links: [] }, word, related)
    expect(result.nodes.map(node => node.id)).toEqual(['patient', 'doctor', 'nurse'])
    expect(result.links).toHaveLength(2)
    expect(result.links[0]).toMatchObject({ kind: 'related', provenance: 'SOURCE_DATA' })
    expect(result.links[1]).toMatchObject({ kind: 'semantic', provenance: 'AI_GENERATED_METADATA' })
    expect(expandNetwork(result, word, related)).toEqual(result)
  })
  it('preserves earlier exploration when another node expands', () => {
    const first = expandNetwork({ nodes: [], links: [] }, word, related)
    const next = expandNetwork(first, { ...word, word_id: 'doctor', word: 'แพทย์' }, { relationships: [], semantic_neighbours: [] } as unknown as Related)
    expect(next.nodes).toHaveLength(3)
    expect(next.links).toEqual(first.links)
  })
  it('validates unicode code points while preserving meaningful Thai input', () => {
    expect(validQuery('  คนไข้  ', 5)).toBe(true)
    expect(validQuery('   ', 300)).toBe(false)
    expect(validQuery('😀😀', 2)).toBe(true)
    expect(validQuery('ภาษาไทย', 2)).toBe(false)
  })
  it('decodes corpus entities as plain text, never executable markup', () => {
    expect(readableText('คำ&#160;ๆ &amp; ภาษา<2t>น.')).toBe('คำ ๆ & ภาษา\nน.')
    expect(readableText('&#99999999;')).toBe('&#99999999;')
    expect(readableText('<script>alert(1)</script>')).toContain('<script>')
  })
})
