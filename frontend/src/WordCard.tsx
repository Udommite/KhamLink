import { useId } from 'react'
import { readableText } from './discovery-data'
import type { Definition, Related, Source, Word } from './types'

interface Props {
  word: Word
  related?: Related
  onExplore?: (term: string) => void
  onClose?: () => void
  compact?: boolean
  onReplace?: (term: string) => void
}

const metadataLabels: Record<string, string> = {
  pronunciation: 'คำอ่าน', ipa: 'เสียงอ่าน', register: 'ระดับภาษา',
  note: 'ข้อสังเกต', usage: 'การใช้', etymology: 'ที่มาของคำ', context: 'บริบท', collocations: 'คำที่ใช้ร่วมกัน',
}

/** Only open web URLs supplied by source records; text itself is always rendered by React. */
function sourceUrl(url?: string): string | undefined {
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

/** Keep each definition's source, edition and rights available directly alongside its text. */
export function DefinitionSource({ source, definition }: { source: Source; definition?: Definition }) {
  const url = sourceUrl(definition?.record_url || source.license_url)
  return (
    <details className="definition-source">
      <summary><span className="source-dot" />{source.official_royal_society ? 'ราชบัณฑิตยสภา' : source.name}<span className="source-expand">แหล่งข้อมูล ↗</span></summary>
      <div className="source-details">
        <p>{source.name}</p>
        <p>รุ่น {source.version}{definition?.metadata.edition ? ` · ${definition.metadata.edition.replace('royal_', 'พ.ศ. ')}` : ''}</p>
        <p>{source.license}</p>
        {url && <a href={url} target="_blank" rel="noreferrer">เปิดแหล่งข้อมูลต้นฉบับ ↗</a>}
      </div>
    </details>
  )
}

/** A source-first sense with optional metadata, never invented usage or formality. */
function WordSense({ sense }: { sense: Definition }) {
  return (
    <section className="word-sense">
      <div className="word-sense-label"><span>{String(sense.number).padStart(2, '0')}</span>{sense.part_of_speech && <span>{sense.part_of_speech}</span>}</div>
      <p className="word-definition">{readableText(sense.text)}</p>
      {Object.entries(metadataLabels).filter(([key]) => sense.metadata[key]).map(([key, label]) => (
        <div className="word-metadata" key={key}>
          <span>{label}</span><p>{readableText(sense.metadata[key]!)}</p>
        </div>
      ))}
      <DefinitionSource source={sense.source} definition={sense} />
    </section>
  )
}

/** One reusable inspector for Discover, comparison and selected words in Write. */
export default function WordCard({ word, related, onExplore, onClose, compact = false, onReplace }: Props) {
  const titleId = useId()
  const first = word.definitions[0]
  if (!first || !word.source) return <p role="status">ข้อมูลคำนี้ยังไม่ครบ กรุณาลองคำอื่น</p>
  const sourceRelations = related?.relationships || []
  const neighbours = related?.semantic_neighbours || []
  return (
    <article className={`word-card${compact ? ' word-card-compact' : ''}`} aria-labelledby={titleId}>
      <div className="word-card-eyebrow"><span><i /> WORD NOTES</span>{onClose && <button className="lab-icon" onClick={onClose} aria-label="ปิดข้อมูลคำ">×</button>}</div>
      <div className="word-card-heading"><h2 id={titleId}>{word.word}</h2><span>{word.definitions.length} ความหมาย</span></div>
      <WordSense sense={first} />
      {word.definitions.length > 1 && (
        <details className="word-more">
          <summary>อีก {word.definitions.length - 1} ความหมาย <span>＋</span></summary>
          {word.definitions.slice(1).map(sense => <WordSense key={sense.definition_id} sense={sense} />)}
        </details>
      )}
      {word.curated_metadata?.length > 0 && <details className="word-more"><summary>บันทึกการใช้คำ <span>＋</span></summary>{word.curated_metadata.map(note => <p className="word-curated" key={note.id}>{note.text}<small>ข้อมูลที่ผ่านการเรียบเรียง · {note.evidence_ids.join(', ')}</small></p>)}</details>}
      {word.ai_generated_metadata?.length > 0 && <details className="word-more"><summary>คำอธิบายจาก AI <span>＋</span></summary>{word.ai_generated_metadata.map(note => <p className="word-curated" key={note.id}>{note.text}<small>AI · {note.evidence_ids.join(', ')}</small></p>)}</details>}
      {sourceRelations.length > 0 && <div className="word-connections"><h3>ความสัมพันธ์ในพจนานุกรม</h3><div>{sourceRelations.map(edge => <button key={edge.relationship_id} onClick={() => onExplore?.(edge.word)} disabled={!onExplore}>{edge.word}<span>↗</span></button>)}</div></div>}
      {neighbours.length > 0 && <div className="word-connections"><h3>ใกล้กันทางความหมาย <small>AI</small></h3><div>{neighbours.slice(0, compact ? 4 : 8).map(node => <button key={node.word_id} onClick={() => onExplore?.(node.word)} disabled={!onExplore} title={readableText(node.description)}>{node.word}<span>↗</span></button>)}</div></div>}
      {onReplace && <button className="lab-primary word-use" onClick={() => onReplace(word.word)}>ใช้คำนี้ในข้อความ <span>↗</span></button>}
    </article>
  )
}
