import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const names=['คำ','ภาษา','ความคิด','ความหมาย','เรื่องราว','สำนวน','ตัวอักษร','ถ้อยคำ','ข้อความ','การเขียน','ความรู้','อ่าน','พูด','ความฝัน','บันทึก','เสียง']
const steered=['ราชินี','กระษัตรี','ราชญี','นารี','วนิดา','รมณี','วธู','สตรี','อิสตรี','ลูกสาว','เทพิน','ถี','คน','สาวแส้','พุ่มพวง','กัลยา']
const source={source_id:'test',version:'1',dataset_id:'test',name:'ข้อมูลทดสอบ',license:'test',license_url:'',official_royal_society:false,provenance:'SOURCE_DATA'}
function word(id:string) { return { word_id:id,word:names[Number(id)]||'ใหม่',dataset_id:'test',definitions:[{definition_id:`d${id}`,number:1,text:'ความหมายสำหรับทดสอบการแสดงผล',part_of_speech:'น.',metadata:{example:'EXAMPLE_MUST_NOT_RENDER'},record_url:'',source,provenance:'SOURCE_DATA'}],source,curated_metadata:[],ai_generated_metadata:[] } }
async function fixture(page:Page) {
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()), path=decodeURIComponent(url.pathname)
    let data:unknown={query_limit:300}
    if(path.endsWith('/related')) {
      const id=path.split('/')[3], center=word(id)
      // REQ-UX-021: a steered request answers with a different neighbourhood, the way the
      // real index does once the query point moves off the entry itself.
      const steer=url.searchParams.get('steer')||'', weight=Number(url.searchParams.get('steer_weight')||0)
      const pool=steer&&weight>0?steered:names
      data={center:{word_id:id,word:center.word},relationships:[],semantic_neighbours:id==='new'?[]:pool.map((name,i)=>({word_id:`${steer&&weight>0?'s':''}${i}`,word:name,definition_id:`d${i}`,description:'ความหมาย',similarity:.8,provenance:'AI_GENERATED_METADATA'})).filter(node=>node.word_id!==id),semantic_neighbours_state:'available',state:'available',
        ...(steer?{steer:{word_id:'w_steer',word:steer},steer_state:weight>0?'active':'inactive'}:{steer_state:'inactive'})}
    } else if(path.includes('/words/')) data=word(path.split('/')[3]==='คำ'?'0':path.split('/')[3])
    else if(path==='/api/search') data={candidates:[{...word('new'),description:'ความหมายใหม่',match_type:'exact',sense_count:1}],state:'results',degraded:false,has_more:false}
    else if(path==='/api/compare') data={words:[word('0'),word('1')],errors:[]}
    else if(path==='/api/compare/explanations') data={state:'unavailable',claims:[],evidence:[],provenance:'AI_GENERATED_METADATA'}
    await route.fulfill({json:{data,meta:{correlation_id:'test'},error:null}})
  })
}

test('REQ-UX-005/006/010/011/016: graph, permanent panel, new search and undo',async({page})=>{
  await fixture(page); await page.emulateMedia({reducedMotion:'reduce'}); await page.goto('/')
  await expect(page.locator('.discover-inspector h2')).toHaveText('คำ')
  await expect(page.locator('.graph-node')).toHaveCount(16)
  await expect(page.getByText('EXAMPLE_MUST_NOT_RENDER')).toHaveCount(0)
  const before=await page.locator('[data-node]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-node')))
  await page.getByRole('button',{name:'สำรวจ ภาษา',exact:true}).click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('ภาษา')
  expect(await page.locator('[data-node]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-node')).sort())).toEqual(before.sort())
  await page.keyboard.press('Control+z')
  await expect(page.locator('.discover-inspector h2')).toHaveText('คำ')
  await page.getByRole('combobox').fill('ใหม่'); await page.getByRole('button',{name:'ค้นหาคำ',exact:true}).last().click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('ใหม่')
  await expect(page.locator('.graph-node')).toHaveCount(1)
  const issues=await new AxeBuilder({page}).analyze()
  expect(issues.violations).toEqual([])
})

test('REQ-UX-001/005/008 and NFR-UX-001: desktop layout and motion evidence',async({page})=>{
  await fixture(page); await page.goto('/')
  await expect(page.locator('.graph-node')).toHaveCount(16)
  await page.waitForTimeout(2200)
  const overlaps=await page.locator('.graph-node').evaluateAll(elements=>{
    const boxes=elements.map(node=>node.getBoundingClientRect()); const pairs:number[][]=[]
    boxes.forEach((a,i)=>boxes.forEach((b,j)=>{if(j>i && a.left<b.right && b.left<a.right && a.top<b.bottom && b.top<a.bottom)pairs.push([i,j])}));return pairs
  })
  expect(overlaps).toEqual([])
  const frame=await page.locator('.discover-stage').boundingBox(); expect(frame?.width).toBe(1280); expect(frame?.height).toBe(800)
  const center=await page.locator('.graph-node[aria-pressed=true]').boundingBox(), panel=await page.locator('.discover-inspector').boundingBox()
  expect(center!.x+center!.width).toBeLessThan(panel!.x)
  const fps=await page.evaluate(async()=>{const times:number[]=[];return await new Promise<number>(resolve=>{let start=performance.now();function tick(now:number){times.push(now);if(now-start<1000)requestAnimationFrame(tick);else resolve(times.length/((now-start)/1000))}requestAnimationFrame(tick)})})
  console.log('16-node headless frame rate:',fps.toFixed(1))
  await page.screenshot({path:'../artifacts/redesign/discover-desktop.png'})
  await page.emulateMedia({reducedMotion:'reduce'})
  const first=await page.locator('[data-node="1"]').getAttribute('style'); await page.waitForTimeout(200); expect(await page.locator('[data-node="1"]').getAttribute('style')).toBe(first)
})

test('REQ-UX-004: opening stage darkens the whole viewport, beams travel, nodes follow',async({page})=>{
  await fixture(page); await page.goto('/')
  const stage=page.locator('.intro-stage')
  const box=await stage.boundingBox()
  expect(box).toEqual(expect.objectContaining({x:0,y:0,width:1280,height:800}))
  // The scrim must sit above the header and the dictionary panel, not only over the graph.
  const layers=await page.evaluate(()=>{const z=(s:string)=>Number(getComputedStyle(document.querySelector(s)!).zIndex);return{stage:z('.intro-stage'),header:z('.lab-header'),panel:z('.discover-inspector'),graph:z('.discover-stage')}})
  expect(layers.stage).toBeGreaterThan(layers.header); expect(layers.stage).toBeGreaterThan(layers.panel); expect(layers.graph).toBeGreaterThan(layers.stage)
  expect(await stage.evaluate(node=>getComputedStyle(node).pointerEvents)).toBe('none')
  // A beam is one dash sweeping the whole edge, staggered per edge; a neighbour resolves after its own beam.
  const edge=await page.locator('.graph-edge path').nth(3).evaluate(node=>{const s=getComputedStyle(node);return{dash:s.strokeDasharray,name:s.animationName,delay:s.animationDelay}})
  expect(edge.dash).toBe('1px'); expect(edge.name).toBe('beam-travel')
  const delays=await page.locator('.graph-node-position:not(.is-center) .graph-node').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).animationDelay))
  expect(new Set(delays).size).toBeGreaterThan(1)
  // The settle must not gate interaction — and not only for the graph. The stage is a
  // full-viewport positioned element, so without pointer-events:none it silently swallows
  // every click aimed at the dock, panel, footer or nav for the intro's whole duration.
  expect(await page.evaluate(()=>{
    const at=(x:number,y:number)=>document.elementFromPoint(x,y)?.closest('.discover-stage')!==null
    const hit=(s:string)=>{const b=document.querySelector(s)!.getBoundingClientRect();return at(b.left+b.width/2,b.top+b.height/2)}
    return {dock:hit('.discover-search'),nav:hit('.lab-nav'),panel:hit('.discover-inspector h2')}
  })).toEqual({dock:false,nav:false,panel:false})
  await page.getByRole('combobox').click()
  await expect(page.getByRole('combobox')).toBeFocused()
  await page.getByRole('button',{name:'สำรวจ ภาษา',exact:true}).click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('ภาษา')
  await expect(stage).toHaveCount(0,{timeout:2500})
  // Reduced motion collapses the sequence to the static end state.
  const reduced=await page.context().browser()!.newContext({reducedMotion:'reduce',viewport:{width:1280,height:800}})
  const quiet=await reduced.newPage(); await fixture(quiet); await quiet.goto('/')
  await expect(quiet.locator('.discover-inspector h2')).toHaveText('คำ')
  expect(await quiet.locator('.intro-stage').count()).toBe(0)
  expect(await quiet.locator('.intro-slogan').count()).toBe(0)
  await reduced.close()
})

test('REQ-UX-021: steering word and weight re-form the neighbourhood in place',async({page})=>{
  await fixture(page); await page.emulateMedia({reducedMotion:'reduce'}); await page.goto('/')
  await expect(page.locator('.discover-inspector h2')).toHaveText('คำ')
  await expect(page.locator('.graph-node-word').first()).toHaveText('คำ')
  const slider=page.getByRole('slider')
  // Inert until a steering word exists: a live weight with nothing to steer toward would lie.
  await expect(slider).toBeDisabled()
  const sent:string[]=[]
  page.on('request',request=>{const u=new URL(request.url()); if(u.pathname.includes('/related')) sent.push(u.search)})
  // Walk one step first: steering must not silently discard the explored path.
  await page.getByRole('button',{name:'สำรวจ ภาษา',exact:true}).click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('ภาษา')
  const trail=await page.locator('.graph-path button').allInnerTexts()
  expect(trail.length).toBeGreaterThan(1)
  await page.getByLabel('ปรับความหมายไปทางคำว่า').fill('ผู้หญิง')
  await expect(slider).toBeEnabled()
  await slider.fill('0.7')
  await expect(page.locator('.steer-note')).toContainText('ผู้หญิง')
  await expect(page.locator('.graph-node-word').filter({hasText:'ราชินี'})).toHaveCount(1)
  // The centre is untouched — you steer without re-typing the query (REQ-UX-021) — and the
  // breadcrumb still describes how you got here.
  await expect(page.locator('.discover-inspector h2')).toHaveText('ภาษา')
  await expect(page.locator('.graph-node-word').first()).toHaveText('ภาษา')
  expect(await page.locator('.graph-path button').allInnerTexts()).toEqual(trail)
  expect(sent.some(search=>search.includes('steer_weight=0.7'))).toBe(true)
  // Clearing restores the unsteered neighbourhood rather than leaving a stale one.
  await page.getByRole('button',{name:'ล้าง',exact:true}).click()
  await expect(slider).toBeDisabled()
  await expect(page.locator('.graph-node-word').filter({hasText:'ราชินี'})).toHaveCount(0)
  await expect(page.locator('.graph-node-word').filter({hasText:'ความคิด'})).toHaveCount(1)
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
})

test('REQ-UX-013/014/017/018: comparison and visual document editor',async({page})=>{
  await fixture(page); await page.goto('/')
  await page.locator('.search-mode button').nth(1).click()
  await expect(page.locator('.comparison-input input')).toHaveCount(2)
  await page.getByRole('button',{name:'+ Add word',exact:true}).click(); await expect(page.locator('.comparison-input input')).toHaveCount(3)
  await page.screenshot({path:'../artifacts/redesign/compare-desktop.png'})
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
  await page.getByRole('button',{name:'Write',exact:true}).click()
  await page.getByRole('button',{name:'+ เอกสารใหม่',exact:true}).click()
  const editor=page.getByRole('textbox',{name:'ข้อความของคุณ'})
  await editor.fill('# ความคิด\n**ภาษาไทย** และ *ความหมาย*\n- บันทึก')
  await editor.press('Control+Home'); await editor.press('Tab'); await expect(editor).toHaveValue(/^  #/)
  await editor.press('Control+z'); await expect(editor).toHaveValue(/^# /)
  await editor.press('Tab'); await editor.press('Shift+Tab'); await expect(editor).toHaveValue(/^# /)
  // REQ-UX-019: the mirror sizes the sheet, so nothing measures the text per keystroke.
  const sized=await page.evaluate(()=>{const sheet=document.querySelector('.sheet') as HTMLElement,mirror=sheet.querySelector('.mirror') as HTMLElement,area=sheet.querySelector('textarea') as HTMLTextAreaElement
    return{sheet:sheet.getBoundingClientRect().height,mirror:mirror.getBoundingClientRect().height,area:area.getBoundingClientRect().height,inline:area.style.height}})
  expect(sized.inline).toBe('')
  expect(Math.abs(sized.sheet-sized.mirror)).toBeLessThan(1); expect(Math.abs(sized.sheet-sized.area)).toBeLessThan(1)
  await page.getByRole('button',{name:'ดูรูปแบบ',exact:true}).click(); await expect(page.locator('.markdown-preview strong')).toHaveText('ภาษาไทย'); await expect(page.locator('.markdown-preview em')).toHaveText('ความหมาย')
  await page.getByRole('button',{name:'แก้ไขข้อความ',exact:true}).click()
  await page.screenshot({path:'../artifacts/redesign/write-desktop.png'})
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
  await page.getByRole('button',{name:'▦ เอกสารของฉัน',exact:true}).click()
  await expect(page.locator('.document-gallery .doc-card')).toHaveCount(1)
  await expect(page.locator('.write-toolbar select')).toHaveCount(0)
})

test('REQ-UX-004/006/020 and VAL-054: mobile and CSS fallback',async({page})=>{
  await page.setViewportSize({width:360,height:800}); await fixture(page)
  await page.addInitScript(()=>{Object.defineProperty(document,'startViewTransition',{value:undefined,configurable:true})})
  await page.goto('/'); await expect(page.locator('.intro-slogan')).toHaveCount(1)
  await expect(page.locator('.intro-slogan')).toHaveCount(0,{timeout:4000})
  await page.reload(); await expect(page.locator('.intro-slogan')).toHaveCount(0)
  await expect(page.locator('.mobile-panel-toggle')).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(360)
  // The narrow layout stacks graph / controls / dock / panel. These offsets had drifted
  // apart far enough that the zoom controls sat on top of the mode selector — two tappable
  // controls in the same place. Assert the stack stays disjoint in both panel states.
  const disjoint=async()=>await page.evaluate(()=>{
    const box=(s:string)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {l:b.left,r:b.right,t:b.top,b:b.bottom}}
    const hit=(a:ReturnType<typeof box>,z:ReturnType<typeof box>)=>!!a&&!!z&&a.l<z.r&&z.l<a.r&&a.t<z.b&&z.t<a.b
    const dock=box('.search-dock'),controls=box('.graph-controls'),mode=box('.mode-row'),view=box('.graph-viewport')
    return {dockVsControls:hit(dock,controls),modeVsControls:hit(mode,controls),viewVsDock:hit(view,dock)}
  })
  expect(await disjoint()).toEqual({dockVsControls:false,modeVsControls:false,viewVsDock:false})
  await page.screenshot({path:'../artifacts/redesign/discover-mobile.png'})
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
  await page.getByRole('button',{name:'สำรวจ ภาษา',exact:true}).click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('ภาษา')
  await page.screenshot({path:'../artifacts/redesign/dictionary-mobile.png'})
  const center=await page.locator('.graph-node[aria-pressed=true]').boundingBox(),panel=await page.locator('.discover-inspector').boundingBox()
  expect(center!.y+center!.height).toBeLessThan(panel!.y)
  // Same stack, now with the panel open — the tighter of the two cases.
  expect(await disjoint()).toEqual({dockVsControls:false,modeVsControls:false,viewVsDock:false})
})
