import { describe, expect, it } from 'vitest'
import { indentEdit, markdownSpans } from './editor-format'
import { GRAPH_CAP, seedParticles, tickParticles } from './graph-physics'
import type { GraphNode } from './semantic-graph'

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
      // The node chip is 42px tall (56px for the centre), so 50px of vertical separation
      // clears it. It was 60 while the chip carried a second line of relation text.
      expect(Math.abs(a.x-b.x) >= (a.width+b.width)/2 || Math.abs(a.y-b.y)>=50, JSON.stringify({a,b})).toBe(true)
    }
    expect(Math.abs(particles[0].x-395)).toBeLessThan(75)
    expect(Math.abs(particles[0].y-215)).toBeLessThan(75)
  })

  /** REQ-UX-028b: siblings cluster, groups separate. This is the property that failed in
      the build being fixed — every node targeted the focus point, so "group" meant nothing. */
  it('keeps each parent\'s children closer to each other than to another parent\'s', () => {
    // One centre, two words explored from it, and four neighbours hanging off each of the
    // three — the shape a three-word exploration actually produces.
    const parents = ['a','b','c']
    const nodes = [{id:'a',word:'คำ'} as GraphNode,
      {id:'b',word:'ถ้อยคำ',parentId:'a',kind:'related'}, {id:'c',word:'วาจา',parentId:'a',kind:'related'},
      ...parents.flatMap(parent=>Array.from({length:4},(_,i)=>
        ({id:`${parent}${i}`,word:`คำที่ ${parent}${i}`,parentId:parent,kind:'related'})))]
    const links = nodes.filter(node=>node.parentId).map(node=>({source:node.parentId!,target:node.id,kind:'related'}))
    const particles = seedParticles(nodes,[],'a',1200,760)
    for(let n=0;n<300;n++) tickParticles(particles,links,'a',1200,760)
    const at = (id:string)=>particles.find(node=>node.id===id)!
    const gap = (one:string,two:string)=>Math.hypot(at(one).x-at(two).x,at(one).y-at(two).y)
    const mean = (pairs:[string,string][])=>pairs.reduce((sum,[one,two])=>sum+gap(one,two),0)/pairs.length
    const within: [string,string][] = [], between: [string,string][] = []
    const children = particles.filter(node=>node.parentId && node.parentId!==node.id)
    for(let i=0;i<children.length;i++) for(let j=i+1;j<children.length;j++)
      (children[i].parentId===children[j].parentId?within:between).push([children[i].id,children[j].id])
    expect(mean(within)).toBeLessThan(mean(between) * 0.75)
  })
})

describe('REQ-UX-007: the centre node must render its whole headword', () => {
  it('sizes the centre for its larger type rather than the neighbour scale', () => {
    const word = 'กษัตร'
    const [centre, neighbour] = seedParticles([{ id: 'c', word }, { id: 'n', word }], [], 'c', 800, 450)
    expect(centre.width).toBeGreaterThan(neighbour.width)
    // 24px Thai glyphs run about 13px each; the box has to clear that plus its padding.
    expect(centre.width).toBeGreaterThanOrEqual(Array.from(word).length * 13 + 16)
  })
})
