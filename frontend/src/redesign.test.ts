import { describe, expect, it } from 'vitest'
import { indentEdit, markdownSpans } from './editor-format'
import { GRAPH_CAP, seedParticles, tickParticles } from './graph-physics'

describe('REQ-UX-018: plain markdown and indentation', () => {
  it('keeps Thai/emoji text and raw markers with correct ranges', () => {
    const text = '# คำไทย\n🌱 **ความคิด** และ *ภาษา*\n- รายการ'
    const spans = markdownSpans(text)
    expect(spans.filter(span => span.kind === 'bold').map(span => text.slice(span.start,span.end))).toEqual(['ความคิด'])
    expect(spans.filter(span => span.kind === 'italic').map(span => text.slice(span.start,span.end))).toEqual(['ภาษา'])
    expect(spans.some(span => span.kind === 'heading')).toBe(true)
    expect(spans.some(span => span.kind === 'list')).toBe(true)
  })
  it('indents selected lines but excludes the following line at a selection boundary', () => {
    expect(indentEdit('ก\nข\nค',0,4,false)).toEqual({from:0,to:3,text:'  ก\n  ข',start:2,end:8})
    const edit = indentEdit('  ก\n  ข',2,7,true)
    expect(edit.text).toBe('ก\nข')
    expect(edit.start).toBe(0)
  })
})

describe('REQ-UX-005: bounded force simulation', () => {
  it('settles without overlapping labels at the desktop cap', () => {
    const nodes = Array.from({length:GRAPH_CAP},(_,i)=>({id:String(i),word:i ? `ความคิด ${i}` : 'คำ'}))
    const links = nodes.slice(1).map(node=>({source:'0',target:node.id,kind:'semantic'}))
    const particles = seedParticles(nodes,[],'0',790,430)
    for(let n=0;n<220;n++) tickParticles(particles,links,'0',790,430)
    for(let i=0;i<particles.length;i++) for(let j=i+1;j<particles.length;j++) {
      const a=particles[i], b=particles[j]
      expect(Math.abs(a.x-b.x) >= (a.width+b.width)/2 || Math.abs(a.y-b.y)>=60, JSON.stringify({a,b})).toBe(true)
    }
    expect(Math.abs(particles[0].x-395)).toBeLessThan(75)
    expect(Math.abs(particles[0].y-215)).toBeLessThan(75)
  })
})
