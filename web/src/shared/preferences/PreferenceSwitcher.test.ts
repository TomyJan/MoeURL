import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { readFileSync } from 'node:fs'
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
    t: (key: string) =>
      ({
        'preferences.language': '选择语言',
        'preferences.languageOptions': '语言选项',
        'preferences.theme': '选择主题',
        'preferences.themeOptions': '主题选项',
        'preferences.system': '跟随系统',
        'preferences.systemShort': '系统',
        'preferences.light': '浅色',
        'preferences.dark': '深色',
      })[key] ?? key,
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

  it('selects language and theme from two dropdown menus', async () => {
    render(PreferenceSwitcher)

    expect(screen.getByRole('group', { name: 'app preferences' })).toBeTruthy()

    const languageButton = screen.getByRole('button', { name: '选择语言' })
    const themeButton = screen.getByRole('button', { name: '选择主题' })

    expect(languageButton.classList.contains('preference-switcher__trigger--icon')).toBe(true)
    expect(themeButton.classList.contains('preference-switcher__trigger--icon')).toBe(true)
    expect(languageButton.textContent).toContain('Aa')
    await fireEvent.click(languageButton)
    expect(screen.getByRole('menu', { name: '语言选项' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))
    expect(languageButton.textContent).toContain('Aa')
    expect(state.locale.value).toBe('en')
    expect(preferenceSpies.saveLanguagePreference).toHaveBeenCalledWith('en')
    await fireEvent.click(languageButton)
    await fireEvent.click(screen.getByRole('menuitemradio', { name: '中文' }))
    expect(languageButton.textContent).toContain('Aa')
    expect(state.locale.value).toBe('zh-CN')
    expect(preferenceSpies.saveLanguagePreference).toHaveBeenCalledWith('zh-CN')

    expect(themeButton.textContent).not.toContain('浅色')
    await fireEvent.click(themeButton)
    expect(screen.getByRole('menu', { name: '主题选项' })).toBeTruthy()
    expect(screen.getAllByTestId('theme-choice')).toHaveLength(3)
    await fireEvent.click(screen.getByRole('menuitemradio', { name: '深色' }))
    expect(themeButton.querySelector('.preference-switcher__mark--dark')).toBeTruthy()
    expect(state.themeName.value).toBe('moeurlDark')
    expect(preferenceSpies.saveThemePreference).toHaveBeenCalledWith('dark')

    await fireEvent.click(themeButton)
    await fireEvent.click(screen.getByRole('menuitemradio', { name: '跟随系统' }))
    expect(themeButton.querySelector('.preference-switcher__mark--system')).toBeTruthy()
    expect(preferenceSpies.saveThemePreference).toHaveBeenCalledWith('system')
  })

  it('adapts to sidebar placement without changing preference behavior', async () => {
    const { container } = render(PreferenceSwitcher, {
      props: {
        density: 'compact',
        placement: 'sidebar',
      },
    })

    expect(container.querySelector('.preference-switcher--compact')).toBeTruthy()
    expect(container.querySelector('.preference-switcher--sidebar')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: '选择语言' }))
    await fireEvent.click(screen.getByRole('menuitemradio', { name: 'English' }))

    await waitFor(() => {
      expect(preferenceSpies.saveLanguagePreference).toHaveBeenCalledWith('en')
    })
  })

  it('closes open menus from outside click and Escape', async () => {
    render(PreferenceSwitcher)

    await fireEvent.click(screen.getByRole('button', { name: '选择语言' }))
    expect(screen.getByRole('menu', { name: '语言选项' })).toBeTruthy()

    await fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: '语言选项' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '选择主题' }))
    expect(screen.getByRole('menu', { name: '主题选项' })).toBeTruthy()

    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '主题选项' })).toBeNull()
  })

  it('uses the mist blue graphite palette for theme preview graphics', () => {
    const source = readFileSync('src/shared/preferences/PreferenceSwitcher.vue', 'utf8')

    expect(source).toContain('#f5f7fb')
    expect(source).toContain('#c47a4a')
    expect(source).toContain('#101722')
    expect(source).toContain('#1a2433')
    expect(source).toContain('#8ab8e8')
    expect(source).not.toContain('#f6fbf8')
    expect(source).not.toContain('#f0a94f')
    expect(source).not.toContain('#65d6b1')
  })
})
