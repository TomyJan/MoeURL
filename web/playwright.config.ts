import { existsSync } from 'node:fs'
import { chromium, defineConfig, devices } from '@playwright/test'

const e2ePort = process.env.MOEURL_E2E_PORT ?? '8080'
const e2ePostgresPort = process.env.MOEURL_E2E_POSTGRES_PORT ?? '15432'
const baseURL = `http://127.0.0.1:${e2ePort}`
const composeProjectName = process.env.MOEURL_E2E_COMPOSE_PROJECT ?? `moeurl-e2e-${e2ePort}`
const browserChannel = process.env.MOEURL_E2E_BROWSER_CHANNEL?.trim() || detectFallbackBrowserChannel()

function detectFallbackBrowserChannel() {
  if (existsSync(chromium.executablePath()) || process.platform !== 'win32') {
    return undefined
  }

  const candidates = [
    {
      channel: 'chrome',
      paths: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ],
    },
    {
      channel: 'msedge',
      paths: [
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ],
    },
  ]

  return candidates.find(({ paths }) => paths.some((path) => existsSync(path)))?.channel
}

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
    command:
      'node -e "const { execFileSync } = require(\'node:child_process\'); const project = process.env.MOEURL_E2E_COMPOSE_PROJECT; try { execFileSync(\'docker\', [\'compose\', \'-p\', project, \'down\', \'-v\'], { stdio: \'inherit\' }); } catch {} execFileSync(\'docker\', [\'compose\', \'-p\', project, \'up\', \'--build\'], { stdio: \'inherit\' });"',
    cwd: '..',
    env: {
      MOEURL_E2E_COMPOSE_PROJECT: composeProjectName,
      MOEURL_ENV: 'development',
      MOEURL_HTTP_PORT: e2ePort,
      MOEURL_POSTGRES_PORT: e2ePostgresPort,
    },
    reuseExistingServer: false,
    timeout: 240_000,
    url: `${baseURL}/api/v1/health`,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
})
