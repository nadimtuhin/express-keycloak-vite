import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  baseURL: 'http://localhost:5173',
  // outage specs mutate shared containers: parallelism makes them flaky, retries would hide it
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
