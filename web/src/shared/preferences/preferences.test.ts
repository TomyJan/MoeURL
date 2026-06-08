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

  it('loads every supported stored preference value', () => {
    window.localStorage.setItem('moeurl.language', 'en')
    window.localStorage.setItem('moeurl.theme', 'dark')
    expect(loadPreferences()).toEqual({ language: 'en', theme: 'dark' })

    window.localStorage.setItem('moeurl.language', 'zh-CN')
    window.localStorage.setItem('moeurl.theme', 'light')
    expect(loadPreferences()).toEqual({ language: 'zh-CN', theme: 'light' })

    window.localStorage.setItem('moeurl.theme', 'system')
    expect(loadPreferences()).toEqual({ language: 'zh-CN', theme: 'system' })
  })

  it('loads the explicit system theme preference', () => {
    window.localStorage.setItem('moeurl.theme', 'system')

    expect(loadPreferences().theme).toBe('system')
  })

  it('loads the explicit light theme preference', () => {
    window.localStorage.setItem('moeurl.theme', 'light')

    expect(loadPreferences().theme).toBe('light')
  })

  it('ignores unsupported stored values', () => {
    window.localStorage.setItem('moeurl.language', 'fr')
    window.localStorage.setItem('moeurl.theme', 'sepia')

    expect(loadPreferences()).toEqual({ language: 'zh-CN', theme: 'system' })
  })

  it('loads the explicit zh-CN language preference', () => {
    window.localStorage.setItem('moeurl.language', 'zh-CN')

    expect(loadPreferences().language).toBe('zh-CN')
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

  it('falls back safely when browser storage and media query are unavailable', () => {
    vi.stubGlobal('window', {})

    expect(loadPreferences()).toEqual({ language: 'zh-CN', theme: 'system' })
    expect(() => saveLanguagePreference('zh-CN')).not.toThrow()
    expect(() => saveThemePreference('system')).not.toThrow()
    expect(resolveVuetifyTheme('system')).toBe('moeurlLight')
  })

  it('resolves system theme to light when matchMedia is unavailable', () => {
    vi.stubGlobal('window', {
      localStorage: createTestStorage(),
    })

    expect(resolveVuetifyTheme('system')).toBe('moeurlLight')
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
