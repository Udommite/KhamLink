import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

/** Run real browser journeys in an isolated profile, never in the user's saved documents. */
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
await mkdir('artifacts/discover-qa', { recursive: true })

/** Check WCAG rules on the actual rendered state, including contrast and keyboard semantics. */
async function checkAccessibility(label) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  assert.deepEqual(report.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], `${label} accessibility`)
}

try {
  await page.goto('http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('.graph-node').length > 1)
  await page.screenshot({ path: 'artifacts/discover-qa/desktop.png' })
  const header = await page.locator('.lab-header').boundingBox()
  const nav = await page.locator('.lab-nav').boundingBox()
  assert(nav.y >= header.y && nav.y + nav.height <= header.y + header.height + 1, 'Navigation must align inside the header')
  await checkAccessibility('Discover')
  console.log('PASS opening graph and navigation')

  await page.keyboard.press('/')
  assert(await page.locator('#discover-query').evaluate(element => element === document.activeElement))
  await page.locator('#discover-query').press('Enter')
  assert(await page.getByRole('alert').isVisible(), 'Empty input needs an inline error')
  await page.locator('#discover-query').fill('คนไข')
  await page.locator('#search-suggestions').waitFor()
  await page.locator('#discover-query').press('ArrowDown')
  assert(await page.locator('#discover-query').getAttribute('aria-activedescendant'), 'Suggestions need keyboard selection')
  await page.locator('#discover-query').press('Escape')
  await page.locator('#discover-query').fill('คนไข้')
  await page.locator('#discover-query').press('Enter')
  await page.waitForFunction(() => document.querySelector('.discover-inspector h2')?.textContent === 'คนไข้')
  await page.waitForFunction(() => document.querySelector('.semantic-graph')?.getAttribute('aria-busy') === 'false')
  const neighbour = page.locator('.graph-node-position:not(.is-center) .graph-node').first()
  const nextWord = await neighbour.locator('.graph-node-word').innerText()
  await neighbour.click()
  await page.waitForFunction(word => document.querySelector('.discover-inspector h2')?.textContent === word, nextWord)
  assert(await page.locator('.graph-path button').count() >= 2, 'Exploration must preserve the path')
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await page.getByRole('button', { name: 'Recenter graph', exact: true }).click()
  await page.getByRole('button', { name: 'Show all word connections' }).click()
  assert(await page.locator('.graph-list li').count() > 0)
  await page.getByRole('button', { name: 'ปิดรายการคำ' }).click()
  await page.screenshot({ path: 'artifacts/discover-qa/exploration.png' })
  await checkAccessibility('Word graph and inspector')
  console.log('PASS Thai search, graph expansion, preserved path, zoom and accessible list')

  await page.locator('#discover-query').fill('คำที่หมายถึงคนที่กำลังรับการรักษาจากแพทย์')
  await page.locator('#discover-query').press('Enter')
  await page.waitForFunction(() => document.querySelector('.semantic-graph')?.getAttribute('aria-busy') === 'false')
  assert(await page.locator('.result-words button').count() > 0, 'Reverse dictionary should expose actual search candidates')
  console.log('PASS empty input, keyboard autocomplete and reverse-dictionary search')

  await page.getByRole('button', { name: 'COMPARE', exact: false }).filter({ has: page.locator('span') }).first().click()
  await page.getByLabel('Word 1', { exact: true }).fill('คนไข้')
  await page.getByLabel('Word 2', { exact: true }).fill('ผู้ป่วย')
  await page.getByRole('button', { name: '+ Add word', exact: true }).click()
  await page.getByLabel('Word 3', { exact: true }).fill('แพทย์')
  await page.getByRole('button', { name: 'Compare words', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.comparison-column').length === 3)
  await page.locator('.search-mode button').first().click()
  await page.locator('.search-mode button').last().click()
  assert.equal(await page.locator('.comparison-column').count(), 3, 'Mode switching must retain comparison results')
  await page.screenshot({ path: 'artifacts/discover-qa/comparison.png', fullPage: true })
  await checkAccessibility('Comparison')
  await page.getByRole('button', { name: '+ Add word', exact: true }).click()
  await page.getByLabel('Word 4', { exact: true }).fill('พยาบาล')
  await page.getByRole('button', { name: 'Compare words', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.comparison-column').length === 4)
  assert(await page.locator('.comparison-scroll').evaluate(element => element.scrollWidth > element.clientWidth), 'Four columns must scroll within the comparison workspace')
  console.log('PASS three-word comparison and mode continuity')

  await page.locator('.lab-nav button').last().click()
  await page.getByRole('button', { name: '+ New document', exact: true }).click()
  await page.getByRole('textbox', { name: 'Document title' }).fill('ทดสอบการเชื่อมโยงคำ')
  await page.getByRole('textbox', { name: 'ข้อความของคุณ' }).fill('คนไข้กำลังรับการรักษา')
  await page.getByRole('textbox', { name: 'ข้อความของคุณ' }).evaluate(element => { element.focus(); element.setSelectionRange(0, 5); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })) })
  await page.waitForFunction(() => document.querySelector('.write-inspector .word-card h2')?.textContent === 'คนไข้')
  await page.screenshot({ path: 'artifacts/discover-qa/write.png', fullPage: true })
  await checkAccessibility('Write')
  const alternative = page.locator('.write-inspector .word-connections button').first()
  await alternative.waitFor()
  const replacement = (await alternative.innerText()).replace('↗', '').trim()
  await alternative.click()
  await page.waitForFunction(word => document.querySelector('.write-inspector .word-card h2')?.textContent === word, replacement)
  await page.getByRole('button', { name: /ใช้คำนี้ในข้อความ/ }).click()
  assert.equal(await page.getByRole('textbox', { name: 'ข้อความของคุณ' }).inputValue(), `${replacement}กำลังรับการรักษา`)
  await page.reload({ waitUntil: 'domcontentloaded' })
  assert.equal(await page.getByRole('textbox', { name: 'ข้อความของคุณ' }).inputValue(), `${replacement}กำลังรับการรักษา`)
  console.log('PASS Write selection, alternative replacement and document persistence')

  /** Recheck viewport bounds in both laptop and mobile layouts with a fresh Discover route. */
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.goto('http://127.0.0.1:8000', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelectorAll('.graph-node').length > 1)
    const submit = await page.locator('.search-submit').boundingBox()
    assert(submit.y + submit.height <= viewport.height, `Search must be usable in first viewport: ${viewport.width}`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No page-wide horizontal overflow')
    await page.screenshot({ path: `artifacts/discover-qa/discover-${viewport.width}.png`, fullPage: true })
  }
  console.log('PASS laptop/mobile first-viewport search and overflow checks')
  assert.deepEqual(errors, [], 'No browser runtime errors')
  console.log('PASS all Discover browser checks')
} finally { await browser.close() }
