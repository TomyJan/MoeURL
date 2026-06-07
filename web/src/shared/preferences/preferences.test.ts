import { describe, expect, it, vi } from 'vitest'

import {
  loadPreferences,
  resolveVuetifyTheme,
  saveLanguagePreference,
  saveThemePreference,
} from './preferences'

describe('preferences', () => {
  it('loads defaults when storage is empty', () => {
    localStorage.clear()

    const preferences = loadPreferences()

    expect(preferences.language).toBe('zh-CN')
    expect(preferences.theme).toBe('system')
  })

  it('persists supported language and theme values', () => {
    localStorage.clear()

    saveLanguagePreference('en')
    saveThemePreference('dark')

    expect(loadPreferences()).toEqual({ language: 'en', theme: 'dark' })
  })

  it('ignores unsupported stored values', () => {
    localStorage.setItem('moeurl.language', 'fr')
    localStorage.setItem('moeurl.theme', 'sepia')

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
