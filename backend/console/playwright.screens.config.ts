import { defineConfig, devices } from '@playwright/test';

// QA screenshots with every /api call answered from the contract fixtures (no backend needed).
//   npm run screenshots   → qa/screenshots/*.png
export default defineConfig({
  testDir: './e2e',
  testMatch: 'screenshots.spec.ts',
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 860 },
    deviceScaleFactor: 2,
    locale: 'zh-TW',
  },
  webServer: {
    command: 'npx vite preview --port 4179 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4179/console/',
    timeout: 30_000,
    reuseExistingServer: true,
  },
});
