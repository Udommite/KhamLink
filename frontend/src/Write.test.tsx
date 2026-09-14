import { describe, expect, it } from 'vitest'
import { replaceSpan } from './Write'

/** Backend offsets count Unicode code points, and stale selections must never alter saved prose. */
describe('writing replacement safety', () => {
  it('replaces a Thai span after an emoji without damaging either neighbour', () => {
    expect(replaceSpan('🌱คนไข้มา', { start: 1, end: 6, text: 'คนไข้' }, 'ผู้ป่วย')).toBe('🌱ผู้ป่วยมา')
  })
  it('ignores a stale or out-of-bounds selection', () => {
    expect(replaceSpan('ข้อความใหม่', { start: 0, end: 3, text: 'เก่า' }, 'คำ')).toBe('ข้อความใหม่')
    expect(replaceSpan('คำ', { start: -1, end: 2, text: 'คำ' }, 'ภาษา')).toBe('คำ')
  })
})
