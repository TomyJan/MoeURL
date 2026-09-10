import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { chromium, defineConfig, devices } from '@playwright/test'

type BrowserChannel = 'chrome' | 'msedge'
type BrowserCandidate = {
  channel: BrowserChannel
  paths: string[]
}

const e2ePort = process.env.MOEURL_E2E_PORT ?? '8080'
const e2ePostgresPassword = process.env.MOEURL_E2E_POSTGRES_PASSWORD ?? randomBytes(32).toString('hex')
const e2eDatabaseURL = `postgres://moeurl:${encodeURIComponent(e2ePostgresPassword)}@postgres:5432/moeurl?sslmode=disable`
const baseURL = `http://127.0.0.1:${e2ePort}`
const composeProjectName = resolveE2EComposeProjectName(process.env.MOEURL_E2E_COMPOSE_PROJECT, e2ePort)
const browserChannel = process.env.MOEURL_E2E_BROWSER_CHANNEL?.trim() || detectFallbackBrowserChannel()
const skipDockerCompose = shouldSkipDockerCompose()
const browserUse = {
  ...devices['Desktop Chrome'],
  channel: browserChannel,
}

/** Interprets the opt-out flag used by local E2E environments with an existing backend. */
export function shouldSkipDockerCompose(envValue = process.env.MOEURL_E2E_SKIP_DOCKER): boolean {
  const normalized = envValue?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true'
}

/** Resolves a project name reserved for destructive, isolated E2E Compose cleanup. */
export function resolveE2EComposeProjectName(value: string | undefined, port: string): string {
  const projectName = value?.trim() || `moeurl-e2e-${port.trim()}-${randomBytes(6).toString('hex')}`
  if (!/^moeurl-e2e-[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    throw new Error('MOEURL_E2E_COMPOSE_PROJECT must name an isolated E2E Compose project using the moeurl-e2e- prefix')
  }
  return projectName
}

/** Selects an installed browser channel when bundled Chromium is unavailable. */
export function detectFallbackBrowserChannel(
  executableExists: (path: string) => boolean = existsSync,
  bundledChromiumPath = chromium.executablePath(),
): BrowserChannel | undefined {
  if (executableExists(bundledChromiumPath)) {
    return undefined
  }

  const candidates: BrowserCandidate[] = [
    {
      channel: 'chrome',
      paths: [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/opt/google/chrome/chrome',
      ],
    },
    {
      channel: 'msedge',
      paths: [
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/microsoft-edge',
        '/usr/bin/microsoft-edge-stable',
        '/opt/microsoft/msedge/msedge',
      ],
    },
  ]

  return candidates.find(({ paths }) => paths.some((path) => executableExists(path)))?.channel
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
  webServer: skipDockerCompose
    ? {
        // This no-op Node process cannot satisfy the health check; Playwright waits for an existing backend and times out if absent.
        command: 'node -e "setInterval(() => {}, 1 << 30)"',
        reuseExistingServer: true,
        timeout: 15_000,
        url: `${baseURL}/api/v1/health`,
      }
    : {
        command:
          'node -e "const { execFileSync } = require(\'node:child_process\'); const project = process.env.MOEURL_E2E_COMPOSE_PROJECT; execFileSync(\'docker\', [\'compose\', \'-p\', project, \'down\', \'-v\'], { stdio: \'inherit\' }); execFileSync(\'docker\', [\'compose\', \'-p\', project, \'up\', \'--build\'], { stdio: \'inherit\' });"',
        cwd: '..',
        env: {
          MOEURL_E2E_COMPOSE_PROJECT: composeProjectName,
          MOEURL_ENV: 'development',
          MOEURL_HTTP_PORT: e2ePort,
          MOEURL_POSTGRES_PASSWORD: e2ePostgresPassword,
          MOEURL_DATABASE_URL: e2eDatabaseURL,
        },
        reuseExistingServer: false,
        timeout: 600_000,
        url: `${baseURL}/api/v1/health`,
      },
  projects: [
    {
      name: 'setup',
      testMatch: '**/initialize.setup.ts',
      use: browserUse,
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: '**/initialize.setup.ts',
      use: browserUse,
    },
  ],
})
