export type MarkdownSpan = { start: number; end: number; kind: 'marker' | 'bold' | 'italic' | 'heading' | 'list' }

/** Plain-text offsets stay intact: the mirror never inserts or removes glyph advances. */
export function markdownSpans(text: string): MarkdownSpan[] {
  const spans: MarkdownSpan[] = []
  const add = (start: number, end: number, kind: MarkdownSpan['kind']) => spans.push({ start, end, kind })
  for (const match of text.matchAll(/^(#{1,6} |[-*+] |\d+\. )(.+)$/gm)) {
    const start = match.index!
    add(start, start + match[1].length, 'marker')
    add(start + match[1].length, start + match[0].length, match[1][0] === '#' ? 'heading' : 'list')
  }
  for (const match of text.matchAll(/\*\*([^*\n]+)\*\*|(?<!\*)\*([^*\n]+)\*(?!\*)/g)) {
    const start = match.index!, size = match[1] ? 2 : 1
    add(start, start + size, 'marker'); add(start + size, start + match[0].length - size, match[1] ? 'bold' : 'italic'); add(start + match[0].length - size, start + match[0].length, 'marker')
  }
  return spans
}

/** Indent whole selected lines, excluding the next line when selection ends at its start. */
export function indentEdit(value: string, start: number, end: number, outdent: boolean) {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const last = end > start && value[end - 1] === '\n' ? end - 1 : end
  const lineEnd = value.indexOf('\n', last)
  const to = lineEnd < 0 ? value.length : lineEnd
  const lines = value.slice(from, to).split('\n')
  const updated = lines.map(line => outdent ? line.replace(/^( {1,2}|\t)/, '') : '  ' + line)
  const firstDelta = updated[0].length - lines[0].length
  const totalDelta = updated.join('\n').length - lines.join('\n').length
  return { from, to, text:updated.join('\n'), start:Math.max(from, start + firstDelta), end:Math.max(from, end + (start === end ? firstDelta : totalDelta)) }
}
