import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import App from './App.vue'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  routePath: { value: '/' },
  themeName: { value: 'moeurlLight' },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('vuetify/framework', () => ({
  useTheme: () => ({
    global: {
      name: state.themeName,
    },
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({
    get path() {
      return state.routePath.value
    },
  }),
}))

const preferenceSpies = vi.hoisted(() => ({
  saveLanguagePreference: vi.fn(),
  saveThemePreference: vi.fn(),
}))

vi.mock('@/shared/preferences/preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/preferences/preferences')>()
  return {
    ...actual,
    loadPreferences: vi.fn(() => ({ language: 'zh-CN', theme: 'light' })),
    saveLanguagePreference: preferenceSpies.saveLanguagePreference,
    saveThemePreference: preferenceSpies.saveThemePreference,
  }
})

describe('App', () => {
  beforeEach(() => {
    state.routePath.value = '/'
    preferenceSpies.saveLanguagePreference.mockReset()
    preferenceSpies.saveThemePreference.mockReset()
  })

  it('renders the route outlet without global product navigation', () => {
    render(App, { global: { stubs: componentStubs } })

    expect(screen.getByTestId('router-view')).toBeTruthy()
    expect(screen.queryByText('nav.links')).toBeNull()
    expect(screen.queryByText('nav.admin')).toBeNull()
  })

  it('persists toolbar language and theme selections', async () => {
    render(App, { global: { stubs: componentStubs } })

    expect(screen.getByLabelText('app preferences').classList.contains('app-preferences--compact')).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: '切换语言' }))
    await fireEvent.click(screen.getByRole('button', { name: '切换主题' }))

    expect(preferenceSpies.saveLanguagePreference).toHaveBeenCalledWith('en')
    expect(preferenceSpies.saveThemePreference).toHaveBeenCalledWith('dark')
    expect(state.themeName.value).toBe('moeurlDark')
  })

  it('moves global preferences away from the console sidebar', () => {
    state.routePath.value = '/link'

    render(App, { global: { stubs: componentStubs } })

    expect(screen.queryByLabelText('app preferences')).toBeNull()
  })

  it('cycles preference button labels', async () => {
    render(App, { global: { stubs: componentStubs } })

    const languageButton = screen.getByRole('button', { name: '切换语言' })
    const themeButton = screen.getByRole('button', { name: '切换主题' })

    expect(languageButton.textContent).toContain('CN')
    await fireEvent.click(languageButton)
    expect(languageButton.textContent).toContain('EN')
    await fireEvent.click(languageButton)
    expect(languageButton.textContent).toContain('CN')

    expect(themeButton.textContent).toContain('Light')
    await fireEvent.click(themeButton)
    expect(themeButton.textContent).toContain('Dark')
    await fireEvent.click(themeButton)
    expect(themeButton.textContent).toContain('Auto')
  })
})
