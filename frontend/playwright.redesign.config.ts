import { defineConfig } from '@playwright/test'

/* The redesign specs stub every /api/** route, so they need the built front end and no
   backend. Serving it here keeps the suite runnable on a clean checkout instead of
   assuming someone left a dev server on a particular port. */
export default defineConfig({
  testDir:'./e2e-redesign', timeout:45000, workers:1,
  reporter:[['list']], outputDir:'../artifacts/redesign/test-results',
  webServer:{ command:'npm run build && npx vite preview --host 127.0.0.1 --port 4181 --strictPort', url:'http://127.0.0.1:4181', reuseExistingServer:!process.env.CI, timeout:180000 },
  // Defaults to Playwright's bundled Chromium. Set PLAYWRIGHT_CHANNEL=msedge (or chrome)
  // to run against an installed browser where the Playwright CDN is unreachable.
  use:{ baseURL:'http://127.0.0.1:4181', browserName:'chromium', channel:process.env.PLAYWRIGHT_CHANNEL, viewport:{width:1280,height:800}, screenshot:'only-on-failure', trace:'retain-on-failure' },
})
