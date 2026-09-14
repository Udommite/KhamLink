import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ComparisonWorkspace from './ComparisonWorkspace'
import { api } from './api'
import type { Explanation, Related, Source, Word } from './types'

/** Isolate network responses while exercising the real source disclosure. */
vi.mock('./api', () => ({ api: vi.fn() }))
/** Discard DOM and response handlers between cases. */
afterEach(() => { cleanup(); vi.resetAllMocks() })

const source: Source = { source_id: 's', name: 'Dictionary', version: '2026', dataset_id: 'd', license: 'CC0', license_url: 'https://example.com/license', official_royal_society: false, provenance: 'SOURCE_DATA' }
/** Build complete dictionary evidence with distinct primary senses. */
function word(term: string): Word {
  return { word_id: `w_${term}`, word: term, dataset_id: 'd', source, curated_metadata: [], ai_generated_metadata: [],
    definitions: [{ definition_id: `d_${term}`, number: 1, text: `Meaning of ${term}`, part_of_speech: 'noun', metadata: { register: term === 'b' ? 'formal' : 'neutral' }, record_url: 'https://example.com/entry', history_url: '', source, provenance: 'SOURCE_DATA' }] }
}
/** Return the endpoint's actual empty-source and available-AI state names. */
function related(): Related {
  return { center: { word_id: 'w', word: 'word' }, relationships: [], semantic_neighbours: [], semantic_neighbours_state: 'available', state: 'no_relationships', dataset_id: 'd' }
}
/** Route parallel dictionary, related and explanation requests independently. */
function respond(explanation?: Explanation) {
  vi.mocked(api).mockImplementation(async (path, payload) => {
    if (path === '/compare') return { words: (payload as { word_ids: string[] }).word_ids.map(word), errors: [] }
    if (path === '/compare/explanations') {
      if (explanation) return explanation
      throw new Error('AI offline')
    }
    if (path.endsWith('/related')) return related()
    return word(decodeURIComponent(path.slice('/words/'.length)))
  })
}
/** Access one field's horizontally adjacent cells. */
function cells(label: string) {
  return within(screen.getByRole('rowheader', { name: label }).closest('tr')!).getAllByRole('cell')
}

/** REQ-UX-024: five shared rows replace editable, vertically stacked cards. */
it('aligns all five fields and distinguishes agreements, differences and source evidence', async () => {
  respond()
  const onExplore = vi.fn()
  const { container } = render(<ComparisonWorkspace seed={['a', 'b']} onExplore={onExplore} />)
  await screen.findByText(/AI comparison is unavailable/)
  expect(container.querySelector('input')).toBeNull()
  expect(screen.getAllByRole('row')).toHaveLength(5)
  for (const label of ['Headword', 'Part of speech', 'Register', 'Primary sense', 'Related-word set']) expect(cells(label)).toHaveLength(2)
  expect(cells('Part of speech').every(cell => cell.classList.contains('is-same'))).toBe(true)
  expect(cells('Register').every(cell => cell.classList.contains('is-different'))).toBe(true)
  expect(cells('Related-word set').every(cell => cell.classList.contains('is-same'))).toBe(true)
  expect(screen.getAllByText('Meaning of a')).toHaveLength(1)
  expect(screen.getAllByRole('link', { name: /เปิดแหล่งข้อมูล/ })).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'a ↗' }))
  expect(onExplore).toHaveBeenCalledWith('a')
  expect(api).toHaveBeenCalledWith('/compare/explanations', { word_ids: ['w_a', 'w_b'] }, expect.any(AbortSignal))
})

/** Zero/one chips never hit the API's two-word comparison minimum. */
it('handles zero, one and removed chips, without refetching equal seeds', async () => {
  respond()
  const onExplore = vi.fn()
  const { rerender } = render(<ComparisonWorkspace seed={[]} onExplore={onExplore} />)
  expect(api).not.toHaveBeenCalled()
  expect(screen.getByText(/Add words using/)).toBeInTheDocument()
  rerender(<ComparisonWorkspace seed={['a']} onExplore={onExplore} />)
  await screen.findByText('Meaning of a')
  expect(api).toHaveBeenCalledWith('/words/a', undefined, expect.any(AbortSignal))
  expect(screen.getByText(/Add another word/)).toBeInTheDocument()
  expect(cells('Headword')).toHaveLength(1)
  const count = vi.mocked(api).mock.calls.length
  rerender(<ComparisonWorkspace seed={['a']} onExplore={onExplore} />)
  expect(api).toHaveBeenCalledTimes(count)
  rerender(<ComparisonWorkspace seed={['a', 'b', 'c', 'd']} onExplore={onExplore} />)
  await screen.findByText('Meaning of d')
  expect(cells('Headword')).toHaveLength(4)
  rerender(<ComparisonWorkspace seed={['b']} onExplore={onExplore} />)
  await waitFor(() => expect(cells('Headword')).toHaveLength(1))
  expect(screen.queryByText('Meaning of a')).not.toBeInTheDocument()
  rerender(<ComparisonWorkspace seed={[]} onExplore={onExplore} />)
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

/** Enforce existing Unicode input bounds without introducing a column cap. */
it('rejects duplicate and oversized seeds before fetching', () => {
  const onExplore = vi.fn()
  const { rerender } = render(<ComparisonWorkspace seed={['a', 'a']} onExplore={onExplore} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Choose different words')
  rerender(<ComparisonWorkspace seed={['a'.repeat(513), 'b']} onExplore={onExplore} />)
  expect(screen.getByRole('alert')).toHaveTextContent('512 characters')
  rerender(<ComparisonWorkspace seed={Array.from({ length: 9 }, (_, i) => String(i).repeat(512))} onExplore={onExplore} />)
  expect(screen.getByRole('alert')).toHaveTextContent('4096 characters')
  expect(api).not.toHaveBeenCalled()
})

/** A rejected dictionary call can be retried from the panel without another input. */
it('retries a failed dictionary fetch', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Dictionary offline'))
  render(<ComparisonWorkspace seed={['a', 'b']} onExplore={vi.fn()} />)
  await screen.findByRole('alert')
  respond()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Meaning of a')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

/** Partial lookup and related failures must not suppress successful dictionary evidence. */
it('retains partial evidence and does not treat missing metadata as agreement', async () => {
  const entry = word('a')
  entry.definitions[0].metadata = {}
  vi.mocked(api).mockImplementation(async path => {
    if (path === '/compare') return { words: [entry], errors: [{ word_id: 'missing', message: 'Not found' }] }
    throw new Error('Related offline')
  })
  render(<ComparisonWorkspace seed={['a', 'missing']} onExplore={vi.fn()} />)
  await screen.findByText('Related words unavailable.')
  expect(screen.getByRole('alert')).toHaveTextContent('missing: Not found')
  expect(screen.getByText('Meaning of a')).toBeInTheDocument()
  expect(cells('Register')[0]).toHaveClass('is-unknown')
  expect(cells('Related-word set')[0]).toHaveClass('is-unknown')
  expect(vi.mocked(api).mock.calls.some(([path]) => path === '/compare/explanations')).toBe(false)
})

/** Source/AI related sets stay distinct and compare independent of result order. */
it('renders related-word sets with provenance and exploration actions', async () => {
  respond()
  const fallback = vi.mocked(api).getMockImplementation()!
  vi.mocked(api).mockImplementation(async (path, payload, signal) => {
    if (!path.endsWith('/related')) return fallback(path, payload, signal)
    const map = related()
    map.state = 'available'
    map.relationships = ['x', 'y'].map(term => ({ relationship_id: term, to_id: term, type: 'synonym', word: term, description: '', provenance: 'SOURCE_DATA', process_id: '', evidence_ids: ['d'], source }))
    if (path.includes('w_b')) map.relationships.reverse()
    map.semantic_neighbours = [{ word_id: 'z', definition_id: 'dz', word: 'z', description: '', similarity: 0.7, provenance: 'AI_GENERATED_METADATA' }]
    return map
  })
  const onExplore = vi.fn()
  render(<ComparisonWorkspace seed={['a', 'b']} onExplore={onExplore} />)
  await screen.findAllByRole('button', { name: 'z' })
  expect(cells('Related-word set').every(cell => cell.classList.contains('is-same'))).toBe(true)
  expect(screen.getAllByText('synonym · Dictionary')).toHaveLength(4)
  expect(screen.getAllByText('Semantic neighbours · AI')).toHaveLength(2)
  fireEvent.click(screen.getAllByRole('button', { name: 'z' })[0])
  expect(onExplore).toHaveBeenCalledWith('z')
})

/** Grounded extractive claims retain only citations actually returned by the server. */
it('preserves grounded claims, citations, extractive labels and limitations', async () => {
  const entry = word('a')
  respond({ state: 'grounded', mode: 'extractive', claims: [{ word: 'a', number: 1, text: 'Grounded claim', evidence_ids: ['d_a', 'invented'], source_version: '2026', provenance: 'AI_GENERATED_METADATA' }], evidence: [{ ...entry.definitions[0], word: 'a', word_id: 'w_a' }], provenance: 'AI_GENERATED_METADATA', limitation: 'Source extracts only.' })
  render(<ComparisonWorkspace seed={['a', 'b']} onExplore={vi.fn()} />)
  await screen.findByText('Source extracts')
  expect(screen.getByText('Grounded claim')).toBeInTheDocument()
  expect(screen.getByText('Dictionary · 2026 · definition 1')).toBeInTheDocument()
  expect(screen.getByText('Source extracts only.')).toBeInTheDocument()
  expect(screen.queryByText('invented')).not.toBeInTheDocument()
})

/** Ignore a dictionary response that arrives after its chips have been replaced. */
it('aborts stale dictionary work and ignores late results', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(api).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { rerender } = render(<ComparisonWorkspace seed={['old', 'older']} onExplore={vi.fn()} />)
  const signal = vi.mocked(api).mock.calls[0][2]!
  respond()
  rerender(<ComparisonWorkspace seed={['a', 'b']} onExplore={vi.fn()} />)
  await screen.findByText('Meaning of a')
  await act(async () => { finish({ words: [word('old'), word('older')], errors: [] }) })
  expect(signal.aborted).toBe(true)
  expect(screen.queryByText('Meaning of old')).not.toBeInTheDocument()
})

/** The shared abort signal also protects late AI and relation responses and unmounts. */
it('ignores late enhancements after chip removal and aborts on unmount', async () => {
  const pending: ((value: unknown) => void)[] = []
  vi.mocked(api).mockImplementation(async (path, payload) => {
    if (path === '/compare') return { words: (payload as { word_ids: string[] }).word_ids.map(word), errors: [] }
    return new Promise(resolve => { pending.push(resolve) })
  })
  const { rerender, unmount } = render(<ComparisonWorkspace seed={['old', 'older']} onExplore={vi.fn()} />)
  await waitFor(() => expect(pending).toHaveLength(3))
  const oldSignal = vi.mocked(api).mock.calls[1][2]!
  respond()
  rerender(<ComparisonWorkspace seed={['a']} onExplore={vi.fn()} />)
  await screen.findByText('Meaning of a')
  await act(async () => {
    pending[0](related()); pending[1](related())
    pending[2]({ state: 'grounded', claims: [{ word: 'old', text: 'Stale claim', evidence_ids: [] }], evidence: [] })
  })
  expect(oldSignal.aborted).toBe(true)
  expect(screen.queryByText('Stale claim')).not.toBeInTheDocument()
  const signal = vi.mocked(api).mock.calls.at(-1)![2]!
  unmount()
  expect(signal.aborted).toBe(true)
})
