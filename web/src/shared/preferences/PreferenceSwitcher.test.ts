import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import PreferenceSwitcher from './PreferenceSwitcher.vue'

const state = vi.hoisted(() => ({
  locale: { value: 'zh-CN' },
  themeName: { value: 'moeurlLight' },
}))

const preferenceSpies = vi.hoisted(() => ({
  saveLanguagePreference: vi.fn(),
  saveThemePreference: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: state.locale,
  }),
}))

vi.mock('vuetify/framework', () => ({
  useTheme: () => ({
    global: {
      name: state.themeName,
    },
  }),
}))

vi.mock('./preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./preferences')>()
  return {
    ...actual,
    loadPreferences: vi.fn(() => ({ language: 'zh-CN', theme: 'light' })),
    saveLanguagePreference: preferenceSpies.saveLanguagePreference,
    saveThemePreference: preferenceSpies.saveThemePreference,
  }
})

describe('PreferenceSwitcher', () => {
  beforeEach(() => {
    state.locale.value = 'zh-CN'
    state.themeName.value = 'moeurlLight'
    preferenceSpies.saveLanguagePreference.mockReset()
    preferenceSpies.saveThemePreference.mockReset()
  })

  it('toggles language and theme preferences from a compact control group', async () => {
    render(PreferenceSwitcher)

    expect(screen.getByRole('group', { name: 'app preferences' })).toBeTruthy()

    const languageButton = screen.getByRole('button', { name: '切换语言' })
    const themeButton = screen.getByRole('button', { name: '切换主题' })

    expect(languageButton.textContent).toContain('CN')
    await fireEvent.click(languageButton)
    expect(languageButton.textContent).toContain('EN')
    expect(state.locale.value).toBe('en')
    expect(preferenceSpies.saveLanguagePreference).toHaveBeenCalledWith('en')
    await fireEvent.click(languageButton)
    expect(languageButton.textContent).toContain('CN')
    expect(state.locale.value).toBe('zh-CN')
    expect(preferenceSpies.saveLanguagePreference).toHaveBeenCalledWith('zh-CN')

    expect(themeButton.textContent).toContain('Light')
    await fireEvent.click(themeButton)
    expect(themeButton.textContent).toContain('Dark')
    expect(state.themeName.value).toBe('moeurlDark')
    expect(preferenceSpies.saveThemePreference).toHaveBeenCalledWith('dark')

    await fireEvent.click(themeButton)
    expect(themeButton.textContent).toContain('Auto')
    expect(preferenceSpies.saveThemePreference).toHaveBeenCalledWith('system')
  })
})
