import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import App from './App.vue'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
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

    const selects = screen.getAllByLabelText('select')
    await fireEvent.update(selects[0], 'en')
    await fireEvent.update(selects[1], 'dark')

    expect(preferenceSpies.saveLanguagePreference).toHaveBeenCalledWith('en')
    expect(preferenceSpies.saveThemePreference).toHaveBeenCalledWith('dark')
    expect(state.themeName.value).toBe('moeurlDark')
  })
})
