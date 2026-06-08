import { defineConfig, devices } from '@playwright/test'

const e2ePort = process.env.MOEURL_E2E_PORT ?? '8080'
const baseURL = `http://127.0.0.1:${e2ePort}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `docker compose down -v && docker compose up --build`,
    cwd: '..',
    env: {
      MOEURL_HTTP_PORT: e2ePort,
    },
    reuseExistingServer: false,
    timeout: 240_000,
    url: `${baseURL}/api/v1/health`,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
