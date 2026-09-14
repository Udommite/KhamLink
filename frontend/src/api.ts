export class ApiError extends Error {
  constructor(message: string, public code: string, public correlationId = '') { super(message) }
}

export async function api<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${path}`, { method: payload === undefined ? 'GET' : 'POST', headers: payload === undefined ? {} : { 'Content-Type': 'application/json' }, body: payload === undefined ? undefined : JSON.stringify(payload), signal, credentials: 'omit', cache: 'no-store' })
  let envelope
  try { envelope = await response.json() } catch { throw new ApiError('เชื่อมต่อระบบไม่ได้ กรุณาลองอีกครั้ง', 'NETWORK_ERROR') }
  if (!response.ok || envelope.error) throw new ApiError(envelope.error?.message || 'ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้ง', envelope.error?.code || 'SERVICE_ERROR', envelope.meta?.correlation_id)
  return envelope.data as T
}

export function track(name: string, refs: Record<string, string | number> = {}) {
  void api('/events', { name, refs }).catch(() => undefined)
}

export const wordHref = (id: string) => `#/word/${encodeURIComponent(id)}`

// Malformed user-supplied fragments must reach the normal unavailable-card state,
// not throw during rendering and blank the entire anonymous application.
export function wordKeyFromHash(hash: string): string {
  if (!hash.startsWith('#/word/')) return ''
  try { return decodeURIComponent(hash.slice(7)) || 'w_invalid_route' }
  catch { return 'w_invalid_route' }
}
