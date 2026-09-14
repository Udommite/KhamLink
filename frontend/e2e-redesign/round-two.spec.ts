import { test, expect, type Page, type TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const names = ['คำ', 'ภาษา', 'ความคิด', 'ความหมาย', 'เรื่องราว', 'สำนวน', 'ตัวอักษร', 'ถ้อยคำ', 'ข้อความ', 'การเขียน', 'ความรู้', 'อ่าน', 'พูด', 'ความฝัน', 'บันทึก', 'เสียง']
const source = { source_id: 'qa', version: '1', dataset_id: 'qa', name: 'QA dictionary', license: 'test', license_url: '', official_royal_society: false, provenance: 'SOURCE_DATA' }

/** Distinct senses and metadata expose misaligned or invented comparison fields. */
function word(key: string) {
  const id = names.includes(key) ? String(names.indexOf(key)) : key
  return { word_id: id, word: names[Number(id)] || key, dataset_id: 'qa', source,
    definitions: [1, 2].map(number => ({ definition_id: id + '-' + number, number, text: 'ความหมาย ' + id + ' ลำดับ ' + number, part_of_speech: 'น.', metadata: number === 1 ? { register: 'ทางการ' } : {}, record_url: '', source, provenance: 'SOURCE_DATA' })),
    curated_metadata: [], ai_generated_metadata: [] }
}

/** Stub only transport; all assertions exercise rendered controls and native layout. */
async function fixture(page: Page) {
  await page.route('**/api/**', async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname)
    let data: unknown = { query_limit: 300 }
    if (path.endsWith('/related')) {
      const center = word(path.split('/')[3])
      data = { center, relationships: [{ relationship_id: 'r-' + center.word_id, word_id: '1', word: names[1], type: 'related', description: 'จากพจนานุกรม', source, provenance: 'SOURCE_DATA' }],
        semantic_neighbours: names.map((name, i) => ({ word_id: String(i), word: name, definition_id: i + '-1', description: 'ความหมาย', similarity: .8, provenance: 'AI_GENERATED_METADATA' })).filter(item => item.word_id !== center.word_id),
        semantic_neighbours_state: 'available', state: 'available', steer_state: 'inactive' }
    } else if (path.includes('/words/')) data = word(path.split('/')[3])
    else if (path === '/api/search') {
      const query = route.request().postDataJSON().query
      data = { candidates: (names.includes(query) ? [word(query)] : [word('2'), word('3'), word('4')]).map((entry, i) => ({ ...entry, description: 'ความหมายสำหรับค้นหา', match_type: ['exact', 'partial', 'semantic'][i], sense_count: 2 })), state: 'results', degraded: false, has_more: false }
    } else if (path === '/api/compare') data = { words: route.request().postDataJSON().word_ids.map(word), errors: [] }
    else if (path === '/api/compare/explanations') data = { state: 'unavailable', claims: [], evidence: [], provenance: 'AI_GENERATED_METADATA' }
    await route.fulfill({ json: { data, meta: { correlation_id: 'round-two' }, error: null } })
  })
}

/** Save full axe evidence before asserting so failures retain measured contrast findings. */
async function audit(page: Page, info: TestInfo, state: string) {
  const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
  await info.attach(state + '-axe.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath(state + '.png'), fullPage: true })
  expect.soft(report.violations, state + ': ' + JSON.stringify(report.violations)).toEqual([])
}

/** Submit through the same accessible input in either Discover mode. */
async function search(page: Page, query: string) {
  await page.getByRole('combobox').fill(query)
  await page.getByRole('combobox').press('Enter')
  await expect(page.locator('.search-progress')).toHaveCount(0)
}

for (const width of [1280, 940, 360]) {
  test('REQ-UX-024/026/033 shared input, aligned fields and ordinal bounds at ' + width, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 800 })
    await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
    await expect(page.locator('.graph-viewport')).toHaveJSProperty('clientWidth', width)
    const viewport = await page.locator('.graph-viewport').boundingBox()
    expect(viewport).toEqual({ x: 0, y: 0, width, height: 800 })
    await expect(page.getByRole('combobox')).toHaveAccessibleName(/.+/)
    await expect(page.locator('.discover-inspector input')).toHaveCount(0)
    await search(page, 'ความหมายที่ต้องการ')
    await expect(page.locator('.result-index')).toHaveCount(3)
    for (const chip of await page.locator('.result-words > button').all()) {
      const outer = (await chip.boundingBox())!, ordinal = (await chip.locator('.result-index').boundingBox())!
      expect(ordinal.x).toBeGreaterThanOrEqual(outer.x)
      expect(ordinal.y).toBeGreaterThanOrEqual(outer.y)
      expect(ordinal.x + ordinal.width).toBeLessThanOrEqual(outer.x + outer.width)
      expect(ordinal.y + ordinal.height).toBeLessThanOrEqual(outer.y + outer.height)
      await expect(chip.locator('.result-kind')).toBeVisible()
      expect(await chip.locator('.result-index').evaluate(node => getComputedStyle(node).position)).not.toBe('absolute')
    }
    await audit(page, info, 'results-' + width)
    /** Identity checks catch replacing the dock field with a separate comparison input. */
    const field = await page.getByRole('combobox').elementHandle()
    await page.locator('.search-mode button').nth(1).click()
    expect(await field!.evaluate(node => node === document.querySelector('[role="combobox"]'))).toBe(true)
    await expect(page.locator('.discover-inspector input')).toHaveCount(0)
    await audit(page, info, 'compare-empty-' + width)
    await search(page, names[0]); await search(page, names[1])
    await expect(page.locator('.comparison-chips button')).toHaveCount(2)
    await expect(page.locator('.comparison-matrix tr')).toHaveCount(6)
    for (const row of await page.locator('.comparison-matrix tr').all()) {
      const cells = row.locator('td')
      await expect(cells).toHaveCount(2)
      const a = (await cells.nth(0).boundingBox())!, b = (await cells.nth(1).boundingBox())!
      expect(Math.abs(a.y - b.y)).toBeLessThan(1)
      expect(b.x).toBeGreaterThanOrEqual(a.x + a.width - 1)
    }
    await expect(page.locator('.comparison-unavailable')).toBeVisible()
    await audit(page, info, 'compare-results-' + width)
    await page.locator('.comparison-chips button').first().click()
    await expect(page.locator('.comparison-chips button')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
  })
}

test('REQ-UX-030 observable stages, parallel retrieval and card before map', async ({ page }, info) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  await expect(page.locator('.graph-node')).toHaveCount(16)
  let releaseSearch!: () => void, releaseWord!: () => void, releaseMap!: () => void
  const searchGate = new Promise<void>(resolve => { releaseSearch = resolve })
  const wordGate = new Promise<void>(resolve => { releaseWord = resolve })
  const mapGate = new Promise<void>(resolve => { releaseMap = resolve })
  let wordStarted = false, mapStarted = false, mapFinished = false
  await page.route('**/api/search', async route => { await searchGate; await route.fallback() })
  await page.route('**/api/words/2', async route => { wordStarted = true; await wordGate; await route.fallback() })
  await page.route('**/api/words/2/related', async route => { mapStarted = true; await mapGate; mapFinished = true; await route.fallback() })
  /** Observe transient preparation without slowing the product or missing a one-frame state. */
  await page.evaluate(() => {
    const stages: string[] = []
    Object.assign(window, { qaStages: stages })
    new MutationObserver(() => {
      const stage = document.querySelector('.search-progress')?.getAttribute('data-stage')
      if (stage && !stages.includes(stage)) stages.push(stage)
    }).observe(document.body, { subtree: true, childList: true, attributes: true })
  })
  try {
    const started = Date.now()
    await page.getByRole('combobox').fill('คำที่หมายถึงความคิด'); await page.getByRole('combobox').press('Enter')
    await expect(page.locator('.search-progress')).toHaveAttribute('data-stage', 'searching')
    await expect(page.locator('.search-empty')).toHaveCount(0)
    await audit(page, info, 'search-in-flight')
    releaseSearch()
    await expect.poll(() => wordStarted && mapStarted).toBe(true)
    releaseWord()
    await expect(page.locator('.discover-inspector h2')).toHaveText(names[2])
    expect(mapFinished).toBe(false)
    await expect(page.locator('.search-progress')).toHaveAttribute('data-stage', 'graph')
    await info.attach('controlled-card-timing.json', { body: JSON.stringify({ submitToCardMs: Date.now() - started, includesDeliberateGatesAndAxe: true }), contentType: 'application/json' })
    await audit(page, info, 'card-before-map')
    expect(await page.evaluate(() => (window as unknown as { qaStages: string[] }).qaStages)).toEqual(['understanding', 'searching', 'graph'])
  } finally { releaseSearch(); releaseWord(); releaseMap() }
})

test('REQ-UX-030 empty, degraded and failed search states remain distinct', async ({ page }, info) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  const messages = new Set<string>()
  for (const reason of ['SEMANTIC_INDEX_UNAVAILABLE', 'EMBEDDING_NOT_CONFIGURED', 'EMBEDDING_INPUT_INVALID', 'EMBEDDING_TIMEOUT', 'EMBEDDING_REQUEST_REJECTED', 'EMBEDDING_AUTH_FAILED', 'EMBEDDING_CREDIT_REQUIRED', 'EMBEDDING_RATE_LIMITED', 'EMBEDDING_INVALID_RESPONSE', 'EMBEDDING_UNAVAILABLE', 'EXPANSION_UNAVAILABLE', 'RERANKER_UNAVAILABLE', 'NO_RELIABLE_RESULT']) {
    await page.route('**/api/search', route => route.fulfill({ json: { data: { candidates: [], state: 'empty', degraded: true, degraded_reason: reason }, error: null } }))
    await search(page, reason)
    await expect(page.locator('.search-empty')).toBeVisible()
    messages.add(await page.locator('.lab-notice').innerText())
    await audit(page, info, reason)
    await page.unroute('**/api/search')
  }
  expect(messages.size).toBe(13)
  await page.route('**/api/search', route => route.abort())
  await search(page, 'failure')
  await expect(page.getByRole('alert')).toBeVisible()
  await audit(page, info, 'search-error')
})

test('NFR-UX-008 dense glass contrast bounds and expanded source states', async ({ page }, info) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  for (const name of [names[1], names[2]]) {
    await page.getByRole('button', { name: 'สำรวจ ' + name, exact: true }).click()
    await expect(page.locator('.discover-inspector h2')).toHaveText(name)
  }
  await page.locator('.definition-source summary').first().click()
  await page.locator('.word-more summary').first().click()
  await audit(page, info, 'dense-provenance')
  /** Black/white bounds cover every possible graph pixel beneath translucent solid fills.
      Unsupported gradients, group opacity and blend effects are reported for pixel review. */
  const measurements = await page.evaluate(() => {
    /** Resolve computed CSS colours, including modern colour spaces, through native canvas. */
    function rgba(value: string): number[] {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
      const context = canvas.getContext('2d')!
      context.fillStyle = value; context.fillRect(0, 0, 1, 1)
      const data = [...context.getImageData(0, 0, 1, 1).data]
      return [data[0], data[1], data[2], data[3] / 255]
    }
    /** Composite foreground over background in the browser's sRGB colour domain. */
    function over(top: number[], bottom: number[]): number[] {
      return top.slice(0, 3).map((value, i) => value * top[3] + bottom[i] * (1 - top[3]))
    }
    /** WCAG relative luminance uses linearised sRGB channels. */
    function luminance(rgb: number[]): number {
      return rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
    }
    return [...document.querySelectorAll<HTMLElement>('.lab-header, .discover-inspector, .search-dock, .graph-path, .graph-controls, .graph-legend, .discover-footer')].map(surface => {
      const rows = [...surface.querySelectorAll<HTMLElement>('*')].filter(node => node.checkVisibility() && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim())).map(node => {
        const styles: CSSStyleDeclaration[] = []
        for (let current: HTMLElement | null = node; current; current = current.parentElement) {
          styles.unshift(getComputedStyle(current))
          if (current === surface) break
        }
        const style = getComputedStyle(node), foreground = rgba(style.color)
        const backgrounds = [[0, 0, 0], [255, 255, 255]].map(base => styles.reduce((rgb, item) => over(rgba(item.backgroundColor), rgb), base))
        const ratios = backgrounds.map(background => {
          const a = luminance(over(foreground, background)), b = luminance(background)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        })
        const textL = luminance(foreground), range = backgrounds.map(luminance)
        const worst = textL >= range[0] && textL <= range[1] ? 1 : Math.min(...ratios)
        const required = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700) ? 3 : 4.5
        return { text: node.textContent?.trim().slice(0, 90), foreground: style.color, backgrounds, worst, required,
          unsupported: styles.some(item => item.backgroundImage !== 'none' || Number(item.opacity) < 1 || item.mixBlendMode !== 'normal') }
      })
      return { surface: surface.className, backdropFilter: getComputedStyle(surface).backdropFilter, rows }
    })
  })
  await info.attach('glass-contrast-bounds.json', { body: JSON.stringify({ method: 'sRGB compositing over black and white; conservative bounds, not sampled pixel contrast', measurements }, null, 2), contentType: 'application/json' })
  expect(measurements.length).toBeGreaterThanOrEqual(5)
  for (const surface of measurements) for (const row of surface.rows) {
    expect.soft(row.unsupported, surface.surface + ': requires pixel review: ' + row.text).toBe(false)
    expect.soft(row.worst, surface.surface + ': ' + row.text).toBeGreaterThanOrEqual(row.required)
  }
})

test('Write empty, editor, preview, selection, source, deletion and gallery axe states', async ({ page }, info) => {
  await fixture(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/')
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  await audit(page, info, 'write-empty')
  await page.getByRole('button', { name: '+ เอกสารใหม่', exact: true }).click()
  await page.getByLabel('ข้อความของคุณ').fill('ภาษา')
  await audit(page, info, 'write-editor')
  await page.getByRole('button', { name: 'ดูรูปแบบ', exact: true }).click()
  await audit(page, info, 'write-preview')
  await page.getByRole('button', { name: 'แก้ไขข้อความ', exact: true }).click()
  await page.getByLabel('ข้อความของคุณ').evaluate((node: HTMLTextAreaElement) => {
    node.focus(); node.setSelectionRange(0, node.value.length); node.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await expect(page.locator('.write-inspector .word-card')).toBeVisible()
  await audit(page, info, 'write-selection')
  await page.locator('.write-inspector .definition-source summary').first().click()
  await audit(page, info, 'write-source')
  await page.getByRole('button', { name: 'Delete document', exact: true }).click()
  await audit(page, info, 'write-delete-confirm')
  await page.getByRole('button', { name: 'Keep it', exact: true }).click()
  await page.getByRole('button', { name: '▦ เอกสารของฉัน', exact: true }).click()
  await audit(page, info, 'write-gallery')
})
