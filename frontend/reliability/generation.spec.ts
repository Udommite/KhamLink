import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('VAL-053 50 instrumented calls per viewport including provider failures and timeouts', async ({ page }, testInfo) => {
  // Two projects × 50 = 100 real browser→API→grounding requests: 80 successes,
  // 10 provider errors, 10 actual eight-second deadline fallbacks. No response mocks.
  await page.goto('/#/word/' + encodeURIComponent('อนุรักษ์'))
  await expect(page.getByTestId('source-content')).toContainText('รักษาให้คงเดิม')
  const measurements: { scenario: string; progress_ms: number; total_ms: number; state: string }[] = []
  for (let index = 0; index < 50; index++) {
    const progress = page.evaluate(() => new Promise<number>(resolve => {
      document.addEventListener('click', () => {
        const accepted = performance.now()
        const observer = new MutationObserver(() => {
          if (document.querySelector('.ai-panel .busy[role="status"]')) {
            observer.disconnect()
            clearTimeout(deadline)
            resolve(performance.now() - accepted)
          }
        })
        const deadline = setTimeout(() => { observer.disconnect(); resolve(2000) }, 2000)
        observer.observe(document.body, { childList: true, subtree: true })
      }, { once: true, capture: true })
    }))
    const completion = page.waitForResponse(response => response.url().endsWith('/api/explanations') && response.request().method() === 'POST')
    const started = Date.now()
    await page.getByRole('button', { name: /ช่วยอธิบายคำนี้|ลองอธิบายอีกครั้ง/ }).click()
    const progressMs = await progress
    expect(progressMs, `request ${index}: processing indication`).toBeLessThanOrEqual(200)
    await expect(page.getByTestId('source-content')).toContainText('รักษาให้คงเดิม')
    const scenario = index % 10 === 9 ? 'timeout' : index % 10 === 8 ? 'failure' : 'success'
    if (scenario === 'timeout') {
      // Authoritative controls remain usable while the provider is still running.
      await page.getByTestId('source-content').getByRole('button', { name: /Thai Wiktionary/ }).click()
      await expect(page.getByRole('dialog')).toContainText('CC-BY-SA-4.0')
      await page.keyboard.press('Escape')
    }
    const response = await completion
    const payload = await response.json()
    const totalMs = Date.now() - started
    expect(response.status()).toBe(200)
    expect(payload.data.state).toBe(scenario === 'success' ? 'grounded' : 'unavailable')
    await expect(page.locator('.ai-panel .busy')).toHaveCount(0)
    await expect(page.getByTestId('source-content')).toContainText('รักษาให้คงเดิม')
    measurements.push({ scenario, progress_ms: progressMs, total_ms: totalMs, state: payload.data.state })
  }
  const totals = measurements.map(row => row.total_ms).sort((a, b) => a - b)
  const report = {
    version: 'generation-browser-v1', viewport: testInfo.project.name, requests: measurements.length,
    provider_timeout_seconds: 8, p95_ms: totals[Math.ceil(totals.length * .95) - 1],
    max_progress_ms: Math.max(...measurements.map(row => row.progress_ms)), measurements,
    limitations: ['Local Chromium, mobile emulation; reference environment pending Q-013/Q-014 approval', 'Controlled extractive/failure providers, not remote-provider latency or participant testing'],
  }
  expect(report.p95_ms).toBeLessThanOrEqual(15000)
  const path = testInfo.outputPath('measurements.json')
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8')
  await testInfo.attach('measurements', { path, contentType: 'application/json' })
  console.log(`${report.viewport}: requests=${report.requests}, p95=${report.p95_ms}ms, max progress=${report.max_progress_ms.toFixed(1)}ms`)
})
