import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, wordHref, wordKeyFromHash } from './api'

afterEach(() => vi.restoreAllMocks())
describe('VAL-036/037/039/047 safe API client', () => {
  it('preserves Thai input and uses anonymous non-cached JSON', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { word: 'อนุรักษ์' }, meta: { correlation_id: 'a' }, error: null })))
    expect(await api('/search', { query: '  อนุรักษ์  ' })).toEqual({ word: 'อนุรักษ์' })
    const args = mock.mock.calls[0][1]!
    expect(args.body).toBe(JSON.stringify({ query: '  อนุรักษ์  ' }))
    expect(args.credentials).toBe('omit')
    expect(args.cache).toBe('no-store')
  })
  it('exposes safe Thai errors and correlation for retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: null, meta: { correlation_id: 'cid' }, error: { code: 'RATE_LIMITED', message: 'กรุณาลองอีกครั้ง' } }), { status: 429 }))
    await expect(api('/search', { query: 'ไทย' })).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'กรุณาลองอีกครั้ง', correlationId: 'cid' })
  })
  it('does not expose an HTML error page as application data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>upstream stack secret</html>', { status: 502 }))
    await expect(api('/search', {})).rejects.toBeInstanceOf(ApiError)
  })
  it('encodes stable navigation identifiers', () => {
    expect(wordHref('อนุรักษ์')).toBe('#/word/' + encodeURIComponent('อนุรักษ์'))
    expect(wordHref('<script>')).not.toContain('<script>')
    expect(wordKeyFromHash(wordHref('อนุรักษ์'))).toBe('อนุรักษ์')
    expect(wordKeyFromHash('#/word/%E0%A4%A')).toBe('w_invalid_route')
    expect(wordKeyFromHash('#/word/')).toBe('w_invalid_route')
    expect(wordKeyFromHash('#/')).toBe('')
  })
})
