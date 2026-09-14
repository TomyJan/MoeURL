import { afterEach, describe, expect, it, vi } from 'vitest'

import { detectFallbackBrowserChannel, shouldSkipDockerCompose } from './playwright.config'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('detectFallbackBrowserChannel', () => {
  const bundledChromium = 'bundled/chromium'

  it('uses bundled Chromium when Playwright has already provisioned it', () => {
    expect(detectFallbackBrowserChannel((path) => path === bundledChromium, bundledChromium)).toBeUndefined()
  })

  it('falls back to system Chrome on Linux when bundled Chromium is unavailable', () => {
    expect(detectFallbackBrowserChannel((path) => path === '/usr/bin/google-chrome-stable', bundledChromium)).toBe('chrome')
  })

  it('falls back to system Edge on macOS when bundled Chromium is unavailable', () => {
    expect(
      detectFallbackBrowserChannel(
        (path) => path === '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        bundledChromium,
      ),
    ).toBe('msedge')
  })

  it('keeps Playwright defaults when no known system browser is found', () => {
    expect(detectFallbackBrowserChannel(() => false, bundledChromium)).toBeUndefined()
  })
})

describe('shouldSkipDockerCompose', () => {
  it('uses Docker Compose by default', () => {
    vi.stubEnv('MOEURL_E2E_SKIP_DOCKER', undefined)

    expect(shouldSkipDockerCompose()).toBe(false)
  })

  it('skips Docker Compose for local server mode', () => {
    expect(shouldSkipDockerCompose('1')).toBe(true)
    expect(shouldSkipDockerCompose(' TRUE ')).toBe(true)
  })

  it('does not skip Docker Compose for other values', () => {
    expect(shouldSkipDockerCompose('0')).toBe(false)
    expect(shouldSkipDockerCompose('false')).toBe(false)
  })

  it('waits for an existing backend health check when Docker Compose is skipped', async () => {
    vi.stubEnv('MOEURL_E2E_SKIP_DOCKER', '1')
    vi.stubEnv('MOEURL_E2E_PORT', '8080')
    vi.resetModules()

    const { default: config } = await import('./playwright.config')

    expect(config.webServer).toMatchObject({
      command: expect.stringContaining('node -e'),
      reuseExistingServer: true,
      timeout: 15_000,
      url: 'http://127.0.0.1:8080/api/v1/health',
    })
  })
})

describe('OIDC E2E port configuration', () => {
  it.each(['', '0', 'not-a-port', '1.5', '65536', ' 19000 '])('rejects invalid port %j', async (value) => {
    vi.stubEnv('MOEURL_E2E_OIDC_PORT', value)
    vi.resetModules()

    await expect(import('./e2e/support')).rejects.toThrow(/MOEURL_E2E_OIDC_PORT/)
  })

  it('shares one validated port with the Playwright Compose environment', async () => {
    vi.stubEnv('MOEURL_E2E_OIDC_PORT', '65535')
    vi.resetModules()

    const support = await import('./e2e/support')
    const { default: config } = await import('./playwright.config')
    const webServer = config.webServer as { env?: Record<string, string> }

    expect(support.e2eOIDCPort).toBe('65535')
    expect(webServer.env?.MOEURL_E2E_OIDC_PORT).toBe(support.e2eOIDCPort)
  })
})
