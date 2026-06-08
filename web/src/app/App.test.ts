import { render, screen } from '@testing-library/vue'
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
    render(App, {
      global: {
        stubs: {
          ...componentStubs,
          RouterView: {
            template: '<div data-testid="router-view"><slot :Component="{ template: \'<section data-testid=\\\'route-component\\\'>route</section>\' }" /></div>',
          },
        },
      },
    })

    expect(screen.getByTestId('router-view')).toBeTruthy()
    expect(screen.getByTestId('route-component')).toBeTruthy()
    expect(screen.queryByText('nav.links')).toBeNull()
    expect(screen.queryByText('nav.admin')).toBeNull()
  })

  it('leaves preference controls to page layouts instead of floating globally', () => {
    render(App, { global: { stubs: componentStubs } })

    expect(screen.queryByLabelText('app preferences')).toBeNull()
    expect(screen.queryByRole('button', { name: '切换语言' })).toBeNull()
    expect(screen.queryByRole('button', { name: '切换主题' })).toBeNull()
  })

  it('wraps route changes with a reusable transition boundary', () => {
    render(App, { global: { stubs: componentStubs } })

    expect(screen.getByTestId('app-route-transition')).toBeTruthy()
  })
})
