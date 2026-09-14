import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Suggestion, Token } from './types'

/* The writing surface.

   A transparent <textarea> sits exactly on top of a mirror <div> that renders the same
   string with <mark> around each suggested span. The textarea owns the caret, the IME and
   the undo stack; the mirror owns the paint. This is the only approach that keeps Thai
   caret behaviour correct — contenteditable mangles carets around upper and lower vowel
   marks — and it is only correct while both layers resolve to identical text metrics, so
   every font, size, line-height, padding and wrapping rule for them lives in one CSS block
   (`.sheet .mirror, .sheet textarea`). Changing one without the other drifts the
   underlines off the glyphs they mark. */

interface Props {
  value: string
  onChange: (value: string) => void
  suggestions: Suggestion[]
  tokens: Token[]
  activeId: string | null
  selection: { start: number; end: number } | null
  onActivate: (id: string) => void
  onSelect: (range: { start: number; end: number; text: string; tokenId: string | null } | null) => void
  placeholder?: string
}

interface Piece { start: number; end: number; suggestion?: Suggestion; selected?: boolean }

/** Split the text into non-overlapping painted pieces. Suggestions win over the live
    selection where they collide, because the selection is transient and the underline is
    the thing the reader is being asked to act on. */
export function pieces(length: number, suggestions: Suggestion[], selection: Props['selection']): Piece[] {
  const marks = suggestions
    .filter(s => s.start < s.end && s.start >= 0 && s.end <= length)
    .sort((a, b) => a.start - b.start || b.end - a.end)
  const out: Piece[] = []
  let cursor = 0
  for (const suggestion of marks) {
    if (suggestion.start < cursor) continue // a longer span already covers this one
    if (suggestion.start > cursor) out.push({ start: cursor, end: suggestion.start })
    out.push({ start: suggestion.start, end: suggestion.end, suggestion })
    cursor = suggestion.end
  }
  if (cursor < length) out.push({ start: cursor, end: length })

  if (!selection || selection.start >= selection.end) return out
  // Paint the selection only across stretches no suggestion already claims.
  const split: Piece[] = []
  for (const piece of out) {
    const from = Math.max(piece.start, selection.start)
    const to = Math.min(piece.end, selection.end)
    if (piece.suggestion || from >= to) { split.push(piece); continue }
    if (piece.start < from) split.push({ start: piece.start, end: from })
    split.push({ start: from, end: to, selected: true })
    if (to < piece.end) split.push({ start: to, end: piece.end })
  }
  return split
}

export default function Editor({ value, onChange, suggestions, tokens, activeId, selection, onActivate, onSelect, placeholder }: Props) {
  const area = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)

  // Thai stays inside the BMP, so code points and UTF-16 units agree — but the backend
  // counts code points, so index through the same unit it does rather than assume.
  const characters = useMemo(() => Array.from(value), [value])
  const painted = useMemo(() => pieces(characters.length, suggestions, selection), [characters.length, suggestions, selection])

  // Grow to fit: the surface scrolls, never the textarea, so the mirror never has to
  // track a second scroll offset.
  useLayoutEffect(() => {
    const node = area.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [value])

  useEffect(() => {
    if (!activeId || !mirror.current) return
    mirror.current.querySelector(`[data-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId])

  const reportSelection = useCallback(() => {
    const node = area.current
    if (!node) return
    const start = Array.from(node.value.slice(0, node.selectionStart)).length
    const end = Array.from(node.value.slice(0, node.selectionEnd)).length
    if (end > start) {
      onSelect({ start, end, text: characters.slice(start, end).join(''), tokenId: null })
      return
    }
    // A caret with no selection still asks a question: which word am I sitting in? Thai
    // has no spaces, so the browser cannot answer it — our own tokens can.
    const token = tokens.find(t => start >= t.start && start <= t.end)
    onSelect(token ? { start: token.start, end: token.end, text: token.text, tokenId: token.word_id } : null)
  }, [characters, tokens, onSelect])

  return (
    <div className="sheet">
      <div className="mirror" ref={mirror} aria-hidden="true">
        {painted.map(piece => {
          const text = characters.slice(piece.start, piece.end).join('')
          if (!piece.suggestion && !piece.selected) return <React.Fragment key={piece.start}>{text}</React.Fragment>
          return (
            <mark
              key={piece.start}
              data-id={piece.suggestion?.id}
              data-cat={piece.suggestion?.category || 'selection'}
              data-active={piece.suggestion ? String(piece.suggestion.id === activeId) : undefined}
            >{text}</mark>
          )
        })}
        {/* A trailing newline collapses in a block box but not in a textarea; this keeps
            the two layers the same height when the document ends on a blank line. */}
        {value.endsWith('\n') ? '​' : null}
      </div>
      <textarea
        ref={area}
        value={value}
        onChange={event => onChange(event.target.value)}
        onSelect={reportSelection}
        onKeyUp={reportSelection}
        // React's onSelect does not fire for every way a selection can end; a mouse
        // drag that finishes outside the textarea is the common one.
        onMouseUp={reportSelection}
        onTouchEnd={reportSelection}
        onClick={event => {
          reportSelection()
          // Clicking directly on an underlined span should open its card, the way it does
          // in the reference. The mirror is not hit-testable, so resolve by offset.
          const node = area.current
          if (!node) return
          const at = Array.from(node.value.slice(0, node.selectionStart)).length
          const hit = suggestions.find(s => at >= s.start && at <= s.end)
          if (hit) onActivate(hit.id)
          else if (event.detail > 1) reportSelection()
        }}
        onBlur={() => { /* keep the last selection so the rail stays readable */ }}
        placeholder={placeholder}
        spellCheck={false}
        aria-label="ข้อความของคุณ"
      />
    </div>
  )
}
