import { defineConfig, devices } from '@playwright/test';

const API_URL = process.env.API_PUBLIC_URL ?? 'http://localhost:4000';
const GAME_URL = process.env.GAME_PENALTY_PUBLIC_URL ?? 'http://localhost:5174';
const REALTIME_URL = process.env.REALTIME_PUBLIC_URL ?? 'ws://localhost:2567';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: GAME_URL,
    trace: 'on-first-retry',
  },
  metadata: { API_URL, REALTIME_URL, GAME_URL },
});
