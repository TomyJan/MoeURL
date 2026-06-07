import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRef, ref } from 'vue'

import AdminLinksPage from './AdminLinksPage.vue'
import AdminUsersPage from './AdminUsersPage.vue'
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
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
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
    }
    const providedMutate = base.mutate
    return {
      data: base.data ?? ref(undefined),
      error: base.error ?? ref(undefined),
      isError: base.isError ?? ref(false),
      isPending: base.isPending ?? ref(false),
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
}> = {}) {
  state.mutationResult = {
    data: value.data ?? ref(undefined),
    error: value.error ?? ref(undefined),
    isError: value.isError ?? ref(false),
    isPending: value.isPending ?? ref(false),
    ...(value.mutate ? { mutate: value.mutate } : {}),
  }
}

describe('pages', () => {
  beforeEach(() => {
    setQueryResult({})
    setMutationResult()
    state.queryKeys = []
    state.queryFns = []
    state.queryClient.invalidateQueries.mockReset()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders not found page title', () => {
    mount(NotFoundPage)

    expect(screen.getByText('page.notFound')).toBeTruthy()
  })

  it('submits login credentials and shows errors', async () => {
    const mutate = vi.fn()
    setMutationResult({
      error: ref(new Error('bad credentials')),
      isError: ref(true),
      mutate,
    })
    mount(LoginPage)

    await fireEvent.update(screen.getByLabelText('Username'), 'alice')
    await fireEvent.update(screen.getByLabelText('Password'), 'secret')
    await fireEvent.click(screen.getByText('Login'))

    expect(screen.getByText('bad credentials')).toBeTruthy()
    expect(mutate).toHaveBeenCalledWith({ username: 'alice', password: 'secret' })
  })

  it('renders setup loading, initialized, and submit states', async () => {
    setQueryResult({ isLoading: ref(true) })
    const loading = mount(SetupPage)
    expect(screen.getByText('Loading')).toBeTruthy()
    loading.unmount()

    setQueryResult({ data: ref({ initialized: true }) })
    const initialized = mount(SetupPage)
    expect(screen.getByText('Initialized')).toBeTruthy()
    initialized.unmount()

    const mutate = vi.fn()
    setQueryResult({ data: ref({ initialized: false }) })
    setMutationResult({
      error: ref(new Error('setup failed')),
      isError: ref(true),
      mutate,
    })
    mount(SetupPage)

    expect(screen.getByText('setup failed')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('Admin username'), 'admin')
    await fireEvent.update(screen.getByLabelText('Admin password'), 'password123')
    await fireEvent.update(screen.getByLabelText('Admin nickname'), 'Admin')
    await fireEvent.update(screen.getByLabelText('Site name'), 'MoeURL Test')
    await fireEvent.update(screen.getByLabelText('System domain'), 'example.com')
    await fireEvent.update(screen.getByLabelText('Short link domain'), 'go.example.com')
    await fireEvent.update(screen.getByLabelText('Default language'), 'en')
    await fireEvent.update(screen.getByLabelText('Default theme'), 'dark')
    await fireEvent.click(screen.getByText('初始化'))

    expect(screen.getByText('Initialized')).toBeTruthy()
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ adminUsername: 'admin', defaultLanguage: 'en', defaultTheme: 'dark' }))
  })

  it('blocks guest creation and creates short links for authorized users', async () => {
    setQueryResult({ data: ref({ user: { permissions: [] } }) })
    const guest = mount(HomePage)

    expect(screen.getByText('请登录后创建短链')).toBeTruthy()
    await fireEvent.click(screen.getByText('创建短链'))
    guest.unmount()

    const mutate = vi.fn()
    setQueryResult({ data: ref({ user: { permissions: ['short_link:create', 'domain:use_default'] } }) })
    setMutationResult({
      data: ref(undefined),
      error: ref(new Error('invalid target')),
      isPending: ref(false),
      mutate,
    })
    mount(HomePage)

    await fireEvent.update(screen.getByLabelText('https://example.com'), 'https://example.com')
    await fireEvent.click(screen.getByText('创建短链'))

    expect(screen.getByText('invalid target')).toBeTruthy()
    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
  })

  it('shows fallback create error message', () => {
    setQueryResult({ data: ref({ user: { permissions: ['short_link:create', 'domain:use_default'] } }) })
    setMutationResult({
      data: ref(undefined),
      error: ref({}),
      mutate: vi.fn(),
    })
    mount(HomePage)

    expect(screen.getByText('创建失败，请检查链接和权限')).toBeTruthy()
  })

  it('shows created short link actions', async () => {
    setQueryResult({ data: ref({ user: { permissions: ['short_link:create', 'domain:use_default'] } }) })
    setMutationResult()
    mount(HomePage)

    await fireEvent.update(screen.getByLabelText('https://example.com'), 'https://example.com')
    await fireEvent.click(screen.getByText('创建短链'))

    expect(screen.getByText('https://go.example.com/abc123')).toBeTruthy()
    await fireEvent.click(screen.getByText('复制短链'))
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')
    await fireEvent.click(screen.getByText('继续创建'))
  })

  it('renders own links states and row actions', async () => {
    setQueryResult({ isError: ref(true) })
    const error = mount(MyLinksPage)
    expect(screen.getByText('加载失败')).toBeTruthy()
    error.unmount()

    setQueryResult({ isPending: ref(true) })
    const pending = mount(MyLinksPage)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    pending.unmount()

    setQueryResult({ data: ref({ items: [] }) })
    const empty = mount(MyLinksPage)
    expect(screen.getByText('暂无短链')).toBeTruthy()
    empty.unmount()

    setQueryResult({ data: ref(undefined) })
    const missingData = mount(MyLinksPage)
    expect(screen.getByText('暂无短链')).toBeTruthy()
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

    await fireEvent.click(screen.getAllByText('禁用')[1])
    await fireEvent.click(screen.getAllByText('启用')[1])
    await fireEvent.click(screen.getAllByText('复制')[0])
    await fireEvent.click(screen.getAllByText('删除')[0])

    expect(screen.getByLabelText('状态筛选')).toBeTruthy()
    expect(listShortLinks).toHaveBeenCalledWith({ status: '' })
    expect(update).toHaveBeenCalledWith({ id: 'link-id', status: 'disabled' })
    expect(update).toHaveBeenCalledWith({ id: 'link-disabled', status: 'active' })
    expect(update).toHaveBeenCalledWith('link-id')
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')
  })

  it('queries own links with status filter state', async () => {
    setQueryResult({ data: ref({ items: [] }) })
    mount(MyLinksPage)

    await fireEvent.update(screen.getByLabelText('状态筛选'), 'disabled')
    const queryKey = state.queryKeys[0]
    state.queryFns[0]?.()

    expect(isRef(queryKey) ? queryKey.value : queryKey).toEqual(['short-links', 'disabled'])
    expect(listShortLinks).toHaveBeenCalledWith({ status: 'disabled' })
  })

  it('renders admin links states and row actions', async () => {
    setQueryResult({ data: ref({ meta: { total: 1 }, items: [{ id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'disabled', owner: { id: 'owner-id', username: 'alice', nickname: '' } }, { id: 'link-active', url: 'https://go.example.com/active', slug: 'active', targetUrl: 'https://example.net', status: 'active', owner: { id: 'owner-2', username: 'bob', nickname: 'Bobby' } }] }) })
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mount(AdminLinksPage)

    expect(screen.getByText('共 1 条')).toBeTruthy()
    expect(screen.getByText('owner-id')).toBeTruthy()
    expect(screen.getByText('Bobby')).toBeTruthy()
    await fireEvent.click(screen.getAllByText('启用')[1])
    await fireEvent.click(screen.getAllByText('禁用')[1])
    await fireEvent.click(screen.getAllByText('复制')[0])
    await fireEvent.click(screen.getAllByText('删除')[0])

    expect(screen.getByLabelText('状态筛选')).toBeTruthy()
    expect(screen.getByLabelText('关键词搜索')).toBeTruthy()
    expect(listAdminShortLinks).toHaveBeenCalledWith({ status: '', q: '' })
    expect(mutate).toHaveBeenCalledWith({ id: 'link-id', status: 'active' })
    expect(mutate).toHaveBeenCalledWith({ id: 'link-active', status: 'disabled' })
    expect(mutate).toHaveBeenCalledWith('link-id')
  })

  it('queries admin links with filter state', async () => {
    setQueryResult({ data: ref({ meta: { total: 0 }, items: [] }) })
    mount(AdminLinksPage)

    await fireEvent.update(screen.getByLabelText('状态筛选'), 'active')
    await fireEvent.update(screen.getByLabelText('关键词搜索'), 'alice')
    const queryKey = state.queryKeys[0]
    state.queryFns[0]?.()

    expect(isRef(queryKey) ? queryKey.value : queryKey).toEqual(['admin-short-links', 'active', 'alice'])
    expect(listAdminShortLinks).toHaveBeenCalledWith({ status: 'active', q: 'alice' })
  })

  it('renders admin links error, loading, and empty states', () => {
    setQueryResult({ isError: ref(true) })
    const error = mount(AdminLinksPage)
    expect(screen.getByText('加载失败')).toBeTruthy()
    error.unmount()

    setQueryResult({ isPending: ref(true) })
    const pending = mount(AdminLinksPage)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    pending.unmount()

    setQueryResult({ data: ref({ meta: { total: 0 }, items: [] }) })
    const empty = mount(AdminLinksPage)
    expect(screen.getByText('暂无短链')).toBeTruthy()
    expect(screen.getByText('共 0 条')).toBeTruthy()
    empty.unmount()

    setQueryResult({ data: ref(undefined) })
    mount(AdminLinksPage)
    expect(screen.getByText('暂无短链')).toBeTruthy()
  })

  it('renders setup form error and successful initialized state', async () => {
    setQueryResult({ data: ref({ initialized: false }) })
    setMutationResult({
      error: ref(new Error('setup failed')),
      isError: ref(true),
    })
    mount(SetupPage)

    expect(screen.getByText('setup failed')).toBeTruthy()
    await fireEvent.click(screen.getByText('初始化'))

    expect(screen.getByText('Initialized')).toBeTruthy()
  })

  it('renders fallback error messages', () => {
    setMutationResult({
      error: ref({}),
      isError: ref(true),
      mutate: vi.fn(),
    })
    const login = mount(LoginPage)
    expect(screen.getByText('Login failed')).toBeTruthy()
    login.unmount()

    setQueryResult({ data: ref({ initialized: false }) })
    setMutationResult({
      error: ref({}),
      isError: ref(true),
      mutate: vi.fn(),
    })
    mount(SetupPage)
    expect(screen.getByText('初始化失败')).toBeTruthy()
  })

  it('submits create user form and shows created username', async () => {
    setMutationResult()
    mount(CreateUserPage)

    await fireEvent.update(screen.getByLabelText('Username'), 'alice')
    await fireEvent.update(screen.getByLabelText('Password'), 'password123')
    await fireEvent.update(screen.getByLabelText('Nickname'), 'Alice')
    await fireEvent.update(screen.getByLabelText('Group'), 'admin')
    await fireEvent.update(screen.getByLabelText('Status'), 'disabled')
    await fireEvent.click(screen.getByText('创建用户'))

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
        ],
      }),
    })
    const mutate = vi.fn()
    setMutationResult({ mutate })
    mount(AdminUsersPage)

    expect(screen.getByText('共 2 个用户')).toBeTruthy()
    expect(screen.getByText('alice')).toBeTruthy()
    expect(screen.getByText('内置')).toBeTruthy()

    await fireEvent.click(screen.getAllByText('禁用')[0])
    await fireEvent.update(screen.getAllByLabelText('昵称')[0], 'Alice Renamed')
    await fireEvent.click(screen.getAllByText('保存昵称')[0])
    await fireEvent.update(screen.getAllByLabelText('新密码')[0], 'new-password')
    await fireEvent.click(screen.getAllByText('重置密码')[0])

    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Alice', status: 'disabled' })
    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Alice Renamed', status: 'active' })
    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', password: 'new-password' })
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

    await fireEvent.click(screen.getByText('启用'))
    await fireEvent.update(screen.getByLabelText('昵称'), '')
    await fireEvent.click(screen.getByText('保存昵称'))
    await fireEvent.update(screen.getByLabelText('新密码'), '')
    await fireEvent.click(screen.getByText('重置密码'))

    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Bob', status: 'active' })
    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', nickname: 'Bob', status: 'disabled' })
    expect(mutate).toHaveBeenCalledWith({ id: 'user-id', password: '' })
  })

  it('renders admin users error, loading, and empty states', () => {
    setQueryResult({ isError: ref(true) })
    const error = mount(AdminUsersPage)
    expect(screen.getByText('加载失败')).toBeTruthy()
    error.unmount()

    setQueryResult({ isPending: ref(true) })
    const pending = mount(AdminUsersPage)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    pending.unmount()

    setQueryResult({ data: ref({ meta: { total: 0 }, items: [] }) })
    const empty = mount(AdminUsersPage)
    expect(screen.getByText('暂无用户')).toBeTruthy()
    expect(screen.getByText('共 0 个用户')).toBeTruthy()
    empty.unmount()

    setQueryResult({ data: ref(undefined) })
    mount(AdminUsersPage)
    expect(screen.getByText('暂无用户')).toBeTruthy()
  })
})
