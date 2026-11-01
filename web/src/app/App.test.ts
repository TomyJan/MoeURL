import { render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onMounted, ref } from 'vue'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { queryClient } from './query'

import App from './App.vue'
import { componentStubs } from '@/test/component-stubs'
import { getPublicConfig } from '@/entities/system/api'

const state = vi.hoisted(() => ({
  routePath: { value: '/' },
  themeName: { value: 'moeurlLight' },
  themes: { value: {
    moeurlLight: { colors: { primary: '#5c4dde', 'on-primary': '#ffffff' }, variables: { 'app-hero-glow': 'rgba(92, 77, 222, 0.09)', 'app-ring': 'rgba(92, 77, 222, 0.38)' } },
    moeurlDark: { colors: { primary: '#b9adff', 'on-primary': '#272047' }, variables: { 'app-hero-glow': 'rgba(185, 173, 255, 0.07)', 'app-ring': 'rgba(185, 173, 255, 0.44)' } },
  } },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('vuetify', () => ({
  useTheme: () => ({
    themes: state.themes,
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

vi.mock('@/entities/auth/api', () => ({ me: vi.fn(async () => ({ user: { id: '', username: 'guest', group: 'guest' } })) }))
vi.mock('@/shared/preferences/useAccountPreferences', async importOriginal => ({ ...await importOriginal<typeof import('@/shared/preferences/useAccountPreferences')>(), useAccountPreferences: vi.fn() }))

vi.mock('@/entities/system/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/system/api')>()
  return { ...actual, getPublicConfig: vi.fn() }
})

const queryPlugin: [typeof VueQueryPlugin, { queryClient: typeof queryClient }] = [VueQueryPlugin, { queryClient }]

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
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { accentPreset: 'iris' }, meta: {} }), { status: 200 })))
    state.routePath.value = '/'
    queryClient.clear()
    document.title = 'MoeURL'
    vi.mocked(getPublicConfig).mockReset()
    vi.mocked(getPublicConfig).mockResolvedValue({
      siteName: 'Configured site',
      defaultLanguage: 'en',
      defaultTheme: 'dark',
      footerText: '',
      showPoweredBy: true,
    })
    preferenceSpies.saveLanguagePreference.mockReset()
    preferenceSpies.saveThemePreference.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads site appearance and applies both palettes without changing the selected mode or preferences', async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { accentPreset: 'forest' }, meta: {} }), { status: 200 }))
    state.themeName.value = 'moeurlDark'
    render(App, { global: { plugins: [queryPlugin], stubs: componentStubs } })
    await waitFor(() => expect(state.themes.value.moeurlLight.colors.primary).toBe('#236744'))
    expect(state.themes.value.moeurlDark.colors.primary).toBe('#8dd9a3')
    expect(state.themeName.value).toBe('moeurlDark')
    expect(preferenceSpies.saveLanguagePreference).not.toHaveBeenCalled()
    expect(preferenceSpies.saveThemePreference).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledWith('/api/v1/system/appearance', expect.objectContaining({ method: 'GET' }))
  })

  it('renders the route outlet without global product navigation', () => {
    render(App, {
      global: {
        plugins: [queryPlugin],
        stubs: {
          ...componentStubs,
          RouterView: {
            template: `<div data-testid="router-view"><slot :Component="{ template: '<section data-testid=\\'route-component\\'>route</section>' }" :route="{ fullPath: '/route' }" /></div>`,
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
    render(App, { global: { plugins: [queryPlugin], stubs: componentStubs } })

    expect(screen.queryByLabelText('preferences.groupLabel')).toBeNull()
    expect(screen.queryByRole('button', { name: '切换语言' })).toBeNull()
    expect(screen.queryByRole('button', { name: '切换主题' })).toBeNull()
  })

  it('wraps route changes with a reusable transition boundary', () => {
    render(App, { global: { plugins: [queryPlugin], stubs: componentStubs } })

    expect(screen.getByTestId('app-route-transition')).toBeTruthy()
  })

  it('applies the loaded public brand and server defaults', async () => {
    render(App, { global: { plugins: [queryPlugin], stubs: componentStubs } })

    await waitFor(() => expect(document.title).toBe('Configured site'))
  })

  it('keeps the routed shell mounted when only the nested full path changes', async () => {
    const mountCount = ref(0)
    const routeFullPath = ref('/')
    const routeMatchedPath = ref('/console')
    const RoutedComponent = defineComponent({
      /** Tracks routed component mounts across initialization-state changes. */
      setup() {
        onMounted(() => {
          mountCount.value += 1
        })
        return () => h('section', { 'data-testid': 'route-component' }, `mounted ${mountCount.value}`)
      },
    })

    render(App, {
      global: {
        plugins: [queryPlugin],
        stubs: {
          ...componentStubs,
          RouterView: {
            components: { RoutedComponent },
            /** Renders the routed test component through the supplied slot. */
            setup(_, { slots }) {
              return () =>
                h(
                  'div',
                  { 'data-testid': 'router-view' },
                  slots.default?.({
                    Component: RoutedComponent,
                    route: { fullPath: routeFullPath.value, matched: [{ path: routeMatchedPath.value }] },
                  }),
                )
            },
          },
        },
      },
    })

    expect(mountCount.value).toBe(1)
    routeFullPath.value = '/link?status=active'
    await nextTick()

    expect(mountCount.value).toBe(1)

    routeMatchedPath.value = '/login'
    await nextTick()

    expect(mountCount.value).toBe(2)
  })
})
