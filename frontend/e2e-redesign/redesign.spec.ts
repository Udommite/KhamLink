import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const names=['คำ','ภาษา','ความคิด','ความหมาย','เรื่องราว','สำนวน','ตัวอักษร','ถ้อยคำ','ข้อความ','การเขียน','ความรู้','อ่าน','พูด','ความฝัน','บันทึก','เสียง']
const source={source_id:'test',version:'1',dataset_id:'test',name:'ข้อมูลทดสอบ',license:'test',license_url:'',official_royal_society:false,provenance:'SOURCE_DATA'}
function word(id:string) { return { word_id:id,word:names[Number(id)]||'ใหม่',dataset_id:'test',definitions:[{definition_id:`d${id}`,number:1,text:'ความหมายสำหรับทดสอบการแสดงผล',part_of_speech:'น.',metadata:{example:'EXAMPLE_MUST_NOT_RENDER'},record_url:'',source,provenance:'SOURCE_DATA'}],source,curated_metadata:[],ai_generated_metadata:[] } }
async function fixture(page:Page) {
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()), path=decodeURIComponent(url.pathname)
    let data:unknown={query_limit:300}
    if(path.endsWith('/related')) {
      const id=path.split('/')[3], center=word(id)
      data={center:{word_id:id,word:center.word},relationships:[],semantic_neighbours:id==='new'?[]:names.map((name,i)=>({word_id:String(i),word:name,definition_id:`d${i}`,description:'ความหมาย',similarity:.8,provenance:'AI_GENERATED_METADATA'})).filter(node=>node.word_id!==id),semantic_neighbours_state:'available',state:'available'}
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
  await page.screenshot({path:'../artifacts/redesign/discover-mobile.png'})
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([])
  await page.getByRole('button',{name:'สำรวจ ภาษา',exact:true}).click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('ภาษา')
  await page.screenshot({path:'../artifacts/redesign/dictionary-mobile.png'})
  const center=await page.locator('.graph-node[aria-pressed=true]').boundingBox(),panel=await page.locator('.discover-inspector').boundingBox()
  expect(center!.y+center!.height).toBeLessThan(panel!.y)
})
