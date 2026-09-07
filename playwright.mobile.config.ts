import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/mobile',
  outputDir: './test-results/mobile',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:45324', viewport: { width: 390, height: 844 }, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: { command: 'node scripts/mobile-preview.mjs', url: 'http://127.0.0.1:45324', reuseExistingServer: false },
})
