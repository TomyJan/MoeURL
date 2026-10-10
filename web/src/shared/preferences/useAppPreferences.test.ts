import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sourcePath = resolve(__dirname, 'useAppPreferences.ts')

/** Configures i18n, theme, storage, and media-query mocks for preference tests. */
function mockPreferenceRuntime(
  themePreference: string,
  matchMediaValue: (query: string) => {
    addEventListener?: (event: 'change', listener: (event: { matches: boolean }) => void) => void
    matches?: boolean
  },
  languagePreference: string | null = null,
) {
  vi.resetModules()
  let systemMatches = false
  const state = {
    locale: { value: 'zh-CN' },
    themeName: { value: 'moeurlLight' },
  }

  vi.doMock('vue-i18n', () => ({
    useI18n: () => ({
      locale: state.locale,
    }),
  }))
  vi.doMock('vuetify', () => ({
    useTheme: () => ({
      global: {
        name: state.themeName,
      },
    }),
  }))
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => key === 'moeurl.theme' ? themePreference : key === 'moeurl.language' ? languagePreference : null),
      setItem: vi.fn(),
    },
  })
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const mediaQuery = matchMediaValue(query)
      const addEventListener = mediaQuery.addEventListener
      return {
        ...mediaQuery,
        get matches() {
          return systemMatches
        },
        addEventListener: addEventListener
          ? (event: 'change', listener: (event: { matches: boolean }) => void) => {
              addEventListener(event, (changeEvent: { matches: boolean }) => {
                systemMatches = changeEvent.matches
                listener(changeEvent)
              })
            }
          : undefined,
      }
    }),
  )

  return state
}

describe('useAppPreferences', () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true })
  })
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

  it('applies server defaults when neither local nor browser preferences decide the value', async () => {
    Object.defineProperty(window.navigator, 'language', { value: 'fr-FR', configurable: true })
    const state = mockPreferenceRuntime('invalid', vi.fn(() => ({ matches: false })))
    const { useAppPreferences } = await import('./useAppPreferences')
    const preferences = useAppPreferences()

    preferences.applyServerDefaults('en', 'dark')

    expect(state.locale.value).toBe('en')
    expect(state.themeName.value).toBe('moeurlDark')
  })

  it('does not replace valid locally stored preferences with server defaults', async () => {
    const state = mockPreferenceRuntime('light', vi.fn(() => ({ matches: false })), 'zh-CN')
    const { useAppPreferences } = await import('./useAppPreferences')
    const preferences = useAppPreferences()

    preferences.applyServerDefaults('en', 'dark')

    expect(state.locale.value).toBe('zh-CN')
    expect(state.themeName.value).toBe('moeurlLight')
  })

  it('uses the public Vuetify entrypoint and shared theme resolution', () => {
    const source = readFileSync(sourcePath, 'utf8')

    expect(source).toContain("import { useTheme } from 'vuetify'")
    expect(source).not.toContain("from 'vuetify/framework'")
    expect(source).toContain("resolveVuetifyTheme('system')")
    expect(source).not.toContain("event.matches ? 'moeurlDark' : 'moeurlLight'")
  })
})
