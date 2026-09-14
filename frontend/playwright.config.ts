import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export default defineConfig({
  testDir: './e2e', timeout: 45000, fullyParallel: false, workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  // PLAYWRIGHT_CHANNEL=msedge (or chrome) runs against an installed browser where the
  // Playwright CDN is unreachable; unset means the bundled Chromium.
  use: { baseURL: 'http://127.0.0.1:8765', channel: process.env.PLAYWRIGHT_CHANNEL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } } },
  ],
  webServer: {
    command: `${process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'} -m khamlink.cli serve --port 8765`,
    cwd: root, url: 'http://127.0.0.1:8765/ready', reuseExistingServer: false, timeout: 45000,
    env: { KHAMLINK_LOOKUP_RATE: '100000', KHAMLINK_COSTLY_RATE: '100000', KHAMLINK_FEEDBACK_RATE: '100000', PYTHONIOENCODING: 'utf-8' },
  },
})
