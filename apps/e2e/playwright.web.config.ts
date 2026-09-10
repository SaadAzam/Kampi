import { defineConfig, devices } from '@playwright/test';

const browserName = process.env.WEB_TEST_BROWSER === 'webkit' ? 'webkit' : 'chromium';

export default defineConfig({
  testDir: './tests',
  testMatch: 'web-lobby.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices[browserName === 'webkit' ? 'Desktop Safari' : 'Desktop Chrome'],
    browserName,
    channel: browserName === 'chromium' ? process.env.WEB_TEST_BROWSER_CHANNEL : undefined,
    baseURL: process.env.WEB_TEST_URL ?? 'http://127.0.0.1:3200',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'web-lobby' }],
});
