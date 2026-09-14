import { describe, expect, it } from 'vitest'
import { pieces } from './Editor'
import { countWords, create, excerpt, isToday, load, save, when } from './docs'
import type { Suggestion } from './types'

const span = (id: string, start: number, end: number, category: Suggestion['category'] = 'clarity'): Suggestion => ({
  id, start, end, text: '', word_id: null, category, title: '', message: '', replacements: [], evidence_ids: [],
})

describe('highlight registration', () => {
  it('covers the text exactly once, with no gap and no overlap', () => {
    // Any gap or overlap shifts every later underline off the glyph it marks.
    const out = pieces(20, [span('a', 3, 6), span('b', 10, 14)], null)
    expect(out.map(p => [p.start, p.end])).toEqual([[0, 3], [3, 6], [6, 10], [10, 14], [14, 20]])
    expect(out.filter(p => p.suggestion).map(p => p.suggestion!.id)).toEqual(['a', 'b'])
  })

  it('keeps the longer span when two suggestions overlap', () => {
    const out = pieces(10, [span('short', 2, 4), span('long', 2, 8)], null)
    expect(out.filter(p => p.suggestion).map(p => p.suggestion!.id)).toEqual(['long'])
    expect(out.map(p => [p.start, p.end])).toEqual([[0, 2], [2, 8], [8, 10]])
  })

  it('discards a span that runs past the end of the text', () => {
    // Accepting one replacement shortens the document; a stale span must not paint.
    expect(pieces(5, [span('stale', 3, 99)], null).some(p => p.suggestion)).toBe(false)
  })

  it('paints the selection only where no suggestion already claims the text', () => {
    const out = pieces(12, [span('a', 4, 7)], { start: 2, end: 10 })
    expect(out.map(p => [p.start, p.end, p.suggestion?.id ?? (p.selected ? 'sel' : '')])).toEqual([
      [0, 2, ''], [2, 4, 'sel'], [4, 7, 'a'], [7, 10, 'sel'], [10, 12, ''],
    ])
  })

  it('ignores an empty selection', () => {
    expect(pieces(6, [], { start: 3, end: 3 }).some(p => p.selected)).toBe(false)
  })
})

describe('documents', () => {
  it('counts Thai words rather than whitespace runs', () => {
    // Thai has no inter-word spaces, so a split on /\s+/ would report 1 for all of these.
    expect(countWords('เราช่วยกันอนุรักษ์ภาษาไทย')).toBeGreaterThan(2)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })

  it('survives storage that is unreadable or holds the wrong shape', () => {
    localStorage.setItem('khamlink.docs.v1', 'not json at all')
    expect(load()).toEqual([])
    localStorage.setItem('khamlink.docs.v1', '{"not":"an array"}')
    expect(load()).toEqual([])
    localStorage.setItem('khamlink.docs.v1', '[{"title":"ก"},null,7]')
    const docs = load()
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ title: 'ก', body: '', formality: 'neutral' })
    expect(docs[0].id).toBeTruthy()
  })

  it('round-trips documents and keeps the newest first', () => {
    const older = create({ title: 'เก่า', updated: 1000 })
    const newer = create({ title: 'ใหม่', updated: 2000 })
    save([older, newer])
    expect(load().map(d => d.title)).toEqual(['ใหม่', 'เก่า'])
  })

  it('describes recency in Thai and collapses long bodies', () => {
    const now = Date.UTC(2026, 8, 14, 12, 0, 0)
    expect(when(now - 30_000, now)).toBe('เมื่อสักครู่')
    expect(when(now - 5 * 60_000, now)).toBe('5 นาทีที่แล้ว')
    expect(when(now - 3 * 3600_000, now)).toBe('3 ชั่วโมงที่แล้ว')
    expect(isToday(now - 60_000, now)).toBe(true)
    expect(isToday(now - 3 * 86_400_000, now)).toBe(false)
    expect(excerpt(create({ body: 'ก'.repeat(400) }), 20)).toBe('ก'.repeat(20) + '…')
    expect(excerpt(create({ body: '  หนึ่ง\n\nสอง  ' }))).toBe('หนึ่ง สอง')
  })
})
