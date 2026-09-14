import React, { useEffect, useRef } from 'react'
import { audienceLabels, formalityLabels, type Audience, type Formality } from './docs'
import type { Config, Review, Source } from './types'

/** <dialog showModal> already gives focus trapping, Escape and an inert background; the
    only thing it does not do is restore focus to the control that opened it. */
function Dialog({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const node = ref.current
    const opener = document.activeElement as HTMLElement | null
    node?.showModal()
    return () => opener?.focus?.()
  }, [])
  return (
    <dialog className="modal" ref={ref} onCancel={onClose} onClick={event => { if (event.target === ref.current) onClose() }} aria-label={label}>
      {children}
    </dialog>
  )
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="modal-head">
      <h2>{title}</h2>
      <button className="btn btn-ghost" onClick={onClose} aria-label="ปิดหน้าต่าง">✕</button>
    </div>
  )
}

const minutes = (seconds: number) => {
  if (!seconds) return '—'
  const m = Math.floor(seconds / 60), s = seconds % 60
  return m ? `${m} นาที ${s} วินาที` : `${s} วินาที`
}

export function BreakdownModal({ review, onClose }: { review?: Review; onClose: () => void }) {
  const stats = review?.stats
  return (
    <Dialog label="สรุปข้อความ" onClose={onClose}>
      <Head title="สรุปข้อความ" onClose={onClose} />
      <div className="modal-body">
        {!stats ? (
          <p className="state">กด “ตรวจข้อความ” ก่อน แล้วสรุปจะขึ้นที่นี่</p>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <div className="ring" style={{ ['--pct' as string]: String(review!.score) }} aria-hidden="true"><i>{review!.score}</i></div>
              <p className="muted" style={{ fontSize: '.88rem' }}>
                คะแนน {review!.score} จาก 100 คิดจากคำที่ไม่พบในพจนานุกรม ระดับภาษาที่ไม่เข้ากับเป้าหมาย และคำที่ใช้ซ้ำ
                แก้ตามข้อเสนอแนะแล้วคะแนนจะขยับขึ้น
              </p>
            </div>

            <h3 style={{ marginTop: 22, fontSize: '1rem' }}>ปริมาณ</h3>
            <div className="stat-grid">
              <div className="stat"><span>ตัวอักษร</span><b>{stats.characters.toLocaleString('th-TH')}</b></div>
              <div className="stat"><span>เวลาอ่าน</span><b>{minutes(stats.reading_seconds)}</b></div>
              <div className="stat"><span>คำ</span><b>{stats.words.toLocaleString('th-TH')}</b></div>
              <div className="stat"><span>เวลาพูด</span><b>{minutes(stats.speaking_seconds)}</b></div>
              <div className="stat"><span>ประโยค</span><b>{stats.sentences.toLocaleString('th-TH')}</b></div>
              <div className="stat"><span>คำที่พบในพจนานุกรม</span><b>{stats.known_words.toLocaleString('th-TH')}</b></div>
            </div>

            <h3 style={{ marginTop: 22, fontSize: '1rem' }}>ลักษณะของคำที่ใช้</h3>
            <p className="tiny">วัดจากพจนานุกรมโดยตรง ไม่ใช่สูตรความอ่านง่ายของภาษาอังกฤษ ซึ่งใช้กับภาษาไทยไม่ได้</p>
            <div className="stat" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>สัดส่วนตัวอักษรที่อยู่ในพจนานุกรม</span><b>{Math.round(stats.coverage * 100)}%</b>
              </div>
              <div className="meter"><i style={{ width: `${Math.round(stats.coverage * 100)}%` }} /></div>
            </div>
            {stats.registers.length > 0 && (
              <div className="stat"><span>ระดับภาษาที่ปรากฏ</span><b style={{ fontFamily: 'inherit', fontWeight: 500 }}>{stats.registers.slice(0, 4).map(r => `${r.label} ${r.count}`).join(' · ')}</b></div>
            )}
            {stats.editions.length > 0 && (
              <div className="stat"><span>ฉบับที่คำมาจาก</span><b style={{ fontFamily: 'inherit', fontWeight: 500 }}>{stats.editions.slice(0, 3).map(e => `${e.label} ${e.count}`).join(' · ')}</b></div>
            )}
            {stats.repeated.length > 0 && (
              <div className="stat"><span>คำที่ใช้ซ้ำบ่อย</span><b style={{ fontFamily: 'inherit', fontWeight: 500 }}>{stats.repeated.map(r => `${r.word} ×${r.count}`).join(' · ')}</b></div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

export function GoalsModal({ formality, audience, onChange, onClose }: {
  formality: Formality; audience: Audience
  onChange: (next: { formality: Formality; audience: Audience }) => void
  onClose: () => void
}) {
  return (
    <Dialog label="เป้าหมายงานเขียน" onClose={onClose}>
      <Head title="เป้าหมายงานเขียน" onClose={onClose} />
      <div className="modal-body">
        <p className="tiny">เป้าหมายนี้กำหนดว่าระบบจะเตือนเรื่องระดับภาษาแบบไหน เช่น งานทางการจะเตือนคำที่พจนานุกรมกำกับว่าเป็นภาษาปากหรือภาษาถิ่น</p>
        <div className="goal-row">
          <strong style={{ fontSize: '.9rem' }}>ระดับภาษา</strong>
          <div className="opts" role="group" aria-label="ระดับภาษา">
            {(Object.keys(formalityLabels) as Formality[]).map(key => (
              <button key={key} className="chip" aria-pressed={formality === key} onClick={() => onChange({ formality: key, audience })}>
                {formalityLabels[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="goal-row" style={{ borderBottom: 0 }}>
          <strong style={{ fontSize: '.9rem' }}>ผู้อ่าน</strong>
          <div className="opts" role="group" aria-label="ผู้อ่าน">
            {(Object.keys(audienceLabels) as Audience[]).map(key => (
              <button key={key} className="chip" aria-pressed={audience === key} onClick={() => onChange({ formality, audience: key })}>
                {audienceLabels[key]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  )
}

export function SourceModal({ source, config, onClose }: { source: Source; config?: Config; onClose: () => void }) {
  return (
    <Dialog label="แหล่งข้อมูล" onClose={onClose}>
      <Head title="ตรวจสอบแหล่งข้อมูล" onClose={onClose} />
      <div className="modal-body">
        <h3 style={{ fontSize: '1.05rem', marginBottom: 12 }}>{source.name}</h3>
        <div className="stat"><span>รุ่นข้อมูล</span><b style={{ fontFamily: 'inherit' }}>{source.version}</b></div>
        <div className="stat"><span>ใบอนุญาต</span><b style={{ fontFamily: 'inherit' }}><a href={source.license_url} target="_blank" rel="noopener noreferrer">{source.license}</a></b></div>
        <div className="stat"><span>สถานะ</span><b style={{ fontFamily: 'inherit' }}>{source.official_royal_society ? 'ข้อมูลทางการของสำนักงานราชบัณฑิตยสภา' : 'ไม่ใช่ข้อมูลทางการของสำนักงานราชบัณฑิตยสภา'}</b></div>
        {config?.source_notice && <p className="tiny" style={{ marginTop: 14 }}>{config.source_notice}</p>}
      </div>
    </Dialog>
  )
}

export function PrivacyModal({ config, onClose }: { config?: Config; onClose: () => void }) {
  return (
    <Dialog label="ข้อมูลและความเป็นส่วนตัว" onClose={onClose}>
      <Head title="ข้อมูลและความเป็นส่วนตัว" onClose={onClose} />
      <div className="modal-body" style={{ fontSize: '.88rem', lineHeight: 1.9 }}>
        <p>เอกสารของคุณเก็บอยู่ในเบราว์เซอร์นี้เท่านั้น ไม่ได้อัปโหลดไปที่เซิร์ฟเวอร์ และไม่มีการสร้างบัญชีให้โดยอัตโนมัติ</p>
        <p style={{ marginTop: 10 }}>ข้อความที่ส่งไปตรวจจะถูกประมวลผลเพื่อตอบกลับเท่านั้น ไม่บันทึกคำค้นหรือเนื้อหาลงในบันทึกการใช้งาน</p>
        <p style={{ marginTop: 10 }}>
          {config?.remote_processing
            ? 'โหมดโมเดลภายนอก: ข้อความบางส่วนอาจถูกส่งไปยังผู้ให้บริการที่ผู้ดูแลตั้งค่าไว้ โปรดเลี่ยงข้อมูลส่วนบุคคล'
            : 'โหมดในเครื่อง: การค้นและการตรวจทั้งหมดประมวลผลในระบบนี้ ไม่มีการส่งออกไปยังผู้ให้บริการภายนอก'}
        </p>
        {config?.source_notice && <p className="tiny" style={{ marginTop: 14 }}>{config.source_notice}</p>}
      </div>
    </Dialog>
  )
}
