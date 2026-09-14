import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** Audit each reached state and mobile overflow. */
async function accessible(page: Page) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  expect(report.violations, JSON.stringify(report.violations)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
}

/** Enter the current writing surface with isolated browser storage. */
async function newDocument(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  await accessible(page)
  await page.getByRole('button', { name: '+ เอกสารใหม่', exact: true }).click()
  await expect(page.getByLabel('ข้อความของคุณ')).toBeVisible()
}

test('local documents create, restore and cancel deletion', async ({ page }, info) => {
  await newDocument(page)
  await page.getByLabel('Document title').fill('บทความของฉัน')
  await page.getByLabel('ข้อความของคุณ').fill('ภาษาไทยเป็นสมบัติของชาติ')
  await expect(page.locator('.write-save-status')).toContainText('บันทึกในเบราว์เซอร์แล้ว')
  await page.getByRole('button', { name: '▦ เอกสารของฉัน', exact: true }).click()
  await expect(page.locator('.document-gallery .doc-card')).toContainText('บทความของฉัน')
  await accessible(page)
  await page.screenshot({ path: info.outputPath('documents.png'), fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  await expect(page.getByLabel('ข้อความของคุณ')).toHaveValue('ภาษาไทยเป็นสมบัติของชาติ')
  await page.getByRole('button', { name: 'Delete document', exact: true }).click()
  await accessible(page)
  await page.getByRole('button', { name: 'Keep it', exact: true }).click()
  await expect(page.getByLabel('ข้อความของคุณ')).toHaveValue('ภาษาไทยเป็นสมบัติของชาติ')
})

test('Q-UX-009 retained review links notes to spans and dismisses without editing', async ({ page }, info) => {
  await newDocument(page)
  const sample = 'อาหารร้านนี้แจ๋วมาก แต่เดือนหน้าร้านจะเจ๊งแล้ว น่าเสียดาย ฟลุ๊คคค'
  await page.getByLabel('ข้อความของคุณ').fill(sample)
  /** Keep the existing entry point until the product owner chooses its replacement. */
  await page.getByRole('button', { name: 'Review writing ↗', exact: true }).click()
  await expect(page.locator('.write-note').first()).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.mirror mark[data-cat]').first()).toBeVisible()
  await page.locator('.write-note-title').first().click()
  await expect(page.locator('.mirror mark[data-active="true"]')).toHaveCount(1)
  await accessible(page)
  await page.screenshot({ path: info.outputPath('review.png'), fullPage: true })
  const count = await page.locator('.write-note').count()
  await page.locator('.write-note').first().getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.locator('.write-note')).toHaveCount(count - 1)
  await expect(page.getByLabel('ข้อความของคุณ')).toHaveValue(sample)
})

test('selection opens sourced senses and continues in Discover', async ({ page }, info) => {
  await newDocument(page)
  await page.getByLabel('ข้อความของคุณ').fill('เราช่วยกันอนุรักษ์ภาษาไทย')
  /** Native offsets select Thai text without relying on whitespace word boundaries. */
  await page.getByLabel('ข้อความของคุณ').evaluate((node: HTMLTextAreaElement) => {
    const start = node.value.indexOf('อนุรักษ์')
    node.focus(); node.setSelectionRange(start, start + 'อนุรักษ์'.length)
    node.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await expect(page.locator('.write-inspector h2').filter({ hasText: 'อนุรักษ์' })).toBeVisible({ timeout: 30000 })
  await accessible(page)
  await page.screenshot({ path: info.outputPath('selection.png'), fullPage: true })
  await page.getByRole('button', { name: 'Discover ↗', exact: true }).click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('อนุรักษ์')
  await accessible(page)
})

test('meaning search reaches a card and suggestions remain keyboard operable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  const field = page.getByRole('combobox')
  await field.fill('คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย'); await field.press('Enter')
  await expect(page.locator('.result-words button').first()).toContainText('อนุรักษ', { timeout: 40000 })
  await accessible(page)
  await field.fill('อนุรักษ์')
  await expect(page.getByRole('option').first()).toBeVisible({ timeout: 30000 })
  await accessible(page)
  await field.press('ArrowDown')
  await expect(field).toHaveAttribute('aria-activedescendant', /suggestion-/)
  await field.press('Enter')
  await expect(page.locator('.discover-inspector h2')).toHaveText('อนุรักษ์')
})

test('REQ-UX-024 compares through the shared dock', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  await page.locator('.search-mode button').nth(1).click()
  await expect(page.locator('.discover-inspector input')).toHaveCount(0)
  for (const term of ['อนุรักษ์', 'สงวน']) {
    await page.getByRole('combobox').fill(term); await page.getByRole('combobox').press('Enter')
  }
  await expect(page.locator('.comparison-workspace')).toContainText('ถนอมรักษาไว้', { timeout: 30000 })
  await accessible(page)
  await page.screenshot({ path: info.outputPath('compare.png'), fullPage: true })
})

test('native editing, markdown preview and Thai counts', async ({ page }) => {
  await newDocument(page)
  const editor = page.getByLabel('ข้อความของคุณ')
  await editor.fill('# ความคิด\n**ภาษาไทย** และ *ความหมาย*\n- บันทึก')
  await editor.press('Control+Home'); await editor.press('Tab'); await expect(editor).toHaveValue(/^  #/)
  await editor.press('Control+z'); await expect(editor).toHaveValue(/^# /)
  await expect(page.locator('.write-count')).toContainText('คำ')
  await page.getByRole('button', { name: 'ดูรูปแบบ', exact: true }).click()
  await expect(page.locator('.markdown-preview strong')).toHaveText('ภาษาไทย')
  await accessible(page)
  await page.getByRole('button', { name: 'แก้ไขข้อความ', exact: true }).click()
  await expect(editor).toHaveValue(/ภาษาไทย/)
})

test('keyboard graph exploration, connection list and reset', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  await page.getByRole('button', { name: 'Show all word connections' }).click()
  await expect(page.locator('.graph-list')).toBeVisible(); await accessible(page)
  await page.getByRole('button', { name: 'ปิดรายการคำ' }).click()
  const node = page.locator('.graph-node').nth(1)
  const name = await node.locator('.graph-node-word').innerText()
  await node.focus(); await node.press('Enter')
  await expect(page.locator('.discover-inspector h2')).toHaveText(name)
  await page.getByRole('button', { name: 'Start a new exploration' }).click()
  await expect(page.locator('.discover-inspector h2')).toHaveText('คำ')
})
