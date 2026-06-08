import { describe, expect, it, vi } from 'vitest'

function mockPreferenceRuntime(themePreference: string, matchMediaValue: ReturnType<typeof vi.fn>) {
  vi.resetModules()
  const state = {
    locale: { value: 'zh-CN' },
    themeName: { value: 'moeurlLight' },
  }

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      locale: state.locale,
    }),
  }))
  vi.doMock('vuetify/framework', () => ({
    useTheme: () => ({
      global: {
        name: state.themeName,
      },
    }),
  }))
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => (key === 'moeurl.theme' ? themePreference : null)),
      setItem: vi.fn(),
    },
  })
  vi.stubGlobal('matchMedia', matchMediaValue)

  return state
}

describe('useAppPreferences', () => {
  it('updates Vuetify theme when the system color scheme changes in system mode', async () => {
    const listeners: Array<(event: { matches: boolean }) => void> = []
    const state = mockPreferenceRuntime(
      'system',
      vi.fn(() => ({
        addEventListener: (_event: 'change', listener: (event: { matches: boolean }) => void) => {
          listeners.push(listener)
        },
        matches: false,
      })),
    )

    const { useAppPreferences } = await import('./useAppPreferences')

    useAppPreferences()
    expect(state.themeName.value).toBe('moeurlLight')

    listeners.forEach((listener) => listener({ matches: true }))

    expect(state.themeName.value).toBe('moeurlDark')

    listeners.forEach((listener) => listener({ matches: false }))

    expect(state.themeName.value).toBe('moeurlLight')
  })

  it('keeps explicit theme choices stable when the system color scheme changes', async () => {
    const listeners: Array<(event: { matches: boolean }) => void> = []
    const state = mockPreferenceRuntime(
      'light',
      vi.fn(() => ({
        addEventListener: (_event: 'change', listener: (event: { matches: boolean }) => void) => {
          listeners.push(listener)
        },
        matches: false,
      })),
    )

    const { useAppPreferences } = await import('./useAppPreferences')

    useAppPreferences()
    listeners.forEach((listener) => listener({ matches: true }))

    expect(state.themeName.value).toBe('moeurlLight')
  })

  it('safely skips system theme listeners when matchMedia change events are unavailable', async () => {
    const state = mockPreferenceRuntime(
      'system',
      vi.fn(() => ({
        matches: false,
      })),
    )

    const { useAppPreferences } = await import('./useAppPreferences')

    useAppPreferences()

    expect(state.themeName.value).toBe('moeurlLight')
  })

  it('installs the system theme listener only once', async () => {
    const addEventListener = vi.fn()
    mockPreferenceRuntime(
      'system',
      vi.fn(() => ({
        addEventListener,
        matches: false,
      })),
    )

    const { useAppPreferences } = await import('./useAppPreferences')

    useAppPreferences()
    useAppPreferences()

    expect(addEventListener).toHaveBeenCalledTimes(1)
  })
})
