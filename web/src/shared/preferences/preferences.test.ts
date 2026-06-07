import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  loadPreferences,
  resolveVuetifyTheme,
  saveLanguagePreference,
  saveThemePreference,
} from './preferences'

describe('preferences', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: createTestStorage(),
      configurable: true,
    })
  })

  it('loads defaults when storage is empty', () => {
    window.localStorage.clear()

    const preferences = loadPreferences()

    expect(preferences.language).toBe('zh-CN')
    expect(preferences.theme).toBe('system')
  })

  it('persists supported language and theme values', () => {
    window.localStorage.clear()

    saveLanguagePreference('en')
    saveThemePreference('dark')

    expect(loadPreferences()).toEqual({ language: 'en', theme: 'dark' })
  })

  it('ignores unsupported stored values', () => {
    window.localStorage.setItem('moeurl.language', 'fr')
    window.localStorage.setItem('moeurl.theme', 'sepia')

    expect(loadPreferences()).toEqual({ language: 'zh-CN', theme: 'system' })
  })

  it('resolves system theme from media query', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))

    expect(resolveVuetifyTheme('system')).toBe('moeurlDark')
    expect(resolveVuetifyTheme('light')).toBe('moeurlLight')
  })

  it('resolves system theme to light when media query does not prefer dark', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))

    expect(resolveVuetifyTheme('system')).toBe('moeurlLight')
  })

  it('resolves explicit dark theme', () => {
    expect(resolveVuetifyTheme('dark')).toBe('moeurlDark')
  })
})

function createTestStorage(): Storage {
  const entries = new Map<string, string>()

  return {
    get length() {
      return entries.size
    },
    clear() {
      entries.clear()
    },
    getItem(key: string) {
      return entries.get(key) ?? null
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null
    },
    removeItem(key: string) {
      entries.delete(key)
    },
    setItem(key: string, value: string) {
      entries.set(key, value)
    },
  }
}
