import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export default defineConfig({
  testDir: './reliability', timeout: 180000, fullyParallel: false, workers: 1,
  outputDir: '../artifacts/reliability-browser',
  reporter: [['list'], ['json', { outputFile: '../artifacts/reliability-report.json' }]],
  use: { baseURL: 'http://127.0.0.1:8776', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } } },
  ],
  webServer: {
    command: `${process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'} -m scripts.reliability_server --port 8776`,
    cwd: root, url: 'http://127.0.0.1:8776/ready', reuseExistingServer: false, timeout: 45000,
    env: { PYTHONIOENCODING: 'utf-8' },
  },
})
