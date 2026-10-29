import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDeferred } from '@/test/deferred'
import { publicHomeContentKey } from '@/entities/home-content/api'
import HomePage from './HomePage.vue'

const state = vi.hoisted(() => ({ locale: undefined as unknown as ReturnType<typeof ref<string>> }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({
  t: (key: string) => `${state.locale.value}:${key}`,
}) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/entities/auth/api', () => ({ me: vi.fn(async () => ({ user: { group: 'guest', username: 'guest' } })) }))
vi.mock('@/widgets/home-header/HomeHeader.vue', () => ({ default: { template: '<nav>Header</nav>' } }))
vi.mock('@/widgets/home-intro/HomeIntroSections.vue', () => ({ default: { template: '<section>Introduction</section>' } }))
vi.mock('@/features/short-link-create/ShortLinkCreatePanel.vue', () => ({ default: { template: '<button>Create link</button>' } }))

let client: QueryClient
function mountHome() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(HomePage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
}
function response(title: string, summary: string) {
  return new Response(JSON.stringify({ code: 0, message: 'OK', data: { title, summary }, meta: {} }), { status: 200 })
}

describe('Homepage copy', () => {
  beforeEach(() => { state.locale = ref('en') })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

  it('falls back per field in the current locale without replacing custom copy on language change', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('Instance links', '')))
    mountHome()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Instance links'))
    expect(screen.getByText('en:home.heroSummary')).toBeTruthy()
    state.locale.value = 'zh-CN'
    await nextTick()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Instance links')
    expect(screen.getByText('zh-CN:home.heroSummary')).toBeTruthy()
    expect(fetch).toHaveBeenCalledWith('/api/v1/system/home-content', expect.objectContaining({ method: 'GET' }))
  })

  it('renders markup-shaped copy as literal text and falls back independently for an empty title', async () => {
    const literal = '<img src=x onerror=alert(1)> {name} **hello** 🌲'
    vi.stubGlobal('fetch', vi.fn(async () => response('', literal)))
    const view = mountHome()
    await waitFor(() => expect(screen.getByText(literal)).toBeTruthy())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('en:home.heroTitle')
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.querySelector('strong')).toBeNull()
  })

  it('keeps the creation entry available while loading and after a public-read failure', async () => {
    const pending = createDeferred<Response>()
    void pending.promise.catch(() => undefined)
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    mountHome()
    expect(screen.getByRole('button', { name: 'Create link' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('en:home.heroTitle')
    pending.reject(new Error('offline'))
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.getByRole('button', { name: 'Create link' })).toBeTruthy()
    expect(screen.getByText('en:home.heroSummary')).toBeTruthy()
  })

  it('reads again on a new mount and hides prior cached custom copy during a failed refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response('Prior custom', 'Old summary'))
    vi.stubGlobal('fetch', fetchMock)
    const first = mountHome()
    await waitFor(() => expect(screen.getByText('Prior custom')).toBeTruthy())
    first.unmount()
    const pending = createDeferred<Response>()
    fetchMock.mockImplementation(() => pending.promise)
    render(HomePage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Prior custom')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('en:home.heroTitle')
    pending.reject(new Error('offline'))
    await waitFor(() => expect(client.isFetching()).toBe(0))
    expect(screen.queryByText('Prior custom')).toBeNull()
  })
  it('retains successful copy during a same-mount background refresh and then applies the new content', async () => {
    const pending = createDeferred<Response>()
    const fetchMock = vi.fn().mockResolvedValueOnce(response('First title', 'First summary')).mockImplementation(() => pending.promise)
    vi.stubGlobal('fetch', fetchMock)
    mountHome()
    await waitFor(() => expect(screen.getByText('First title')).toBeTruthy())
    const refresh = client.invalidateQueries({ queryKey: publicHomeContentKey })
    await waitFor(() => expect(client.getQueryState(publicHomeContentKey)?.fetchStatus).toBe('fetching'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('First title')
    expect(screen.getByText('First summary')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create link' })).toBeTruthy()
    pending.resolve(response('New title', ''))
    await refresh
    await waitFor(() => expect(screen.getByText('New title')).toBeTruthy())
    state.locale.value = 'zh-CN'; await nextTick()
    expect(screen.getByText('zh-CN:home.heroSummary')).toBeTruthy()
  })
  it('falls back after a background error and does not revive stale data while retrying', async () => {
    const failed = createDeferred<Response>()
    const retry = createDeferred<Response>()
    const fetchMock = vi.fn().mockResolvedValueOnce(response('First title', 'First summary')).mockImplementationOnce(() => failed.promise).mockImplementation(() => retry.promise)
    vi.stubGlobal('fetch', fetchMock)
    mountHome()
    await waitFor(() => expect(screen.getByText('First title')).toBeTruthy())
    const refresh = client.invalidateQueries({ queryKey: publicHomeContentKey })
    await waitFor(() => expect(client.getQueryState(publicHomeContentKey)?.fetchStatus).toBe('fetching'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('First title')
    failed.reject(new Error('offline')); await refresh
    await waitFor(() => expect(screen.queryByText('First title')).toBeNull())
    const nextRefresh = client.refetchQueries({ queryKey: publicHomeContentKey })
    await waitFor(() => expect(client.getQueryState(publicHomeContentKey)?.fetchStatus).toBe('fetching'))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('en:home.heroTitle')
    expect(screen.getByText('en:home.heroSummary')).toBeTruthy()
    retry.resolve(response('Recovered title', 'Recovered summary')); await nextRefresh
    await waitFor(() => expect(screen.getByText('Recovered title')).toBeTruthy())
  })
  it('hides retained cached copy on a new observer until this mount completes its own read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('Cached title', 'Cached summary')))
    const first = mountHome()
    await waitFor(() => expect(screen.getByText('Cached title')).toBeTruthy())
    const pending = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    const retained = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    retained.setQueryData(publicHomeContentKey, { title: 'Cached title', summary: 'Cached summary' })
    first.unmount(); client.clear(); client = retained
    render(HomePage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
    await waitFor(() => expect(client.getQueryState(publicHomeContentKey)?.fetchStatus).toBe('fetching'))
    expect(screen.queryByText('Cached title')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('en:home.heroTitle')
    pending.resolve(response('Current title', 'Current summary'))
    await waitFor(() => expect(screen.getByText('Current title')).toBeTruthy())
  })
})
