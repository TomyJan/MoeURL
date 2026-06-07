import { fireEvent, render, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import App from './App.vue'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  currentUser: { value: undefined as unknown },
  invalidateQueries: vi.fn(),
  logoutMutate: vi.fn(),
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

vi.mock('@tanstack/vue-query', () => ({
  useMutation: vi.fn((options?: { onSuccess?: () => void }) => ({
    isPending: ref(false),
    mutate: vi.fn(() => {
      state.logoutMutate()
      options?.onSuccess?.()
    }),
  })),
  useQuery: vi.fn(() => ({
    data: state.currentUser,
  })),
}))

vi.mock('@/app/query', () => ({
  queryClient: {
    invalidateQueries: state.invalidateQueries,
  },
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
    state.currentUser.value = undefined
    state.invalidateQueries.mockReset()
    state.logoutMutate.mockReset()
    preferenceSpies.saveLanguagePreference.mockReset()
    preferenceSpies.saveThemePreference.mockReset()
  })

  it('renders guest navigation and login action', () => {
    render(App, { global: { stubs: componentStubs } })

    expect(screen.getByText('MoeURL')).toBeTruthy()
    expect(screen.getByText('guest')).toBeTruthy()
    expect(screen.getByText('nav.login')).toBeTruthy()
  })

  it('renders authorized navigation and logs out users', async () => {
    state.currentUser.value = {
      user: {
        username: 'alice',
        nickname: 'Alice',
        group: 'admin',
        permissions: ['short_link:read_own', 'admin:access'],
      },
    }

    render(App, { global: { stubs: componentStubs } })

    expect(screen.getByText('nav.links')).toBeTruthy()
    expect(screen.getByText('nav.admin')).toBeTruthy()
    expect(screen.getByText('nav.users')).toBeTruthy()
    expect(screen.getByText('Alice')).toBeTruthy()

    await fireEvent.click(screen.getByText('nav.logout'))

    expect(state.logoutMutate).toHaveBeenCalled()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
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
