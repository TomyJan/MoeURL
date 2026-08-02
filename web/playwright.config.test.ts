import { describe, expect, it } from 'vitest'

import { detectFallbackBrowserChannel } from './playwright.config'

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
