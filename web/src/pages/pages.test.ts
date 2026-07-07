import { fireEvent, render, screen, within } from '@testing-library/vue'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRef, ref } from 'vue'

import AdminLinksPage from './AdminLinksPage.vue'
import AdminUsersPage from './AdminUsersPage.vue'
import ConsolePlaceholderPage from './ConsolePlaceholderPage.vue'
import CreateUserPage from './CreateUserPage.vue'
import HomePage from './HomePage.vue'
import LoginPage from './LoginPage.vue'
import MyLinksPage from './MyLinksPage.vue'
import NotFoundPage from './NotFoundPage.vue'
import SetupPage from './SetupPage.vue'
import { componentStubs } from '@/test/component-stubs'
import { listAdminShortLinks, listShortLinks } from '@/entities/short-link/api'

const state = vi.hoisted(() => ({
  queryResult: {},
  queryKeys: [] as unknown[],
  queryFns: [] as Array<() => unknown>,
  mutationResult: {},
  routeQuery: {} as Record<string, unknown>,
  routerPush: vi.fn(),
  queryClient: {
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
  },
}))

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
  useTheme: () => ({
    global: {
      name: ref('moeurlLight'),
    },
  }),
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
  createShortLink: vi.fn(),
}))

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

vi.mock('@tanstack/vue-query', () => ({
  QueryClient: class {
    getDefaultOptions = vi.fn()
    invalidateQueries = vi.fn()
  },
  useMutation: vi.fn((options?: { onSuccess?: (value: unknown) => void }) => {
    const base = state.mutationResult as {
      data?: ReturnType<typeof ref>
      error?: ReturnType<typeof ref>
      isError?: ReturnType<typeof ref>
      isPending?: ReturnType<typeof ref>
      mutate?: (input: unknown) => void
      variables?: ReturnType<typeof ref>
    }
    const providedMutate = base.mutate
    return {
      data: base.data ?? ref(undefined),
      error: base.error ?? ref(undefined),
      isError: base.isError ?? ref(false),
      isPending: base.isPending ?? ref(false),
      variables: base.variables ?? ref(undefined),
      mutate: vi.fn((input: unknown) => {
        providedMutate?.(input)
        options?.onSuccess?.({
          initialized: true,
          shortLink: { url: 'https://go.example.com/abc123' },
          user: { username: 'alice' },
          input,
        })
      }),
    }
  }),
  useQuery: vi.fn((options?: { queryFn?: () => unknown; queryKey?: unknown }) => {
    state.queryKeys.push(options?.queryKey)
    if (options?.queryFn) {
      state.queryFns.push(options.queryFn)
    }
    options?.queryFn?.()
    return state.queryResult
  }),
  useQueryClient: () => state.queryClient,
}))

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
}>) {
  state.queryResult = {
    data: value.data ?? ref(undefined),
    isError: value.isError ?? ref(false),
    isLoading: value.isLoading ?? ref(false),
    isPending: value.isPending ?? ref(false),
  }
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
    setMutationResult()
    state.queryKeys = []
    state.queryFns = []
    state.routeQuery = {}
    state.routerPush.mockReset()
    state.queryClient.invalidateQueries.mockReset()
    state.queryClient.setQueryData.mockReset()
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

  it('renders planned console placeholder pages without fake data', () => {
    render(ConsolePlaceholderPage, {
      props: {
        kind: 'analytics',
      },
    })

    expect(screen.getByTestId('console-page-placeholder-analytics')).toBeTruthy()
    expect(screen.getByText('page.analytics')).toBeTruthy()
    expect(screen.queryByText('pageMeta.workspaceEyebrow')).toBeNull()
    expect(screen.getByText('placeholder.status')).toBeTruthy()
    expect(screen.getByText('placeholder.analytics.items.privacy')).toBeTruthy()
  })

  it('submits login credentials, maps invalid credentials, and follows redirect query', async () => {
    const mutate = vi.fn()
    state.routeQuery = { redirect: '/admin/user' }
    setMutationResult({
      error: ref({ code: 110101, message: 'Invalid username or password' }),
      isError: ref(true),
      mutate,
    })
    mount(LoginPage)

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

    await fireEvent.click(screen.getByLabelText('snackbar.close'))

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
    mount(LoginPage)

    await fireEvent.update(screen.getByLabelText('auth.username'), 'alice')
    await fireEvent.update(screen.getByLabelText('auth.password'), 'secret')
    await fireEvent.click(screen.getByText('auth.loginSubmit'))

    expect(screen.getByText('network unavailable')).toBeTruthy()
    expect(mutate).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
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

    expect(screen.getByText('setup.initialized')).toBeTruthy()
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ adminUsername: 'admin', defaultLanguage: 'en', defaultTheme: 'dark' }))
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

    expect(screen.getByText('https://go.example.com/abc123')).toBeTruthy()
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

  it('routes authenticated users from home account entry to console', async () => {
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

    expect(state.routerPush).toHaveBeenCalledWith('/link')
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
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' },
          { id: 'link-disabled', url: 'https://go.example.com/def456', slug: 'def456', targetUrl: 'https://example.org', status: 'disabled' },
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

    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(activeRow).getByRole('button', { name: 'links.actions.more' }).getAttribute('aria-haspopup')).toBe('menu')
    expect(within(activeRow).getByRole('button', { name: 'links.actions.more' }).getAttribute('aria-expanded')).toBe('true')
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.disable' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(activeRow).getByRole('button', { name: 'links.actions.more' }).getAttribute('aria-expanded')).toBe('false')
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.enable' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.copy' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.delete' }))
    expect(screen.getByLabelText('filter.status')).toBeTruthy()
    expect(listShortLinks).toHaveBeenCalledWith({ status: '' })
    expect(update).toHaveBeenCalledWith({ id: 'link-id', status: 'disabled' })
    expect(update).toHaveBeenCalledWith({ id: 'link-disabled', status: 'active' })
    expect(update).toHaveBeenCalledWith('link-id')
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')
  })

  it('scopes own link updating state to the active row', async () => {
    setQueryResult({
      data: ref({
        items: [
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' },
          { id: 'link-other', url: 'https://go.example.com/def456', slug: 'def456', targetUrl: 'https://example.org', status: 'active' },
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
    expect((within(activeRow).getByRole('button', { name: 'links.actions.disable' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(within(otherRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(otherRow).getByRole('button', { name: 'links.actions.disable' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('scopes own link deleting state to the active row', async () => {
    setQueryResult({
      data: ref({
        items: [
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' },
          { id: 'link-other', url: 'https://go.example.com/def456', slug: 'def456', targetUrl: 'https://example.org', status: 'active' },
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
    expect((within(activeRow).getByRole('button', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(within(otherRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(otherRow).getByRole('button', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('toggles link and user action panels closed on repeated clicks', async () => {
    setMutationResult({ mutate: vi.fn() })
    setQueryResult({
      data: ref({
        items: [{ id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' }],
      }),
    })
    const links = mount(MyLinksPage)
    const linkRow = screen.getByTestId('console-link-row')
    await fireEvent.click(within(linkRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(linkRow).getByRole('button', { name: 'links.actions.delete' })).toBeTruthy()
    await fireEvent.click(within(linkRow).getByRole('button', { name: 'links.actions.more' }))
    expect(within(linkRow).queryByRole('button', { name: 'links.actions.delete' })).toBeNull()
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
    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.edit' }))
    expect(screen.getByTestId('console-user-edit-panel')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.edit' }))
    expect(screen.queryByTestId('console-user-edit-panel')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.edit' }))
    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.more' }))
    expect(screen.queryByTestId('console-user-edit-panel')).toBeNull()
    expect(screen.getByTestId('console-user-actions')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'adminUsers.actions.more' }))
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
    setQueryResult({ data: ref({ meta: { total: 1 }, items: [{ id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'disabled', owner: { id: 'owner-id', username: 'alice', nickname: '' } }, { id: 'link-active', url: 'https://go.example.com/active', slug: 'active', targetUrl: 'https://example.net', status: 'active', owner: { id: 'owner-2', username: 'bob', nickname: 'Bobby' } }] }) })
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

    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.enable' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(activeRow).getByRole('button', { name: 'links.actions.disable' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.copy' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(within(disabledRow).getByRole('button', { name: 'links.actions.delete' }))
    expect(screen.getByLabelText('filter.status')).toBeTruthy()
    expect(screen.getByLabelText('filter.keyword')).toBeTruthy()
    expect(listAdminShortLinks).toHaveBeenCalledWith({ status: '', q: '' })
    expect(mutate).toHaveBeenCalledWith({ id: 'link-id', status: 'active' })
    expect(mutate).toHaveBeenCalledWith({ id: 'link-active', status: 'disabled' })
    expect(mutate).toHaveBeenCalledWith('link-id')
  })

  it('scopes admin link deleting state to the active row', async () => {
    setQueryResult({
      data: ref({
        meta: { total: 2 },
        items: [
          { id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active', owner: { id: 'owner-id', username: 'alice', nickname: '' } },
          { id: 'link-other', url: 'https://go.example.com/def456', slug: 'def456', targetUrl: 'https://example.org', status: 'active', owner: { id: 'owner-2', username: 'bob', nickname: '' } },
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
    expect((within(activeRow).getByRole('button', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(within(otherRow).getByRole('button', { name: 'links.actions.more' }))
    expect((within(otherRow).getByRole('button', { name: 'links.actions.delete' }) as HTMLButtonElement).disabled).toBe(false)
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
