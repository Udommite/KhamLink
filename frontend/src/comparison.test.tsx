import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ComparisonWorkspace from './ComparisonWorkspace'
import { api } from './api'

vi.mock('./api', () => ({ api: vi.fn() }))
vi.mock('./WordCard', () => ({ default: ({ word }: { word: { word: string } }) => <h2>{word.word}</h2> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

/** Exercise adding a third word and retain all dictionary columns when AI cannot respond. */
it('compares every input and retains evidence when AI is unavailable', async () => {
  const words = ['คนไข้', 'ผู้ป่วย', 'แพทย์'].map((word, index) => ({ word, word_id: `w_${index}`, definitions: [], curated_metadata: [], ai_generated_metadata: [] }))
  vi.mocked(api).mockResolvedValueOnce({ words, errors: [] }).mockRejectedValueOnce(new Error('offline'))
  render(<ComparisonWorkspace onExplore={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Word 1'), { target: { value: 'คนไข้' } })
  fireEvent.change(screen.getByLabelText('Word 2'), { target: { value: 'ผู้ป่วย' } })
  fireEvent.click(screen.getByRole('button', { name: '+ Add word' }))
  fireEvent.change(screen.getByLabelText('Word 3'), { target: { value: 'แพทย์' } })
  fireEvent.click(screen.getByRole('button', { name: 'Compare words' }))
  await waitFor(() => expect(screen.getByText(/AI comparison is unavailable/)).toBeInTheDocument())
  expect(api).toHaveBeenNthCalledWith(1, '/compare', { word_ids: ['คนไข้', 'ผู้ป่วย', 'แพทย์'] }, expect.any(AbortSignal))
  expect(api).toHaveBeenNthCalledWith(2, '/compare/explanations', { word_ids: ['w_0', 'w_1', 'w_2'] }, expect.any(AbortSignal))
  expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(5)
})

/** Reject duplicate inputs locally before spending an API request. */
it('allows removing columns and rejects duplicate words', async () => {
  render(<ComparisonWorkspace seed={['คำ', 'คำ', 'บริบท']} onExplore={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove word 3' }))
  expect(screen.queryByLabelText('Word 3')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Compare words' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Choose different words')
  expect(api).not.toHaveBeenCalled()
})

/** Keep edits and loaded evidence across parent rerenders, while accepting a new example seed. */
it('preserves comparison state until the seed changes', async () => {
  const words = ['คำ', 'บริบท'].map((word, index) => ({ word, word_id: `w_${index}`, definitions: [], curated_metadata: [], ai_generated_metadata: [] }))
  vi.mocked(api).mockResolvedValueOnce({ words, errors: [] }).mockRejectedValueOnce(new Error('offline'))
  const onExplore = vi.fn()
  const { rerender } = render(<ComparisonWorkspace seed={['คำ', 'บริบท']} onExplore={onExplore} />)
  fireEvent.change(screen.getByLabelText('Word 1'), { target: { value: 'แก้ไข' } })
  rerender(<ComparisonWorkspace seed={['คำ', 'บริบท']} onExplore={onExplore} />)
  expect(screen.getByLabelText('Word 1')).toHaveValue('แก้ไข')
  fireEvent.change(screen.getByLabelText('Word 1'), { target: { value: 'คำ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Compare words' }))
  await waitFor(() => expect(screen.getByText(/AI comparison is unavailable/)).toBeInTheDocument())
  rerender(<ComparisonWorkspace seed={['ประสิทธิภาพ', 'ประสิทธิผล']} onExplore={onExplore} />)
  await waitFor(() => expect(screen.getByLabelText('Word 1')).toHaveValue('ประสิทธิภาพ'))
  expect(screen.queryByText(/AI comparison is unavailable/)).not.toBeInTheDocument()
})

/** Label extractive output as source text so it cannot read as synthesized practical advice. */
it('labels extractive comparison evidence', async () => {
  const words = ['คำ', 'บริบท'].map((word, index) => ({ word, word_id: `w_${index}`, definitions: [], curated_metadata: [], ai_generated_metadata: [] }))
  vi.mocked(api).mockResolvedValueOnce({ words, errors: [] }).mockResolvedValueOnce({
    state: 'grounded', mode: 'extractive', claims: [], evidence: [], provenance: 'AI_GENERATED_METADATA', limitation: 'อ่านข้อความเต็มจากแหล่งข้อมูล',
  })
  render(<ComparisonWorkspace seed={['คำ', 'บริบท']} onExplore={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Compare words' }))
  await waitFor(() => expect(screen.getByText('Source extracts')).toBeInTheDocument())
  expect(screen.getByText(/extractive text selected/)).toBeInTheDocument()
})
