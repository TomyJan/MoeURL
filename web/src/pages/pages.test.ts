import { fireEvent, render, screen, within } from '@testing-library/vue'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRef, nextTick, ref } from 'vue'

import AdminLinksPage from './AdminLinksPage.vue'
import AdminUsersPage from './AdminUsersPage.vue'
import AnalyticsPage from './AnalyticsPage.vue'
import ConsoleOverviewPage from './ConsoleOverviewPage.vue'
import ConsolePlaceholderPage from './ConsolePlaceholderPage.vue'
import CreateUserPage from './CreateUserPage.vue'
import HomePage from './HomePage.vue'
import LoginPage from './LoginPage.vue'
import MyLinksPage from './MyLinksPage.vue'
import NotFoundPage from './NotFoundPage.vue'
import SetupPage from './SetupPage.vue'
import { componentStubs } from '@/test/component-stubs'
import { login, me } from '@/entities/auth/api'
import { getAdminShortLinkStatistics, getShortLinkOverview, getShortLinkStatistics, listAdminShortLinks, listShortLinks, updateAdminShortLink, updateShortLink } from '@/entities/short-link/api'
import type { ShortLink } from '@/entities/short-link/model'
import { updateUser } from '@/entities/user/api'
import { createDeferred } from '@/test/deferred'
import type { MutationMockResult } from '@/test/mutation-mock'

const state = vi.hoisted(() => ({
  queryResult: {},
  queryResults: [] as unknown[],
  queryResultIndex: 0,
  queryKeys: [] as unknown[],
  queryFns: [] as Array<() => unknown>,
  chartConfigurations: [] as unknown[],
  mutationResult: {},
  routeQuery: {} as Record<string, unknown>,
  routerPush: vi.fn(),
  theme: {} as {
    global: {
      current: { value: { colors: { primary: string } } }
      name: { value: string }
    }
  },
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
}))

const defaultShortLinkAccessConfig = {
  redirectMode: 'direct' as const,
  intermediateDelaySeconds: 5,
  expiresAt: null,
  expired: false,
  passwordEnabled: false,
} satisfies Pick<ShortLink, 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt' | 'expired' | 'passwordEnabled'>

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('vue-router', () => ({
  RouterLink: { props: ['to'], template: '<a :data-to="to"><slot /></a>' },
  useRoute: () => ({
    query: state.routeQuery,
  }),
  useRouter: () => ({
    push: state.routerPush,
  }),
}))

vi.mock('vuetify', () => ({
  useTheme: () => state.theme,
}))

vi.mock('@/app/query', () => ({
  queryClient: state.queryClient,
}))

vi.mock('@/entities/auth/api', () => ({
  login: vi.fn(),
  me: vi.fn(async () => ({ user: { permissions: [] } })),
}))

vi.mock('@/entities/short-link/api', () => ({
  deleteAdminShortLink: vi.fn(),
  deleteShortLink: vi.fn(),
  listAdminShortLinks: vi.fn(async () => ({ items: [], meta: { page: 1, pageSize: 20, total: 0 } })),
  listShortLinks: vi.fn(async () => ({ items: [], meta: { page: 1, pageSize: 20, total: 0 } })),
  updateAdminShortLink: vi.fn(),
  updateShortLink: vi.fn(),
  createShortLink: vi.fn(async () => ({
    shortLink: { slug: 'abc123', url: 'https://go.example.com/abc123' },
  })),
  getAdminShortLinkStatistics: vi.fn(),
  getShortLinkOverview: vi.fn(async () => ({ totalLinkCount: 0, activeLinkCount: 0, visitCount: 0, todayVisitCount: 0 })),
  getShortLinkStatistics: vi.fn(),
}))

vi.mock('chart.js', () => {
  class Chart {
    static register = vi.fn()
    destroy = vi.fn()
    constructor(_canvas: unknown, configuration?: unknown) {
      state.chartConfigurations.push(configuration)
    }
  }
  return {
    CategoryScale: class {},
    Chart,
    LineController: class {},
    LineElement: class {},
    LinearScale: class {},
    PointElement: class {},
    Tooltip: class {},
  }
})

vi.mock('@/entities/system/api', () => ({
  getInitStatus: vi.fn(async () => ({ initialized: false })),
  setupSystem: vi.fn(),
}))

vi.mock('@/entities/user/api', () => ({
  createUser: vi.fn(),
  listUsers: vi.fn(async () => ({ items: [], meta: { page: 1, pageSize: 20, total: 0 } })),
  resetUserPassword: vi.fn(),
  updateUser: vi.fn(),
}))

vi.mock('@tanstack/vue-query', async () => {
  const { createMutationMock } = await import('@/test/mutation-mock')
  return {
    QueryClient: class {
      getDefaultOptions = vi.fn()
      invalidateQueries = vi.fn()
    },
    useMutation: createMutationMock({
      fields: { isError: true, reset: true, variables: true },
      getResult: () => state.mutationResult as MutationMockResult,
      resolveSynchronousResult: (_result, input) => ({
        initialized: true,
        shortLink: { slug: 'abc123', url: 'https://go.example.com/abc123' },
        user: { username: 'alice' },
        input,
      }),
    }),
    useQuery: vi.fn((options?: { enabled?: unknown; queryFn?: () => unknown; queryKey?: unknown }) => {
      state.queryKeys.push(options?.queryKey)
      if (isRef(options?.queryKey)) {
        void options.queryKey.value
      }
      const enabled = isRef(options?.enabled) ? options.enabled.value : options?.enabled
      if (enabled !== false && options?.queryFn) {
        state.queryFns.push(options.queryFn)
        void options.queryFn()
      }
      const result = state.queryResults[state.queryResultIndex] ?? state.queryResult
      state.queryResultIndex += 1
      return result
    }),
    useQueryClient: () => state.queryClient,
  }
})

function mount(component: object) {
  return render(component, {
    global: {
      stubs: componentStubs,
    },
  })
}

function setQueryResult(value: Partial<{
  data: ReturnType<typeof ref>
  isError: ReturnType<typeof ref>
  isLoading: ReturnType<typeof ref>
  isPending: ReturnType<typeof ref>
  refetch: ReturnType<typeof vi.fn>
}>) {
  state.queryResult = {
    data: value.data ?? ref(undefined),
    isError: value.isError ?? ref(false),
    isLoading: value.isLoading ?? ref(false),
    isPending: value.isPending ?? ref(false),
    refetch: value.refetch ?? vi.fn(),
  }
}

function setQueryResults(...values: Array<Parameters<typeof setQueryResult>[0]>) {
  state.queryResults = values.map((value) => ({
    data: value.data ?? ref(undefined),
    isError: value.isError ?? ref(false),
    isLoading: value.isLoading ?? ref(false),
    isPending: value.isPending ?? ref(false),
    refetch: value.refetch ?? vi.fn(),
  }))
}

function setMutationResult(value: Partial<{
  data: ReturnType<typeof ref>
  error: ReturnType<typeof ref>
  isError: ReturnType<typeof ref>
  isPending: ReturnType<typeof ref>
  mutate: ReturnType<typeof vi.fn>
  variables: ReturnType<typeof ref>
}> = {}) {
  state.mutationResult = {
    data: value.data ?? ref(undefined),
    error: value.error ?? ref(undefined),
    isError: value.isError ?? ref(false),
    isPending: value.isPending ?? ref(false),
    variables: value.variables ?? ref(undefined),
    ...(value.mutate ? { mutate: value.mutate } : {}),
  }
}

describe('pages', () => {
  beforeEach(() => {
    setQueryResult({})
    state.queryResults = []
    state.queryResultIndex = 0
    setMutationResult()
    state.queryKeys = []
    state.queryFns = []
    state.chartConfigurations = []
    state.routeQuery = {}
    state.routerPush.mockReset()
    state.queryClient.invalidateQueries.mockReset()
    state.queryClient.setQueryData.mockReset()
    vi.mocked(getAdminShortLinkStatistics).mockReset()
    vi.mocked(getShortLinkOverview).mockClear()
    vi.mocked(getShortLinkStatistics).mockReset()
    vi.mocked(updateAdminShortLink).mockReset()
    vi.mocked(updateShortLink).mockReset()
    vi.mocked(updateUser).mockReset()
    vi.mocked(login).mockReset()
    vi.mocked(me).mockReset()
    vi.mocked(me).mockResolvedValue({ user: { permissions: [] } } as never)
    state.theme = {
      global: {
        current: ref({ colors: { primary: '#315f8c' } }),
        name: ref('moeurlLight'),
      },
    }
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('renders not found page title', () => {
    mount(NotFoundPage)

    expect(screen.getByText('page.notFound')).toBeTruthy()
  })

  it('renders remaining planned console placeholder pages without fake data', () => {
    render(ConsolePlaceholderPage, {
      props: {
        kind: 'userGroups',
      },
    })

    expect(screen.getByTestId('console-page-placeholder-userGroups')).toBeTruthy()
    expect(screen.getByText('page.userGroups')).toBeTruthy()
    expect(screen.queryByText('pageMeta.workspaceEyebrow')).toBeNull()
    expect(screen.getByText('placeholder.status')).toBeTruthy()
    expect(screen.getByText('placeholder.userGroups.items.groups')).toBeTruthy()
  })

  it('renders personal overview metrics and recent links from independent queries', () => {
    setQueryResults(
      {
        data: ref({ totalLinkCount: 12, activeLinkCount: 9, visitCount: 840, todayVisitCount: 31 }),
      },
      {
        data: ref({
          items: [{
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com/recent',
            status: 'active' as const,
            ...defaultShortLinkAccessConfig,
            createdAt: '2026-07-30T04:30:00Z',
            stats: { visitCount: 20, todayVisitCount: 3, lastVisitedAt: null },
          }],
          meta: { page: 1, pageSize: 5, total: 12 },
        }),
      },
    )

    mount(ConsoleOverviewPage)

    expect(screen.getByTestId('console-page-overview')).toBeTruthy()
    expect(screen.getByText('840')).toBeTruthy()
    expect(screen.getByText('31')).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    expect(screen.getByText('https://example.com/recent')).toBeTruthy()
    expect(screen.getByText('2026-07-30')).toBeTruthy()
    expect(screen.getByText('overview.viewAllLinks').closest('button')?.getAttribute('data-to')).toBe('/link')
    expect(screen.getByText('overview.viewAnalytics').closest('button')?.getAttribute('data-to')).toBe('/analytics')
    expect(screen.getByText('links.actions.analytics').closest('button')?.getAttribute('data-to')).toBe('/analytics?shortLinkId=link-id')
    expect(getShortLinkOverview).toHaveBeenCalledTimes(1)
    expect(listShortLinks).toHaveBeenCalledWith({ page: 1, pageSize: 5 })
  })

  it('keeps an invalid recent-link creation timestamp visible', () => {
    setQueryResults(
      { data: ref({ totalLinkCount: 1, activeLinkCount: 1, visitCount: 0, todayVisitCount: 0 }) },
      {
        data: ref({
          items: [{
            id: 'invalid-date-link',
            url: 'https://go.example.com/invalid',
            slug: 'invalid',
            targetUrl: 'https://example.com/invalid',
            status: 'active' as const,
            ...defaultShortLinkAccessConfig,
            createdAt: 'invalid-date',
          }],
          meta: { page: 1, pageSize: 5, total: 1 },
        }),
      },
    )

    mount(ConsoleOverviewPage)

    expect(screen.getByText('invalid-date')).toBeTruthy()
  })

  it('renders shared loading indicators for overview metrics and recent links', () => {
    setQueryResults(
      { isPending: ref(true) },
      { isPending: ref(true) },
    )

    mount(ConsoleOverviewPage)

    expect(screen.getByTestId('overview-metrics-loading')).toBeTruthy()
    expect(screen.getByTestId('overview-recent-loading')).toBeTruthy()
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)
    expect(screen.queryByTestId('overview-empty')).toBeNull()
  })

  it('keeps successful overview regions visible and retries each failed query independently', async () => {
    const retryOverview = vi.fn()
    setQueryResults(
      { isError: ref(true), refetch: retryOverview },
      {
        data: ref({
          items: [{ id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' as const, ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z' }],
          meta: { page: 1, pageSize: 5, total: 1 },
        }),
      },
    )

    const firstRender = mount(ConsoleOverviewPage)
    expect(screen.getByTestId('overview-metrics-error')).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'overview.retryMetrics' }))
    expect(retryOverview).toHaveBeenCalledTimes(1)
    firstRender.unmount()

    state.queryResultIndex = 0
    const retryRecent = vi.fn()
    setQueryResults(
      { data: ref({ totalLinkCount: 12, activeLinkCount: 9, visitCount: 840, todayVisitCount: 31 }) },
      { isError: ref(true), refetch: retryRecent },
    )
    mount(ConsoleOverviewPage)
    expect(screen.getByText('840')).toBeTruthy()
    expect(screen.getByTestId('overview-recent-error')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'overview.retryRecent' }))
    expect(retryRecent).toHaveBeenCalledTimes(1)
  })

  it('renders zero-value fallbacks and existing create-entry guidance when no links exist', () => {
    setQueryResults(
      { data: ref(undefined) },
      { data: ref(undefined) },
    )

    mount(ConsoleOverviewPage)

    expect(within(screen.getByLabelText('overview.metricsLabel')).getAllByText('0')).toHaveLength(4)
    expect(screen.getByTestId('overview-empty')).toBeTruthy()
    expect(screen.getByText('overview.emptyDescription')).toBeTruthy()
    expect(screen.getByText('overview.createFromHome').closest('button')?.getAttribute('data-to')).toBe('/')
    expect(screen.queryByTestId('short-link-create-panel')).toBeNull()
  })

  it('renders analytics data, chart, and dimension summaries for a selected link', async () => {
    state.routeQuery = { shortLinkId: 'link-id' }
    const analytics = ref<undefined | {
      shortLink: { id: string; url: string; slug: string; targetUrl: string; status: 'active'; redirectMode: 'direct'; intermediateDelaySeconds: number; expiresAt: null; expired: false; passwordEnabled: boolean; createdAt: string }
      stats: { visitCount: number; todayVisitCount: number; lastVisitedAt: string; trend: Array<{ date: string; visitCount: number }>; referrers: Array<{ value: string; visitCount: number }>; devices: Array<{ value: string; visitCount: number }>; countries: Array<{ value: string; visitCount: number }> }
    }>(undefined)
    setQueryResult({ data: analytics })
    vi.mocked(me).mockResolvedValue({ user: { permissions: [] } } as never)
    vi.mocked(getShortLinkStatistics).mockResolvedValue({
      shortLink: { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-07-01T00:00:00Z' },
      stats: { visitCount: 5, todayVisitCount: 2, lastVisitedAt: '2026-07-17T00:00:00Z', trend: [{ date: '2026-07-17', visitCount: 2 }], referrers: [{ value: 'search.example', visitCount: 3 }], devices: [{ value: 'mobile', visitCount: 4 }], countries: [{ value: 'unknown', visitCount: 1 }] },
    })

    mount(AnalyticsPage)
    await state.queryFns[0]?.()
    analytics.value = {
      shortLink: { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-07-01T00:00:00Z' },
      stats: {
        visitCount: 5,
        todayVisitCount: 2,
        lastVisitedAt: '2026-07-17T00:00:00Z',
        trend: [{ date: '2026-07-17', visitCount: 2 }],
        referrers: [{ value: 'search.example', visitCount: 3 }],
        devices: [{ value: 'mobile', visitCount: 4 }],
        countries: [{ value: 'unknown', visitCount: 1 }],
      },
    }
    await nextTick()
    await nextTick()
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0))

    expect(await screen.findByTestId('analytics-trend-chart')).toBeTruthy()
    expect(screen.getByTestId('analytics-summary')).toBeTruthy()
    expect(screen.getByText('search.example')).toBeTruthy()
    expect(screen.getByText('analytics.unknown')).toBeTruthy()
    expect(state.queryFns).toHaveLength(1)
    expect(state.chartConfigurations).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        datasets: [expect.objectContaining({ borderColor: '#315f8c', backgroundColor: '#315f8c' })],
      }),
    }))

    state.theme.global.current.value = { colors: { primary: '#8ab8e8' } }
    await nextTick()
    await nextTick()
    expect(state.chartConfigurations).toContainEqual(expect.objectContaining({
      data: expect.objectContaining({
        datasets: [expect.objectContaining({ borderColor: '#8ab8e8', backgroundColor: '#8ab8e8' })],
      }),
    }))

    analytics.value.stats.lastVisitedAt = null as never
    await nextTick()
    expect(screen.getByText('links.stats.neverVisited')).toBeTruthy()

    analytics.value = undefined
    await nextTick()
    expect(screen.queryByTestId('analytics-summary')).toBeNull()
  })

  it('uses the administrator analytics request for an administrator', async () => {
    state.routeQuery = { shortLinkId: 'link-id' }
    setQueryResult({})
    vi.mocked(me).mockResolvedValue({ user: { permissions: ['admin:access'] } } as never)
    vi.mocked(getAdminShortLinkStatistics).mockResolvedValue({} as never)

    mount(AnalyticsPage)
    await state.queryFns[0]?.()

    expect(getAdminShortLinkStatistics).toHaveBeenCalledWith('link-id')
  })

  it('renders selected-link, loading, and error analytics states', () => {
    mount(AnalyticsPage)
    expect(screen.getByText('analytics.selectLink')).toBeTruthy()
    expect(state.queryFns).toHaveLength(0)
    expect(me).not.toHaveBeenCalled()

    state.routeQuery = { shortLinkId: 'link-id' }
    setQueryResult({ isPending: ref(true) })
    mount(AnalyticsPage)
    expect(screen.getByRole('progressbar')).toBeTruthy()

    setQueryResult({ isError: ref(true) })
    mount(AnalyticsPage)
    expect(screen.getByText('analytics.loadFailed')).toBeTruthy()
  })

  it('renders empty analytics dimensions and normalizes other labels', () => {
    state.routeQuery = { shortLinkId: 'link-id' }
    setQueryResult({
      data: ref({
        shortLink: { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z' },
        stats: {
          visitCount: 1,
          todayVisitCount: 0,
          lastVisitedAt: 'not-a-date',
          trend: [],
          referrers: [],
          devices: [{ value: 'other', visitCount: 1 }],
          countries: [],
        },
      }),
    })

    mount(AnalyticsPage)

    expect(screen.getAllByText('analytics.emptyDimension')).toHaveLength(2)
    expect(screen.getByText('analytics.other')).toBeTruthy()
    expect(screen.getByText('links.stats.neverVisited')).toBeTruthy()
  })

  it('submits login credentials, maps invalid credentials, and follows redirect query after success', async () => {
    const mutate = vi.fn()
    state.routeQuery = { redirect: '/admin/user' }
    setMutationResult({
      error: ref({ code: 110101, message: 'Invalid username or password' }),
      isError: ref(true),
      mutate,
    })
    const invalid = mount(LoginPage)

    expect(screen.getByTestId('auth-page-login')).toBeTruthy()
    expect(screen.getByTestId('auth-panel')).toBeTruthy()
    expect(screen.queryByText('auth.privateConsole')).toBeNull()
    await fireEvent.update(screen.getByLabelText('auth.username'), 'alice')
    await fireEvent.update(screen.getByLabelText('auth.password'), 'secret')
    await fireEvent.click(screen.getByText('auth.loginSubmit'))

    expect(screen.getByTestId('auth-error-toast')).toBeTruthy()
    expect(screen.getByText('auth.loginFailed')).toBeTruthy()
    expect(screen.queryByText('Invalid username or password')).toBeNull()
    expect(mutate).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
    expect(state.queryClient.setQueryData).not.toHaveBeenCalled()
    expect(state.routerPush).not.toHaveBeenCalled()

    invalid.unmount()
    setMutationResult()
    mount(LoginPage)
    await fireEvent.update(screen.getByLabelText('auth.username'), 'alice')
    await fireEvent.update(screen.getByLabelText('auth.password'), 'secret')
    await fireEvent.click(screen.getByText('auth.loginSubmit'))

    expect(login).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
    expect(state.queryClient.setQueryData).toHaveBeenCalledWith(
      ['auth', 'me'],
      expect.objectContaining({ user: expect.objectContaining({ username: 'alice' }) }),
    )
    expect(state.routerPush).toHaveBeenCalledWith('/admin/user')
  })

  it('lets users dismiss the login error toast without clearing form state', async () => {
    setMutationResult({
      error: ref({ code: 110101, message: 'Invalid username or password' }),
      isError: ref(true),
      mutate: vi.fn(),
    })
    mount(LoginPage)

    expect(screen.getByTestId('auth-error-toast')).toBeTruthy()

    expect(screen.getByRole('button', { name: 'auth.dismissError' })).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'auth.dismissError' }))

    expect(screen.queryByTestId('auth-error-toast')).toBeNull()
  })

  it('keeps login business error codes named', () => {
    const source = readFileSync('src/pages/LoginPage.vue', 'utf8')

    expect(source).toContain('INVALID_CREDENTIAL_ERROR_CODE')
    expect(source).not.toContain('=== 110101')
  })

  it('shows non-auth login errors and ignores unsafe redirect targets', async () => {
    const mutate = vi.fn()
    state.routeQuery = { redirect: 'https://evil.example' }
    setMutationResult({
      error: ref(new Error('network unavailable')),
      isError: ref(true),
      mutate,
    })
    const failed = mount(LoginPage)

    await fireEvent.update(screen.getByLabelText('auth.username'), 'alice')
    await fireEvent.update(screen.getByLabelText('auth.password'), 'secret')
    await fireEvent.click(screen.getByText('auth.loginSubmit'))

    expect(screen.getByText('network unavailable')).toBeTruthy()
    expect(mutate).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
    expect(state.routerPush).not.toHaveBeenCalled()

    failed.unmount()
    state.routerPush.mockReset()
    setMutationResult()
    state.routeQuery = { redirect: '//evil.example' }
    mount(LoginPage)
    await fireEvent.update(screen.getByLabelText('auth.username'), 'alice')
    await fireEvent.update(screen.getByLabelText('auth.password'), 'secret')
    await fireEvent.click(screen.getByText('auth.loginSubmit'))
    expect(state.routerPush).toHaveBeenCalledWith('/')
  })

  it('renders setup loading, initialized, and submit states', async () => {
    setQueryResult({ isLoading: ref(true) })
    const loading = mount(SetupPage)
    expect(screen.getByTestId('auth-page-setup')).toBeTruthy()
    expect(screen.getByText('setup.loading')).toBeTruthy()
    loading.unmount()

    setQueryResult({ data: ref({ initialized: true }) })
    const initialized = mount(SetupPage)
    expect(screen.getByText('setup.initialized')).toBeTruthy()
    expect(screen.getByTestId('setup-completion')).toBeTruthy()
    initialized.unmount()

    const mutate = vi.fn()
    setQueryResult({ data: ref({ initialized: false }) })
    setMutationResult({
      error: ref(new Error('setup failed')),
      isError: ref(true),
      mutate,
    })
    mount(SetupPage)

    expect(screen.getByTestId('auth-panel')).toBeTruthy()
    expect(screen.getByTestId('setup-wizard')).toBeTruthy()
    expect(screen.queryByText('setup.eyebrow')).toBeNull()
    expect(screen.getAllByTestId('setup-step-card')).toHaveLength(3)
    for (const testId of [
      'setup-admin-username',
      'setup-admin-password',
      'setup-admin-nickname',
      'setup-site-name',
      'setup-system-domain',
      'setup-short-link-domain',
      'setup-submit',
    ]) {
      expect(screen.getByTestId(testId)).toBeTruthy()
    }
    expect(screen.getByText('setup.steps.admin')).toBeTruthy()
    expect(screen.getByText('setup.steps.domain')).toBeTruthy()
    expect(screen.getByText('setup.steps.preference')).toBeTruthy()
    expect(screen.getByText('setup failed')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('setup.adminUsername'), 'admin')
    await fireEvent.update(screen.getByLabelText('setup.adminPassword'), 'password123')
    await fireEvent.update(screen.getByLabelText('setup.adminNickname'), 'Admin')
    await fireEvent.update(screen.getByLabelText('setup.siteName'), 'MoeURL Test')
    await fireEvent.update(screen.getByLabelText('setup.systemDomain'), 'example.com')
    await fireEvent.update(screen.getByLabelText('setup.shortLinkDomain'), 'go.example.com')
    await fireEvent.update(screen.getByLabelText('setup.defaultLanguage'), 'en')
    await fireEvent.update(screen.getByLabelText('setup.defaultTheme'), 'dark')
    await fireEvent.click(screen.getByText('setup.submit'))

    expect(screen.queryByText('setup.initialized')).toBeNull()
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ adminUsername: 'admin', defaultLanguage: 'en', defaultTheme: 'dark' }))
  })

  it('uses primary color semantics for setup step indexes', () => {
    const source = readFileSync('src/pages/SetupPage.vue', 'utf8')
    const stepIndexBlock = source.match(/\.setup-wizard__step-index\s*{[^}]+}/)?.[0] ?? ''

    expect(stepIndexBlock).toContain('rgb(var(--v-theme-primary))')
    expect(stepIndexBlock).not.toContain('rgb(var(--v-theme-secondary))')
  })

  it('blocks guest creation and creates short links for authorized users', async () => {
    const guestMutate = vi.fn()
    setQueryResult({ data: ref({ user: { username: 'guest', nickname: 'Guest', group: 'guest', permissions: [] } }) })
    setMutationResult({ mutate: guestMutate })
    const guest = mount(HomePage)

    expect(screen.getByTestId('home-hero-panel')).toBeTruthy()
    expect(screen.getByText('nav.login')).toBeTruthy()
    expect(screen.getByText('home.heroTitle')).toBeTruthy()
    expect(screen.getByText('homeIntro.permission.title')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.permissionRequired')).toBeTruthy()
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    expect(guestMutate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('short-link-create-result')).toBeNull()
    guest.unmount()

    const mutate = vi.fn()
    setQueryResult({ data: ref({ user: { username: 'alice', nickname: 'Alice', group: 'user', permissions: ['short_link:create', 'domain:use_default'] } }) })
    setMutationResult({
      data: ref(undefined),
      error: ref(new Error('invalid target')),
      isPending: ref(false),
      mutate,
    })
    mount(HomePage)

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(screen.getByText('invalid target')).toBeTruthy()
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
  })

  it('shows fallback create error message', () => {
    setQueryResult({ data: ref({ user: { username: 'alice', nickname: 'Alice', group: 'user', permissions: ['short_link:create', 'domain:use_default'] } }) })
    setMutationResult({
      data: ref(undefined),
      error: ref({}),
      mutate: vi.fn(),
    })
    mount(HomePage)

    expect(screen.getByText('shortLinkCreate.failed')).toBeTruthy()
  })

  it('shows created short link actions', async () => {
    setQueryResult({ data: ref({ user: { username: 'alice', nickname: 'Alice', group: 'user', permissions: ['short_link:create', 'domain:use_default'] } }) })
    setMutationResult()
    mount(HomePage)

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(await screen.findByText('https://go.example.com/abc123')).toBeTruthy()
    await fireEvent.click(screen.getByText('shortLinkCreate.qrCode'))
    expect(within(screen.getByTestId('short-link-qr-dialog-stub')).getByText('abc123')).toBeTruthy()
    await fireEvent.click(screen.getByLabelText('short-link-qr-close'))
    await fireEvent.click(screen.getByText('shortLinkCreate.copy'))
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')
    await fireEvent.click(screen.getByText('shortLinkCreate.reset'))
  })

  it('renders home as guest when current user is missing', () => {
    setQueryResult({ data: ref({}) })
    mount(HomePage)

    expect(screen.getByText('nav.login')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.permissionRequired')).toBeTruthy()
  })

  it('routes authenticated users from home account entry to profile', async () => {
    setQueryResult({
      data: ref({
        user: {
          username: 'alice',
          nickname: 'Alice',
          group: 'user',
          permissions: ['short_link:create', 'domain:use_default'],
        },
      }),
    })
    mount(HomePage)

    await fireEvent.click(screen.getByText('Alice'))

    expect(state.routerPush).toHaveBeenCalledWith('/profile')
  })

  it('renders own links states and row actions', async () => {
    setQueryResult({ isError: ref(true) })
    const error = mount(MyLinksPage)
    expect(screen.getByText('links.loadFailed')).toBeTruthy()
    error.unmount()

    setQueryResult({ isPending: ref(true) })
    const pending = mount(MyLinksPage)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    pending.unmount()

    setQueryResult({ data: ref({ items: [] }) })
    const empty = mount(MyLinksPage)
    expect(screen.getByText('links.emptyTitle')).toBeTruthy()
    expect(screen.getByText('links.emptyOwnDescription')).toBeTruthy()
    expect(empty.container.querySelector('.console-page__empty')).toBeTruthy()
    expect(empty.container.querySelector('.console-page__empty-mark')).toBeNull()
    empty.unmount()

    setQueryResult({ data: ref(undefined) })
    const missingData = mount(MyLinksPage)
    expect(screen.getByText('links.emptyTitle')).toBeTruthy()
    missingData.unmount()

    const update = vi.fn()
    setMutationResult({ mutate: update })
    setQueryResult({
      data: ref({
        items: [
          {
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            redirectMode: 'intermediate',
            intermediateDelaySeconds: 7,
            expiresAt: '2026-08-10T00:00:00Z',
            expired: false,
            stats: { visitCount: 2, todayVisitCount: 1, lastVisitedAt: '2026-07-16T05:00:00Z' },
          },
          {
            id: 'link-disabled',
            url: 'https://go.example.com/def456',
            slug: 'def456',
            targetUrl: 'https://example.org',
            status: 'disabled',
            ...defaultShortLinkAccessConfig,
            redirectMode: 'direct',
            intermediateDelaySeconds: 5,
            expiresAt: '2026-07-01T00:00:00Z',
            expired: true,
            stats: { visitCount: 0, todayVisitCount: 0, lastVisitedAt: 'invalid-date' },
          },
          {
            id: 'link-confirmation',
            url: 'https://go.example.com/confirm1',
            slug: 'confirm1',
            targetUrl: 'https://example.net/confirm',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            redirectMode: 'confirmation',
            intermediateDelaySeconds: 5,
            expiresAt: null,
            expired: false,
            stats: { visitCount: 0, todayVisitCount: 0, lastVisitedAt: null },
          },
        ],
      }),
    })
    mount(MyLinksPage)

    expect(screen.getByTestId('console-page-links')).toBeTruthy()
    expect(screen.queryByText('pageMeta.linksEyebrow')).toBeNull()
    expect(screen.getByTestId('console-data-panel')).toBeTruthy()
    expect(screen.getByTestId('console-page-toolbar')).toBeTruthy()
    expect(screen.getByTestId('console-link-list')).toBeTruthy()
    const rows = screen.getAllByTestId('console-link-row')
    const activeRow = rows.find((row) => within(row).queryByText('https://go.example.com/abc123'))
    const disabledRow = rows.find((row) => within(row).queryByText('https://go.example.com/def456'))
    if (!activeRow || !disabledRow) {
      throw new Error('expected short link rows')
    }
    expect(within(activeRow).getByText('links.stats.visitCount')).toBeTruthy()
    expect(within(activeRow).getByText('2')).toBeTruthy()
    expect(within(activeRow).getByText('links.stats.todayVisitCount')).toBeTruthy()
    expect(within(activeRow).getByText('1')).toBeTruthy()
    expect(within(activeRow).getByText('links.stats.lastVisitedAt')).toBeTruthy()
    expect(within(disabledRow).getByText('links.stats.neverVisited')).toBeTruthy()
    expect(within(activeRow).getByText('shortLinkCreate.redirectModes.intermediate')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.redirectModes.confirmation')).toBeTruthy()
    const expiration = new Date('2026-08-10T00:00:00Z')
    const expirationText = `${expiration.getFullYear()}-${String(expiration.getMonth() + 1).padStart(2, '0')}-${String(expiration.getDate()).padStart(2, '0')} ${String(expiration.getHours()).padStart(2, '0')}:${String(expiration.getMinutes()).padStart(2, '0')}`
    expect(within(activeRow).getByText(expirationText)).toBeTruthy()
    expect(within(disabledRow).getByText('links.expired')).toBeTruthy()

    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(activeRow).getByRole('button', { name: 'links.actions.more' }).getAttribute('aria-haspopup')).toBe('menu')
    expect(within(activeRow).getByRole('button', { name: 'links.actions.more' }).getAttribute('aria-expanded')).toBe('true')
    expect(within(activeRow).getAllByRole('menuitem')).toHaveLength(4)
    await fireEvent.click(within(activeRow).getByRole('menuitem', { name: 'links.actions.qrCode' }))
    expect(screen.getByTestId('short-link-qr-dialog-stub').textContent).toContain('https://go.example.com/abc123')
    await fireEvent.click(screen.getByLabelText('short-link-qr-close'))
    expect(screen.queryByTestId('short-link-qr-dialog-stub')).toBeNull()
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(activeRow).getByRole('menuitem', { name: 'links.actions.disable' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(activeRow).getByRole('button', { name: 'links.actions.more' }).getAttribute('aria-expanded')).toBe('false')
    await fireEvent.click(within(disabledRow).getByRole('menuitem', { name: 'links.actions.enable' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.copy' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(activeRow).getByRole('menuitem', { name: 'links.actions.delete' }))
    expect(screen.getByLabelText('filter.status')).toBeTruthy()
    expect(listShortLinks).toHaveBeenCalledWith({ status: '' })
    expect(update).toHaveBeenCalledWith({ id: 'link-id', status: 'disabled' })
    expect(update).toHaveBeenCalledWith({ id: 'link-disabled', status: 'active' })
    expect(update).toHaveBeenCalledWith('link-id')
    expect(updateShortLink).not.toHaveBeenCalled()
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')
  })

  it('updates own link settings through the personal endpoint and invalidates the personal list', async () => {
    const update = createDeferred<unknown>()
    vi.mocked(updateShortLink).mockReturnValueOnce(update.promise as never)
    setQueryResults(
      {
        data: ref({
          items: [{
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com/original',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            redirectMode: 'direct',
            intermediateDelaySeconds: 5,
            expiresAt: '2026-08-10T00:00:00Z',
            expired: false,
            createdAt: '2026-08-01T00:00:00Z',
          }],
        }),
      },
      {
        data: ref({ user: { permissions: ['short_link:use_intermediate', 'short_link:set_expiration'] } }),
      },
    )
    const view = mount(MyLinksPage)
    const row = screen.getByTestId('console-link-row')

    await fireEvent.click(within(row).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(row).getByRole('menuitem', { name: 'links.actions.configure' }))
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/updated')
    await fireEvent.click(screen.getByLabelText('shortLinkSettings.expirationEnabled'))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(updateShortLink).toHaveBeenCalledWith({
      id: 'link-id',
      targetUrl: 'https://example.com/updated',
      redirectMode: 'direct',
      expiration: { mode: 'never' },
    })
    expect((screen.getByRole('button', { name: 'shortLinkSettings.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('shortLinkSettings.title')).toBeTruthy()
    expect(state.queryClient.invalidateQueries).not.toHaveBeenCalled()

    update.resolve({ shortLink: { id: 'link-id' } })
    await vi.waitFor(() => {
      expect(state.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['short-link'] })
      expect(screen.queryByText('shortLinkSettings.title')).toBeNull()
    })
    view.unmount()
  })

  it('renders password protection state and invalidates personal links after a successful status update', async () => {
    setQueryResult({
      data: ref({
        items: [
          {
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            passwordEnabled: true,
            createdAt: '2026-08-01T00:00:00Z',
          },
          {
            id: 'link-unprotected',
            url: 'https://go.example.com/public',
            slug: 'public',
            targetUrl: 'https://example.com/public',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            createdAt: '2026-08-01T00:00:00Z',
          },
        ],
      }),
    })
    mount(MyLinksPage)

    const [protectedRow, unprotectedRow] = screen.getAllByTestId('console-link-row')
    expect(within(protectedRow!).getByText('links.passwordProtected')).toBeTruthy()
    expect(within(unprotectedRow!).queryByText('links.passwordProtected')).toBeNull()
    await fireEvent.click(within(protectedRow!).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(protectedRow!).getByRole('menuitem', { name: 'links.actions.disable' }))

    expect(updateShortLink).toHaveBeenCalledWith({ id: 'link-id', status: 'disabled' })
    expect(state.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['short-link'] })
  })

  it('keeps personal settings errors in the dialog and closes them from cancel', async () => {
    const update = createDeferred<unknown>()
    const retry = createDeferred<unknown>()
    vi.mocked(updateShortLink)
      .mockReturnValueOnce(update.promise as never)
      .mockReturnValueOnce(retry.promise as never)
    setQueryResults(
      {
        data: ref({
          items: [{
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com/original',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            createdAt: '2026-08-01T00:00:00Z',
          }],
        }),
      },
      {
        data: ref({ user: { permissions: ['short_link:use_intermediate', 'short_link:set_expiration'] } }),
      },
    )
    mount(MyLinksPage)
    const row = screen.getByTestId('console-link-row')

    await fireEvent.click(within(row).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(row).getByRole('menuitem', { name: 'links.actions.configure' }))
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/failed')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    update.reject(new Error('personal settings failed'))
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('personal settings failed')
      expect(screen.getByText('shortLinkSettings.title')).toBeTruthy()
      expect(state.queryClient.invalidateQueries).not.toHaveBeenCalled()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    retry.reject({ code: 200103 })
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('links.settingsSaveFailed')
      expect(screen.getByText('shortLinkSettings.title')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.cancel' }))
    expect(screen.queryByText('shortLinkSettings.title')).toBeNull()
  })

  it('scopes own link updating state to the active row', async () => {
    setQueryResult({
      data: ref({
        items: [
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z' },
          { id: 'link-other', url: 'https://go.example.com/def456', slug: 'def456', targetUrl: 'https://example.org', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z' },
        ],
      }),
    })
    setMutationResult({
      isPending: ref(true),
      variables: ref({ id: 'link-id', status: 'disabled' }),
    })
    mount(MyLinksPage)

    const rows = screen.getAllByTestId('console-link-row')
    const activeRow = rows.find((row) => within(row).queryByText('https://go.example.com/abc123'))
    const otherRow = rows.find((row) => within(row).queryByText('https://go.example.com/def456'))
    if (!activeRow || !otherRow) {
      throw new Error('expected short link rows')
    }

    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(activeRow).getByRole('menuitem', { name: 'links.actions.disable' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(within(otherRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(otherRow).getByRole('menuitem', { name: 'links.actions.disable' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('scopes own link deleting state to the active row', async () => {
    setQueryResult({
      data: ref({
        items: [
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z' },
          { id: 'link-other', url: 'https://go.example.com/def456', slug: 'def456', targetUrl: 'https://example.org', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z' },
        ],
      }),
    })
    setMutationResult({
      isPending: ref(true),
      variables: ref('link-id'),
    })
    mount(MyLinksPage)

    const rows = screen.getAllByTestId('console-link-row')
    const activeRow = rows.find((row) => within(row).queryByText('https://go.example.com/abc123'))
    const otherRow = rows.find((row) => within(row).queryByText('https://go.example.com/def456'))
    if (!activeRow || !otherRow) {
      throw new Error('expected short link rows')
    }

    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(activeRow).getByRole('menuitem', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(within(otherRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(otherRow).getByRole('menuitem', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('toggles link and user action panels closed on repeated clicks', async () => {
    setMutationResult({ mutate: vi.fn() })
    setQueryResult({
      data: ref({
        items: [{ id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z' }],
      }),
    })
    const links = mount(MyLinksPage)
    const linkRow = screen.getByTestId('console-link-row')
    await fireEvent.click(within(linkRow).getByRole('button', { name: 'links.actions.more' }))
    const deleteButton = within(linkRow).getByRole('menuitem', { name: 'links.actions.delete' })
    expect(deleteButton).toBeTruthy()
    await fireEvent.pointerDown(deleteButton)
    expect(within(linkRow).getByRole('menuitem', { name: 'links.actions.delete' })).toBeTruthy()
    await fireEvent.keyDown(document, { key: 'Enter' })
    expect(within(linkRow).getByRole('menuitem', { name: 'links.actions.delete' })).toBeTruthy()
    await fireEvent.pointerDown(document.body)
    expect(within(linkRow).queryByRole('menuitem', { name: 'links.actions.delete' })).toBeNull()
    await fireEvent.click(within(linkRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(within(linkRow).queryByRole('menuitem', { name: 'links.actions.delete' })).toBeNull()
    await fireEvent.click(within(linkRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(linkRow).getByRole('menuitem', { name: 'links.actions.delete' })).toBeTruthy()
    await fireEvent.click(within(linkRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(linkRow).queryByRole('menuitem', { name: 'links.actions.delete' })).toBeNull()
    links.unmount()

    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [
          {
            id: 'user-id',
            username: 'alice',
            nickname: 'Alice',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
        ],
      }),
    })
    mount(AdminUsersPage)
    const editButton = screen.getByRole('button', { name: 'adminUsers.actions.edit' })
    const moreButton = screen.getByRole('button', { name: 'adminUsers.actions.more' })
    expect(editButton.getAttribute('aria-haspopup')).toBeNull()
    expect(editButton.getAttribute('aria-expanded')).toBe('false')
    expect(moreButton.getAttribute('aria-haspopup')).toBeNull()
    expect(moreButton.getAttribute('aria-expanded')).toBe('false')
    await fireEvent.click(editButton)
    expect(editButton.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(editButton.getAttribute('aria-controls') ?? '')).toBeTruthy()
    expect(moreButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByTestId('console-user-edit-panel')).toBeTruthy()
    await fireEvent.click(editButton)
    expect(editButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('console-user-edit-panel')).toBeNull()
    await fireEvent.click(editButton)
    await fireEvent.click(moreButton)
    expect(editButton.getAttribute('aria-expanded')).toBe('false')
    expect(moreButton.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(moreButton.getAttribute('aria-controls') ?? '')).toBeTruthy()
    expect(screen.queryByTestId('console-user-edit-panel')).toBeNull()
    expect(screen.getByTestId('console-user-actions')).toBeTruthy()
    await fireEvent.click(moreButton)
    expect(moreButton.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('console-user-actions')).toBeNull()
  })

  it('queries own links with status filter state', async () => {
    setQueryResult({ data: ref({ items: [] }) })
    mount(MyLinksPage)

    await fireEvent.update(screen.getByLabelText('filter.status'), 'disabled')
    const queryKey = state.queryKeys[0]
    state.queryFns[0]?.()

    expect(isRef(queryKey) ? queryKey.value : queryKey).toEqual(['short-link', 'disabled'])
    expect(listShortLinks).toHaveBeenCalledWith({ status: 'disabled' })
  })

  it('renders admin links states and row actions', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [
          {
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com',
            status: 'disabled',
            ...defaultShortLinkAccessConfig,
            redirectMode: 'direct',
            intermediateDelaySeconds: 5,
            expiresAt: 'invalid-date',
            expired: false,
            owner: { id: 'owner-id', username: 'alice', nickname: '' },
          },
          {
            id: 'link-active',
            url: 'https://go.example.com/active',
            slug: 'active',
            targetUrl: 'https://example.net',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            redirectMode: 'intermediate',
            intermediateDelaySeconds: 6,
            expiresAt: '2026-08-12T00:00:00Z',
            expired: false,
            owner: { id: 'owner-2', username: 'bob', nickname: 'Bobby' },
          },
        ],
      }),
    })
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mount(AdminLinksPage)

    expect(screen.getByTestId('console-page-admin-links')).toBeTruthy()
    expect(screen.queryByText('pageMeta.adminEyebrow')).toBeNull()
    expect(screen.getByTestId('console-data-panel')).toBeTruthy()
    expect(screen.getByTestId('console-link-list')).toBeTruthy()
    expect(screen.getByText('adminLinks.total')).toBeTruthy()
    expect(screen.getAllByText('owner-id').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Bobby').length).toBeGreaterThan(0)
    const rows = screen.getAllByTestId('console-link-row')
    const disabledRow = rows.find((row) => within(row).queryByText('https://go.example.com/abc123'))
    const activeRow = rows.find((row) => within(row).queryByText('https://go.example.com/active'))
    if (!disabledRow || !activeRow) {
      throw new Error('expected admin short link rows')
    }
    expect(within(disabledRow).getByText('links.neverExpires')).toBeTruthy()

    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(disabledRow).getAllByRole('menuitem')).toHaveLength(4)
    await fireEvent.click(within(disabledRow).getByRole('menuitem', { name: 'links.actions.qrCode' }))
    expect(screen.getByTestId('short-link-qr-dialog-stub').textContent).toContain('https://go.example.com/abc123')
    await fireEvent.click(screen.getByLabelText('short-link-qr-close'))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(disabledRow).getByRole('menuitem', { name: 'links.actions.enable' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(activeRow).getByRole('menuitem', { name: 'links.actions.disable' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.copy' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(disabledRow).getByRole('menuitem', { name: 'links.actions.delete' }))
    expect(screen.getByLabelText('filter.status')).toBeTruthy()
    expect(screen.getByLabelText('filter.keyword')).toBeTruthy()
    expect(listAdminShortLinks).toHaveBeenCalledWith({ status: '', q: '' })
    expect(mutate).toHaveBeenCalledWith({ id: 'link-id', status: 'active' })
    expect(mutate).toHaveBeenCalledWith({ id: 'link-active', status: 'disabled' })
    expect(mutate).toHaveBeenCalledWith('link-id')
  })

  it('updates admin link settings through the administrator endpoint and invalidates the admin list', async () => {
    const update = createDeferred<unknown>()
    vi.mocked(updateAdminShortLink).mockReturnValueOnce(update.promise as never)
    setQueryResults(
      {
        data: ref({
          meta: { total: 1 },
          items: [{
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com/original',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            redirectMode: 'direct',
            intermediateDelaySeconds: 5,
            expiresAt: null,
            expired: false,
            createdAt: '2026-08-01T00:00:00Z',
            owner: { id: 'owner-id', username: 'alice', nickname: '' },
          }],
        }),
      },
      {
        data: ref({ user: { permissions: ['short_link:use_intermediate', 'short_link:set_expiration'] } }),
      },
    )
    const view = mount(AdminLinksPage)
    const row = screen.getByTestId('console-link-row')

    await fireEvent.click(within(row).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(row).getByRole('menuitem', { name: 'links.actions.configure' }))
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/admin-updated')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    expect(updateAdminShortLink).toHaveBeenCalledWith({
      id: 'link-id',
      targetUrl: 'https://example.com/admin-updated',
      redirectMode: 'direct',
      expiration: { mode: 'never' },
    })
    expect((screen.getByRole('button', { name: 'shortLinkSettings.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('shortLinkSettings.title')).toBeTruthy()
    expect(state.queryClient.invalidateQueries).not.toHaveBeenCalled()

    update.resolve({ shortLink: { id: 'link-id' } })
    await vi.waitFor(() => {
      expect(state.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-short-link'] })
      expect(screen.queryByText('shortLinkSettings.title')).toBeNull()
    })
    view.unmount()
  })

  it('invalidates admin links after a successful status update', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [{
          id: 'link-id',
          url: 'https://go.example.com/abc123',
          slug: 'abc123',
          targetUrl: 'https://example.com',
          status: 'active',
          ...defaultShortLinkAccessConfig,
          createdAt: '2026-08-01T00:00:00Z',
          owner: { id: 'owner-id', username: 'alice', nickname: '' },
        }],
      }),
    })
    mount(AdminLinksPage)

    const row = screen.getByTestId('console-link-row')
    await fireEvent.click(within(row).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(row).getByRole('menuitem', { name: 'links.actions.disable' }))

    expect(updateAdminShortLink).toHaveBeenCalledWith({ id: 'link-id', status: 'disabled' })
    expect(state.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-short-link'] })
  })

  it('keeps administrator settings errors in the dialog and closes them from cancel', async () => {
    const update = createDeferred<unknown>()
    const retry = createDeferred<unknown>()
    vi.mocked(updateAdminShortLink)
      .mockReturnValueOnce(update.promise as never)
      .mockReturnValueOnce(retry.promise as never)
    setQueryResults(
      {
        data: ref({
          meta: { total: 1 },
          items: [{
            id: 'link-id',
            url: 'https://go.example.com/abc123',
            slug: 'abc123',
            targetUrl: 'https://example.com/original',
            status: 'active',
            ...defaultShortLinkAccessConfig,
            createdAt: '2026-08-01T00:00:00Z',
            owner: { id: 'owner-id', username: 'alice', nickname: '' },
          }],
        }),
      },
      {
        data: ref({ user: { permissions: ['short_link:use_intermediate', 'short_link:set_expiration'] } }),
      },
    )
    mount(AdminLinksPage)
    const row = screen.getByTestId('console-link-row')

    await fireEvent.click(within(row).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(row).getByRole('menuitem', { name: 'links.actions.configure' }))
    await fireEvent.update(screen.getByLabelText('shortLinkSettings.targetUrl'), 'https://example.com/failed')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))

    update.reject({ code: 200103 })
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('links.settingsSaveFailed')
      expect(screen.getByText('shortLinkSettings.title')).toBeTruthy()
      expect(state.queryClient.invalidateQueries).not.toHaveBeenCalled()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    retry.reject(new Error('administrator settings failed'))
    await vi.waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('administrator settings failed')
      expect(screen.getByText('shortLinkSettings.title')).toBeTruthy()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.cancel' }))
    expect(screen.queryByText('shortLinkSettings.title')).toBeNull()
  })

  it('scopes admin link deleting state to the active row', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 2 },
        items: [
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z', owner: { id: 'owner-id', username: 'alice', nickname: '' } },
          { id: 'link-other', url: 'https://go.example.com/def456', slug: 'def456', targetUrl: 'https://example.org', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z', owner: { id: 'owner-2', username: 'bob', nickname: '' } },
        ],
      }),
    })
    setMutationResult({
      isPending: ref(true),
      variables: ref('link-id'),
    })
    mount(AdminLinksPage)

    const rows = screen.getAllByTestId('console-link-row')
    const activeRow = rows.find((row) => within(row).queryByText('https://go.example.com/abc123'))
    const otherRow = rows.find((row) => within(row).queryByText('https://go.example.com/def456'))
    if (!activeRow || !otherRow) {
      throw new Error('expected admin short link rows')
    }

    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(activeRow).getByRole('menuitem', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(within(otherRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(otherRow).getByRole('menuitem', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not mark admin link rows as deleting for non-delete mutation variables', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', ...defaultShortLinkAccessConfig, createdAt: '2026-08-01T00:00:00Z', owner: { id: 'owner-id', username: 'alice', nickname: '' } },
        ],
      }),
    })
    setMutationResult({
      isPending: ref(true),
      variables: ref({ id: 'link-id', status: 'disabled' }),
    })
    mount(AdminLinksPage)

    const row = screen.getByTestId('console-link-row')
    await fireEvent.click(within(row).getByRole('button', { name: 'links.actions.more' }))

    expect((within(row).getByRole('menuitem', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('queries admin links with filter state', async () => {
    vi.useFakeTimers()
    setQueryResult({ data: ref({ meta: { total: 0 }, items: [] }) })
    mount(AdminLinksPage)

    await fireEvent.update(screen.getByLabelText('filter.status'), 'active')
    await fireEvent.update(screen.getByLabelText('filter.keyword'), 'alice')
    vi.advanceTimersByTime(500)
    const queryKey = state.queryKeys[0]
    state.queryFns[0]?.()

    expect(isRef(queryKey) ? queryKey.value : queryKey).toEqual(['admin-short-link', 'active', 'alice'])
    expect(listAdminShortLinks).toHaveBeenCalledWith({ status: 'active', q: 'alice' })
  })

  it('renders admin links error, loading, and empty states', () => {
    setQueryResult({ isError: ref(true) })
    const error = mount(AdminLinksPage)
    expect(screen.getByText('adminLinks.loadFailed')).toBeTruthy()
    expect(screen.queryByText('links.emptyTitle')).toBeNull()
    error.unmount()

    setQueryResult({ isPending: ref(true) })
    const pending = mount(AdminLinksPage)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    pending.unmount()

    setQueryResult({ data: ref({ meta: { total: 0 }, items: [] }) })
    const empty = mount(AdminLinksPage)
    expect(screen.getByText('links.emptyTitle')).toBeTruthy()
    expect(screen.getByText('adminLinks.emptyDescription')).toBeTruthy()
    expect(screen.getByText('adminLinks.total')).toBeTruthy()
    expect(empty.container.querySelector('.console-page__empty')).toBeTruthy()
    expect(empty.container.querySelector('.console-page__empty-mark')).toBeNull()
    empty.unmount()

    setQueryResult({ data: ref(undefined) })
    mount(AdminLinksPage)
    expect(screen.getByText('links.emptyTitle')).toBeTruthy()
  })

  it('renders setup form error and successful initialized state', async () => {
    setQueryResult({ data: ref({ initialized: false }) })
    setMutationResult({
      error: ref(new Error('setup failed')),
      isError: ref(true),
    })
    mount(SetupPage)

    expect(screen.getByText('setup failed')).toBeTruthy()
    expect(screen.getByTestId('setup-wizard')).toBeTruthy()
    await fireEvent.click(screen.getByText('setup.submit'))

    expect(screen.getByText('setup.initialized')).toBeTruthy()
  })

  it('renders fallback error messages', () => {
    setMutationResult({
      error: ref({}),
      isError: ref(true),
      mutate: vi.fn(),
    })
    const login = mount(LoginPage)
    expect(screen.getByTestId('auth-error-toast')).toBeTruthy()
    expect(screen.getByText('auth.loginFailed')).toBeTruthy()
    login.unmount()

    setQueryResult({ data: ref({ initialized: false }) })
    setMutationResult({
      error: ref({}),
      isError: ref(true),
      mutate: vi.fn(),
    })
    mount(SetupPage)
    expect(screen.getByText('setup.failed')).toBeTruthy()
  })

  it('submits create user form and shows created username', async () => {
    setMutationResult()
    mount(CreateUserPage)

    expect(screen.getByTestId('console-page-create-user')).toBeTruthy()
    expect(screen.getByTestId('console-form-panel')).toBeTruthy()
    expect(screen.getAllByTestId('console-form-group')).toHaveLength(2)
    expect(screen.getByText('createUser.title')).toBeTruthy()
    expect(screen.queryByText('pageMeta.createUserEyebrow')).toBeNull()
    expect(screen.queryByText('createUser.mark')).toBeNull()
    await fireEvent.update(screen.getByLabelText('createUser.username'), 'alice')
    await fireEvent.update(screen.getByLabelText('createUser.password'), 'password123')
    await fireEvent.update(screen.getByLabelText('createUser.nickname'), 'Alice')
    await fireEvent.update(screen.getByLabelText('createUser.group'), 'admin')
    await fireEvent.update(screen.getByLabelText('createUser.status'), 'disabled')
    await fireEvent.click(screen.getByText('createUser.submit'))

    expect(screen.getByText('alice')).toBeTruthy()
    expect((screen.getByLabelText('createUser.username') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('createUser.password') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('createUser.nickname') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('createUser.group') as HTMLSelectElement).value).toBe('user')
    expect((screen.getByLabelText('createUser.status') as HTMLSelectElement).value).toBe('active')
  })

  it('binds pending user creation to both loading and disabled submit states', () => {
    const source = readFileSync('src/pages/CreateUserPage.vue', 'utf8')
    const submitBlock = source.match(/<v-btn\s+class="console-form-panel__submit"[\s\S]+?<\/v-btn>/)?.[0] ?? ''

    expect(submitBlock).toContain(':loading="mutation.isPending.value"')
    expect(submitBlock).toContain(':disabled="mutation.isPending.value"')
  })

  it('renders admin users list and submits user actions', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 2 },
        items: [
          {
            id: 'user-id',
            username: 'alice',
            nickname: 'Alice',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
          {
            id: 'guest-id',
            username: 'guest',
            nickname: 'Guest',
            group: 'guest',
            status: 'active',
            builtin: true,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
          {
            id: 'legacy-id',
            username: 'legacy',
            nickname: 'Legacy',
            group: 'user',
            status: 'active',
            builtin: true,
            createdAt: 'legacy-date',
            updatedAt: 'legacy-date',
          },
        ],
      }),
    })
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mount(AdminUsersPage)

    expect(screen.getByTestId('console-page-admin-users')).toBeTruthy()
    expect(screen.queryByText('pageMeta.identityEyebrow')).toBeNull()
    expect(screen.getByTestId('console-data-panel')).toBeTruthy()
    expect(screen.getAllByTestId('console-user-row')).toHaveLength(3)
    expect(screen.getAllByTestId('console-user-summary-actions')).toHaveLength(3)
    expect(screen.getByText('adminUsers.total')).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getAllByText('adminUsers.type.builtin').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2026-06-08').length).toBeGreaterThan(0)
    expect(screen.queryByText(/2026-06-08T00:00:00Z/)).toBeNull()
    expect(screen.getByText('legacy-date')).toBeTruthy()
    expect(screen.queryByLabelText('adminUsers.labels.nickname')).toBeNull()

    expect(screen.getByText('adminUsers.paginationNotice')).toBeTruthy()

    await fireEvent.click(screen.getAllByRole('button', { name: 'adminUsers.actions.more' })[0])
    await fireEvent.click(screen.getAllByText('adminUsers.actions.disable')[0])
    await fireEvent.click(screen.getAllByRole('button', { name: 'adminUsers.actions.edit' })[0])
    await fireEvent.update(screen.getAllByLabelText('adminUsers.labels.nickname')[0], 'Alice Renamed')
    await fireEvent.click(screen.getAllByText('adminUsers.saveNickname')[0])
    await fireEvent.click(screen.getAllByRole('button', { name: 'adminUsers.actions.more' })[0])
    await fireEvent.update(screen.getAllByLabelText('adminUsers.labels.newPassword')[0], 'new-password')
    await fireEvent.click(screen.getAllByText('adminUsers.resetPassword')[0])

    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Alice', status: 'disabled' })
    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Alice Renamed', status: 'active' })
    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', password: 'new-password' })
  })

  it('invalidates admin users after a successful status update', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [{
          id: 'user-id',
          username: 'alice',
          nickname: 'Alice',
          group: 'user',
          status: 'active',
          builtin: false,
          createdAt: '2026-06-08T00:00:00Z',
          updatedAt: '2026-06-08T00:00:00Z',
        }],
      }),
    })
    mount(AdminUsersPage)

    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.more' }))
    await fireEvent.click(screen.getByText('adminUsers.actions.disable'))

    expect(updateUser).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Alice', status: 'disabled' })
    expect(state.queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-user'] })
  })

  it('formats admin user dates with local date components', () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [
          {
            id: 'user-id',
            username: 'alice',
            nickname: 'Alice',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-07T23:30:00Z',
            updatedAt: '2026-06-07T23:30:00Z',
          },
        ],
      }),
    })

    mount(AdminUsersPage)

    const expected = new Date('2026-06-07T23:30:00Z')
    const localDate = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, '0')}-${String(expected.getDate()).padStart(2, '0')}`
    expect(screen.getByText(localDate)).toBeTruthy()
    expect(screen.queryByText('2026-06-07T23:30:00Z')).toBeNull()
  })

  it('renders admin user avatar text with shared Unicode-safe initials', () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [
          {
            id: 'user-id',
            username: '  😀alice',
            nickname: '',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
        ],
      }),
    })

    const { container } = mount(AdminUsersPage)

    expect(container.querySelector('.console-user-row__avatar')?.textContent).toBe('😀')
  })

  it('scopes admin user action loading state to the active row', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 2 },
        items: [
          {
            id: 'user-id',
            username: 'alice',
            nickname: 'Alice',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
          {
            id: 'other-id',
            username: 'bob',
            nickname: 'Bob',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
        ],
      }),
    })
    setMutationResult({
      isPending: ref(true),
      variables: ref({ id: 'user-id', nickname: 'Alice', status: 'active' }),
    })

    mount(AdminUsersPage)

    const rows = screen.getAllByTestId('console-user-row')
    const aliceRow = rows.find((row) => within(row).queryByText('alice'))
    const bobRow = rows.find((row) => within(row).queryByText('bob'))
    if (!aliceRow || !bobRow) {
      throw new Error('expected user rows')
    }

    await fireEvent.click(within(bobRow).getByRole('button', { name: 'adminUsers.actions.edit' }))
    expect((within(bobRow).getByRole('button', { name: 'adminUsers.saveNickname' }) as HTMLButtonElement).disabled).toBe(false)

    await fireEvent.click(within(aliceRow).getByRole('button', { name: 'adminUsers.actions.edit' }))
    expect((within(aliceRow).getByRole('button', { name: 'adminUsers.saveNickname' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('scopes admin user password reset loading state to the active row', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 2 },
        items: [
          {
            id: 'user-id',
            username: 'alice',
            nickname: 'Alice',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
          {
            id: 'other-id',
            username: 'bob',
            nickname: 'Bob',
            group: 'user',
            status: 'active',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
        ],
      }),
    })
    setMutationResult({
      isPending: ref(true),
      variables: ref({ id: 'user-id', password: 'new-password' }),
    })

    mount(AdminUsersPage)

    const rows = screen.getAllByTestId('console-user-row')
    const aliceRow = rows.find((row) => within(row).queryByText('alice'))
    const bobRow = rows.find((row) => within(row).queryByText('bob'))
    if (!aliceRow || !bobRow) {
      throw new Error('expected user rows')
    }

    await fireEvent.click(within(bobRow).getByRole('button', { name: 'adminUsers.actions.more' }))
    expect((within(bobRow).getByRole('button', { name: 'adminUsers.resetPassword' }) as HTMLButtonElement).disabled).toBe(false)

    await fireEvent.click(within(aliceRow).getByRole('button', { name: 'adminUsers.actions.more' }))
    expect((within(aliceRow).getByRole('button', { name: 'adminUsers.resetPassword' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('submits admin user fallback actions for disabled users', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [
          {
            id: 'user-id',
            username: 'bob',
            nickname: 'Bob',
            group: 'user',
            status: 'disabled',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
        ],
      }),
    })
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mount(AdminUsersPage)

    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.more' }))
    await fireEvent.click(screen.getByText('adminUsers.actions.enable'))
    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.edit' }))
    await fireEvent.update(screen.getByLabelText('adminUsers.labels.nickname'), '')
    await fireEvent.click(screen.getByText('adminUsers.saveNickname'))
    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.more' }))
    await fireEvent.update(screen.getByLabelText('adminUsers.labels.newPassword'), '')
    await fireEvent.click(screen.getByText('adminUsers.resetPassword'))

    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Bob', status: 'active' })
    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Bob', status: 'disabled' })
    expect(mutate).not.toHaveBeenCalledWith({ id: 'user-id', password: '' })
    expect(screen.getByText('adminUsers.passwordRequired')).toBeTruthy()
  })

  it('validates admin reset password length before submitting', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 1 },
        items: [
          {
            id: 'user-id',
            username: 'bob',
            nickname: 'Bob',
            group: 'user',
            status: 'disabled',
            builtin: false,
            createdAt: '2026-06-08T00:00:00Z',
            updatedAt: '2026-06-08T00:00:00Z',
          },
        ],
      }),
    })
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mount(AdminUsersPage)

    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.more' }))
    await fireEvent.update(screen.getByLabelText('adminUsers.labels.newPassword'), ' short ')
    await fireEvent.click(screen.getByText('adminUsers.resetPassword'))

    expect(mutate).not.toHaveBeenCalledWith({ id: 'user-id', password: 'short' })
    expect(screen.getByText('adminUsers.passwordMinLength')).toBeTruthy()
  })

  it('renders admin users error, loading, and empty states', () => {
    setQueryResult({ isError: ref(true) })
    const error = mount(AdminUsersPage)
    expect(screen.getByText('adminUsers.loadFailed')).toBeTruthy()
    expect(screen.queryByText('adminUsers.noUsers')).toBeNull()
    error.unmount()

    setQueryResult({ isPending: ref(true) })
    const pending = mount(AdminUsersPage)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    pending.unmount()

    setQueryResult({ data: ref({ meta: { total: 0 }, items: [] }) })
    const empty = mount(AdminUsersPage)
    expect(screen.getByText('adminUsers.noUsers')).toBeTruthy()
    expect(screen.getByText('adminUsers.total')).toBeTruthy()
    expect(empty.container.querySelector('.console-page__empty')).toBeTruthy()
    expect(empty.container.querySelector('.console-page__empty-mark')).toBeNull()
    empty.unmount()

    setQueryResult({ data: ref(undefined) })
    mount(AdminUsersPage)
    expect(screen.getByText('adminUsers.noUsers')).toBeTruthy()
  })
})
