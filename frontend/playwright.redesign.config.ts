import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir:'./e2e-redesign', timeout:45000, workers:1,
  reporter:[['list']], outputDir:'../artifacts/redesign/test-results',
  use:{ baseURL:'http://127.0.0.1:8001', browserName:'chromium', viewport:{width:1280,height:800}, screenshot:'only-on-failure', trace:'retain-on-failure' },
})
