import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/* Core journeys through the writing workspace, on the real corpus.

   Every assertion is against something a writer can see or do; none reaches into
   application state. The accessibility and no-horizontal-scroll checks run at every stop
   rather than once at the end, because a rail that traps focus or a sheet that overflows
   only appears after an interaction. */

const SAMPLE = 'อาหารร้านนี้แจ๋วมาก แต่เดือนหน้าร้านจะเจ๊งแล้ว น่าเสียดาย ฟลุ๊คคค'

async function accessible(page: Page) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(
    report.violations,
    JSON.stringify(report.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))),
  ).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
}

async function newDocument(page: Page) {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByRole('heading', { name: 'เอกสาร', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '+ เขียนงานใหม่' }).click()
  await expect(page.getByLabel('ข้อความของคุณ')).toBeVisible()
}

async function review(page: Page, text = SAMPLE) {
  await page.getByLabel('ข้อความของคุณ').fill(text)
  await page.getByRole('button', { name: 'ตรวจข้อความ' }).click()
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 30000 })
}

test('dashboard creates, lists and restores a document', async ({ page }, testInfo) => {
  await newDocument(page)
  await accessible(page)

  await page.getByLabel('ชื่อเอกสาร').fill('บทความของฉัน')
  await page.getByLabel('ข้อความของคุณ').fill('ภาษาไทยเป็นสมบัติของชาติ')
  await page.getByRole('button', { name: 'กลับไปหน้าเอกสาร' }).click()

  const card = page.locator('.doc-card').first()
  await expect(card).toContainText('บทความของฉัน')
  await expect(card).toContainText('ภาษาไทยเป็นสมบัติของชาติ')
  await expect(card).toContainText('คำ')
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true })

  // Documents live in this browser only, so a reload is the real persistence test.
  await page.reload()
  await expect(page.locator('.doc-card').first()).toContainText('บทความของฉัน')
})

test('review marks the text, links card to span, and accepts a replacement', async ({ page }, testInfo) => {
  await newDocument(page)
  await review(page)

  // The unknown word is flagged; ordinary Thai compounds are not.
  await expect(page.locator('.card', { hasText: 'ไม่พบคำนี้ในพจนานุกรม' })).toBeVisible()
  await expect(page.locator('.card', { hasText: 'อาหาร' })).toHaveCount(0)

  // Every card has a matching underline in the document, in its own colour.
  const marks = page.locator('.mirror mark[data-cat]')
  expect(await marks.count()).toBeGreaterThan(0)
  await expect(page.locator('.mirror mark[data-cat="correctness"]').first()).toContainText('ฟลุ๊ค')

  // Clicking a card makes its span the active one.
  await page.locator('.card .card-kind').first().click()
  await expect(page.locator('.mirror mark[data-active="true"]')).toHaveCount(1)
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('review.png'), fullPage: true })

  const before = await page.getByLabel('ข้อความของคุณ').inputValue()
  const cards = await page.locator('.card').count()
  await page.locator('.card').first().getByRole('button', { name: 'ไม่ต้องแก้' }).click()
  await expect(page.locator('.card')).toHaveCount(cards - 1)
  // Dismissing changes the rail, never the writer's text.
  await expect(page.getByLabel('ข้อความของคุณ')).toHaveValue(before)
})

test('the writing goal decides which register warnings fire', async ({ page }) => {
  await newDocument(page)
  await review(page)
  const colloquial = page.locator('.card', { hasText: 'ภาษาปาก' })

  await page.getByRole('button', { name: 'กึ่งทางการ' }).click()
  await page.getByRole('button', { name: 'ทางการ', exact: true }).click()
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click()
  await expect(colloquial.first()).toBeVisible({ timeout: 30000 })

  await page.getByRole('button', { name: 'ทางการ', exact: true }).click()
  await page.getByRole('button', { name: 'ไม่เป็นทางการ' }).click()
  await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click()
  // Colloquial words are unremarkable in casual writing, so the warnings go away.
  await expect(colloquial).toHaveCount(0, { timeout: 30000 })
})

test('selecting a word opens its dictionary entry with numbered senses', async ({ page }, testInfo) => {
  await newDocument(page)
  await page.getByLabel('ข้อความของคุณ').fill('เราช่วยกันอนุรักษ์ภาษาไทย')
  await page.getByLabel('ข้อความของคุณ').click()
  // Select 'อนุรักษ์' by hand: Thai has no spaces, so a double-click cannot find it.
  await page.getByLabel('ข้อความของคุณ').evaluate((node: HTMLTextAreaElement) => {
    node.setSelectionRange(8, 16)
    node.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await expect(page.locator('.senses .sense').first()).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.entry-head')).toContainText('อนุรักษ์')
  await expect(page.locator('.sense-no').first()).toHaveText('๑')
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('entry.png'), fullPage: true })
})

test('find a word from its meaning and insert it', async ({ page }) => {
  await newDocument(page)
  await page.getByRole('tab', { name: 'หาคำ' }).click()
  await page.getByLabel(/อธิบายความหมาย/).fill('คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย')
  await page.getByRole('button', { name: 'หาคำ', exact: true }).click()
  await expect(page.locator('.result').first()).toContainText('อนุรักษ', { timeout: 60000 })
  await accessible(page)

  await page.locator('.result').first().getByRole('button', { name: 'แทรกลงข้อความ' }).click()
  await expect(page.getByLabel('ข้อความของคุณ')).toHaveValue(/อนุรักษ/)
})

test('compare two words side by side', async ({ page }, testInfo) => {
  await newDocument(page)
  await page.getByRole('tab', { name: 'เทียบคำ' }).click()
  await page.getByLabel('คำแรก').fill('อนุรักษ์')
  await page.getByLabel('คำที่สอง').fill('สงวน')
  await page.getByRole('button', { name: 'เทียบความหมาย' }).click()
  await expect(page.locator('.compare-col')).toHaveCount(2, { timeout: 30000 })
  await expect(page.locator('.compare-cols')).toContainText('ถนอมรักษาไว้')
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('compare.png'), fullPage: true })
})

test('the breakdown reports counts measured for Thai', async ({ page }, testInfo) => {
  await newDocument(page)
  await review(page)
  await page.getByRole('button', { name: 'สรุปข้อความ' }).first().click()

  const modal = page.getByRole('dialog')
  await expect(modal).toContainText('ตัวอักษร')
  await expect(modal).toContainText('เวลาอ่าน')
  await expect(modal).toContainText('สัดส่วนตัวอักษรที่อยู่ในพจนานุกรม')
  // Not an English readability score: that formula does not apply to Thai.
  await expect(modal).not.toContainText('Flesch')
  await accessible(page)
  await page.screenshot({ path: testInfo.outputPath('breakdown.png'), fullPage: true })

  await page.keyboard.press('Escape')
  await expect(modal).not.toBeVisible()
})

test('the workspace is keyboard operable and respects the theme toggle', async ({ page }) => {
  await newDocument(page)
  await page.keyboard.press('Tab')
  await expect(page.locator('.skip-link')).toBeFocused()

  const before = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.getByRole('button', { name: 'สลับธีม' }).click()
  const after = await page.evaluate(() => document.documentElement.dataset.theme)
  expect(after).not.toBe(before)
  await page.reload()
  // The choice has to survive a reload or it is not a preference.
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after)
  await accessible(page)
})
