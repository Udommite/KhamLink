/* Documents live in this browser only. The app is anonymous by design — there is no
   account to attach them to — so localStorage is the whole storage story, and every
   read has to survive a private window, cleared site data, or a quota refusal. */

export interface Doc {
  id: string
  title: string
  body: string
  updated: number
  formality: Formality
  audience: Audience
}

export type Formality = 'formal' | 'neutral' | 'casual'
export type Audience = 'general' | 'academic' | 'student'

const KEY = 'khamlink.docs.v1'
export const UNTITLED = 'เอกสารไม่มีชื่อ'

export const formalityLabels: Record<Formality, string> = {
  formal: 'ทางการ',
  neutral: 'กึ่งทางการ',
  casual: 'ไม่เป็นทางการ',
}
export const audienceLabels: Record<Audience, string> = {
  general: 'ผู้อ่านทั่วไป',
  academic: 'งานวิชาการ',
  student: 'ผู้เรียนภาษาไทย',
}

function blank(doc: Partial<Doc>): Doc {
  return {
    id: doc.id || crypto.randomUUID(),
    title: typeof doc.title === 'string' ? doc.title : UNTITLED,
    body: typeof doc.body === 'string' ? doc.body : '',
    updated: typeof doc.updated === 'number' ? doc.updated : Date.now(),
    formality: doc.formality === 'formal' || doc.formality === 'casual' ? doc.formality : 'neutral',
    audience: doc.audience === 'academic' || doc.audience === 'student' ? doc.audience : 'general',
  }
}

export function load(): Doc[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(d => d && typeof d === 'object').map(blank).sort((a, b) => b.updated - a.updated)
  } catch {
    // Corrupt or unreadable storage must not blank the application.
    return []
  }
}

export function save(docs: Doc[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(docs))
  } catch {
    // Quota or a blocked store: the session keeps working, it just will not persist.
  }
}

export function create(partial: Partial<Doc> = {}): Doc {
  return blank(partial)
}

export function excerpt(doc: Doc, length = 140): string {
  const text = doc.body.replace(/\s+/g, ' ').trim()
  return text.length > length ? text.slice(0, length) + '…' : text
}

/** Relative time in Thai. Absolute dates below a day read as noise while you are writing. */
export function when(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return 'เมื่อสักครู่'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} วันที่แล้ว`
  return new Date(timestamp).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function isToday(timestamp: number, now = Date.now()): boolean {
  const a = new Date(timestamp), b = new Date(now)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** Thai has no inter-word spaces, so a space count is meaningless. Intl.Segmenter knows
    Thai word boundaries in every browser this app supports; the fallback only has to be
    non-absurd, not correct. */
const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter('th', { granularity: 'word' })
  : null

export function countWords(text: string): number {
  if (!text.trim()) return 0
  if (segmenter) {
    let count = 0
    for (const piece of segmenter.segment(text)) if (piece.isWordLike) count++
    return count
  }
  return text.trim().split(/\s+/).length
}
