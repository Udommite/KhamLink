import { describe, expect, it, vi } from 'vitest'
import { debouncedSave, type Doc } from './docs'

const doc = (body: string): Doc[] => [{ id: 'a', title: 't', body, updated: 1, formality: 'neutral', audience: 'general' }]

describe('debounced document saving', () => {
  it('collapses a burst of keystrokes into one write', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const saver = debouncedSave(700, write)
    for (const body of ['ก', 'กข', 'กขค']) { saver.queue(doc(body)); vi.advanceTimersByTime(100) }
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(700)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0][0].body).toBe('กขค')
    vi.useRealTimers()
  })

  /** The property that makes the debounce safe: closing the tab mid-burst must not drop
      the last edit, and a flush must never write the same state twice. */
  it('flushes pending work immediately and only once', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const saver = debouncedSave(700, write)
    saver.queue(doc('ยังไม่ได้บันทึก'))
    saver.flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0][0].body).toBe('ยังไม่ได้บันทึก')
    saver.flush()
    vi.advanceTimersByTime(2000)
    expect(write).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
