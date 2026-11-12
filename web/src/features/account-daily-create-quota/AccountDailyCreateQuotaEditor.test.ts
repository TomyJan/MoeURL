import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { setImmediate } from 'node:timers'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { adminAccountDailyCreateQuotaKey } from '@/entities/account-daily-create-quota/api'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AccountDailyCreateQuotaEditor from './AccountDailyCreateQuotaEditor.vue'
import { useAccountDailyCreateQuotaDraft } from './useAccountDailyCreateQuotaDraft'

const original = { dailyLimit: null, updatedAt: '2026-11-12T05:00:00.123456Z' }
const saved = { dailyLimit: 7, updatedAt: '2026-11-12T05:00:01.654321Z' }
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: code ? 'private error' : 'OK', data, meta: {} }))
const denied = (code: number) => code === 120001 ? response(null, code) : new Response('', { status: code })
const reads = vi.fn<() => Promise<Response>>()
const writes = vi.fn<(body: unknown) => Promise<Response>>()
const authReads = vi.fn<() => Promise<Response>>()
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
let client: QueryClient
function auth(id = 'admin-a', permissions = ['admin:access', 'system:manage']) {
  client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', group: id ? 'admin' : 'guest', permissions } })
}
function mount(locale: 'keys' | 'en' | 'zh-CN' = 'keys') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, missingWarn: false, fallbackWarn: false, messages: locale === 'keys' ? {} : messages })
  return render(AccountDailyCreateQuotaEditor, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
}
function controller() {
  let draft!: ReturnType<typeof useAccountDailyCreateQuotaDraft>
  const view = render(defineComponent({ setup() { draft = useAccountDailyCreateQuotaDraft(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, draft }
}
const button = (name: string) => screen.getByRole('button', { name: 'dailyCreateQuota.' + name }) as HTMLButtonElement
const input = () => screen.getByLabelText('dailyCreateQuota.limit') as HTMLInputElement
const toggle = () => screen.getByRole('checkbox', { name: 'dailyCreateQuota.enabled' }) as HTMLInputElement
const form = () => screen.getByRole('form', { name: 'dailyCreateQuota.form' })
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
  client.setQueryDefaults(adminAccountDailyCreateQuotaKey, { gcTime: Infinity })
  reads.mockReset().mockImplementation(async () => response(original))
  writes.mockReset().mockImplementation(async () => response(saved))
  authReads.mockReset().mockImplementation(async () => response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } }))
  vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
    if (path === '/api/v1/auth/me' && init.method === 'GET') return authReads()
    if (path === '/api/v1/admin/system/account-daily-create-quota' && init.method === 'GET') return reads()
    if (path === '/api/v1/admin/system/account-daily-create-quota/update' && init.method === 'POST') return writes(JSON.parse(String(init.body)))
    throw new Error('Unexpected transport: ' + path)
  })
  auth()
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

describe('independent daily quota draft', () => {
  it('retains local numbers while toggling and takes both canonical value and full version only from the server', async () => {
    mount(); await flush()
    expect(toggle().checked).toBe(false); expect(input().disabled).toBe(true)
    await fireEvent.click(toggle()); await fireEvent.update(input(), '0')
    await fireEvent.click(toggle()); await fireEvent.click(toggle())
    expect(input().value).toBe('0'); expect(writes).not.toHaveBeenCalled()
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ dailyLimit: 0, expectedUpdatedAt: original.updatedAt })
    expect(toggle().checked).toBe(true); expect(input().value).toBe('7')
    expect(screen.getByText('dailyCreateQuota.saved')).toBeTruthy()
    await fireEvent.update(input(), '1000000')
    expect(screen.queryByText('dailyCreateQuota.saved')).toBeNull()
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenLastCalledWith({ dailyLimit: 1000000, expectedUpdatedAt: saved.updatedAt })
    await fireEvent.click(toggle()); await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenLastCalledWith({ dailyLimit: null, expectedUpdatedAt: saved.updatedAt })
    expect(client.getQueriesData({ queryKey: adminAccountDailyCreateQuotaKey }).map(([, value]) => value)).toContainEqual(saved)
  })
  it.each(['', '-1', '1.5', '1e2', '1000001', ' 1 ', 'x'])('refuses invalid numeric draft %j without writing or discarding it', async value => {
    mount(); await flush(); await fireEvent.click(toggle()); await fireEvent.update(input(), value)
    await fireEvent.submit(form())
    expect(writes).not.toHaveBeenCalled(); expect(input().value).toBe(value)
    expect(screen.getByText('dailyCreateQuota.invalid')).toBeTruthy()
    expect(screen.getByText('dailyCreateQuota.invalidField')).toBeTruthy()
    await fireEvent.update(input(), '1'); expect(screen.queryByText('dailyCreateQuota.invalidField')).toBeNull()
  })
  it('does not read or write without both current grants and clears private cache immediately on revocation', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    const { draft } = controller(); draft.edit('9'); draft.setEnabled(true); await draft.load(); await draft.save()
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(draft.state.version).toBe('')
    auth('admin-a', ['admin:access']); await flush(); expect(reads).not.toHaveBeenCalled()
    auth(); await flush(); expect(draft.state.version).toBe(original.updatedAt)
    auth(); await flush(); expect(reads).toHaveBeenCalledTimes(1)
    auth('admin-a', []); expect(draft.state.allowed).toBe(false); expect(draft.state.limit).toBe('0')
    expect(client.getQueriesData({ queryKey: adminAccountDailyCreateQuotaKey })).toEqual([])
  })
  it('treats a cleared numeric control as an empty invalid draft rather than silently spending a zero budget', async () => {
    const { draft } = controller(); await flush(); draft.setEnabled(true); draft.edit(null); await draft.save()
    expect(draft.state.limit).toBe(''); expect(draft.state.invalid).toBe(true); expect(writes).not.toHaveBeenCalled()
  })
  it('guards initial pending reads, retries load failures explicitly and keeps edits made during reload', async () => {
    const first = createDeferred<Response>(); reads.mockReturnValueOnce(first.promise)
    const { draft } = controller()
    draft.edit(null); draft.setEnabled(true); await draft.load(); await draft.save()
    expect(draft.state.limit).toBe('0'); expect(draft.state.enabled).toBe(false); expect(writes).not.toHaveBeenCalled()
    first.reject(new Error('offline')); await flush(); expect(draft.state.feedback).toBe('loadFailed')
    await draft.load(); expect(draft.state.version).toBe(original.updatedAt)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    const loading = draft.load(); await draft.load(); await draft.save()
    draft.setEnabled(true); draft.edit('12')
    pending.resolve(response(saved)); await loading
    expect(draft.state.limit).toBe('12'); expect(draft.state.enabled).toBe(true); expect(draft.state.version).toBe(original.updatedAt)
    expect(draft.state.loading).toBe(false); expect(reads).toHaveBeenCalledTimes(3)
    await draft.save(); expect(writes).toHaveBeenCalledExactlyOnceWith({ dailyLimit: 12, expectedUpdatedAt: original.updatedAt })
  })
  it('keeps conflict barriers across failed or superseded reloads and clears them only after a successful explicit reload', async () => {
    mount(); await flush(); await fireEvent.click(toggle()); await fireEvent.update(input(), '12')
    writes.mockResolvedValueOnce(response(null, 900215)); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('dailyCreateQuota.conflict')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    await fireEvent.submit(form()); expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    reads.mockRejectedValueOnce(new Error('offline')); await fireEvent.click(button('reload')); await flush()
    expect(screen.getByText('dailyCreateQuota.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.update(input(), '13')
    pending.resolve(response(saved)); await flush(); expect(input().value).toBe('13'); expect(button('save').disabled).toBe(true)
    reads.mockResolvedValueOnce(response(saved)); await fireEvent.click(button('reload')); await flush()
    expect(input().value).toBe('7'); expect(button('save').disabled).toBe(false)
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenLastCalledWith({ dailyLimit: 7, expectedUpdatedAt: saved.updatedAt })
  })
  it.each(['transport', 'invalid', 'business'] as const)('blocks edits and duplicate operations during a save, preserves a %s failure, and retries only explicitly', async kind => {
    const { draft } = controller(); await flush(); draft.setEnabled(true); draft.edit('12')
    const pending = createDeferred<Response>(); writes.mockReturnValueOnce(pending.promise)
    const saving = draft.save(); draft.edit('99'); draft.setEnabled(false); await draft.save(); await draft.load()
    expect(draft.state.limit).toBe('12'); expect(draft.state.enabled).toBe(true)
    if (kind === 'transport') pending.reject(new Error('offline'))
    else pending.resolve(response(null, kind === 'invalid' ? 900214 : 100001))
    await saving; expect(draft.state.feedback).toBe('saveFailed'); expect(draft.state.saving).toBe(false)
    expect(draft.state.limit).toBe('12'); expect(draft.state.version).toBe(original.updatedAt)
    expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    await draft.save(); expect(draft.state.limit).toBe('7')
  })
  it.each([120001, 401, 403].flatMap(code => (['load', 'save'] as const).map(operation => ({ code, operation }))))('clears the current $operation denial $code before authentication recovery finishes', async ({ code, operation }) => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { draft } = controller(); await flush(); draft.setEnabled(true); draft.edit('12')
    if (operation === 'load') reads.mockResolvedValueOnce(denied(code)); else writes.mockResolvedValueOnce(denied(code))
    await draft[operation](); expect(draft.state.allowed).toBe(false); expect(draft.state.limit).toBe('0'); expect(draft.state.version).toBe('')
    expect(client.getQueriesData({ queryKey: adminAccountDailyCreateQuotaKey })).toEqual([])
    expect(authReads).toHaveBeenCalledTimes(1)
    recovery.reject(new Error('offline')); await flush(); expect(draft.state.allowed).toBe(false)
  })
  it('loads confirmed policy after current authorization recovery without retrying the rejected save', async () => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { draft } = controller(); await flush(); draft.setEnabled(true); draft.edit('12')
    writes.mockResolvedValueOnce(denied(120001)); await draft.save()
    expect(draft.state.allowed).toBe(false); expect(draft.state.version).toBe('')
    reads.mockResolvedValueOnce(response(saved))
    recovery.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'admin', permissions: ['admin:access', 'system:manage'] } }))
    await flush()
    expect(draft.state.allowed).toBe(true); expect(draft.state.limit).toBe('7')
    expect(draft.state.version).toBe(saved.updatedAt); expect(draft.state.feedback).toBe('')
    expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(2)
  })
  it.each(['account', 'relogin', 'permissions'] as const)('ignores an old authorization recovery after a newer %s notification', async change => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { draft } = controller(); await flush()
    writes.mockResolvedValueOnce(denied(120001)); await draft.save()
    if (change === 'account') auth('admin-b')
    else if (change === 'relogin') { auth('', []); auth() }
    else auth('admin-a', ['admin:access'])
    await flush()
    recovery.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'admin', permissions: ['admin:access', 'system:manage'] } }))
    await flush()
    expect(client.getQueryData(['auth', 'me'])).toMatchObject({ user: { id: change === 'account' ? 'admin-b' : 'admin-a', permissions: change === 'permissions' ? ['admin:access'] : ['admin:access', 'system:manage'] } })
    expect(draft.state.allowed).toBe(change !== 'permissions')
    expect(draft.state.version).toBe(change === 'permissions' ? '' : original.updatedAt)
    expect(writes).toHaveBeenCalledTimes(1)
  })
  it.each(['load', 'save'] as const)('rechecks identity when a synchronous %s cache listener switches accounts', async operation => {
    const { draft } = controller(); await flush(); draft.setEnabled(true); draft.edit('12')
    const next = createDeferred<Response>(); let switched = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!switched && event.query.queryKey[0] === adminAccountDailyCreateQuotaKey[0] && (event.query.state.data as typeof saved)?.updatedAt === saved.updatedAt) {
        switched = true; reads.mockReturnValueOnce(next.promise); auth('admin-b')
      }
    })
    try {
      if (operation === 'load') reads.mockResolvedValueOnce(response(saved))
      await draft[operation](); await flush()
      expect(switched).toBe(true); expect(draft.state.loading).toBe(true)
      expect(draft.state.limit).toBe('0'); expect(draft.state.version).toBe(''); expect(draft.state.feedback).toBe('')
      expect(client.getQueriesData({ queryKey: adminAccountDailyCreateQuotaKey }).map(([, value]) => value).filter(value => value !== undefined)).toEqual([])
      next.resolve(response(original)); await flush()
      expect(draft.state.version).toBe(original.updatedAt); expect(draft.state.enabled).toBe(false)
    } finally { unsubscribe() }
  })
  const races = (['load', 'save'] as const).flatMap(operation => (['success', 'transport', 'denial', 'conflict'] as const).flatMap(outcome => (['account', 'relogin', 'permissions', 'unmount'] as const).map(change => ({ operation, outcome, change }))))
  it.each(races)('retires every old $operation $outcome continuation across $change', async ({ operation, outcome, change }) => {
    const { draft, unmount } = controller(); await flush(); draft.setEnabled(true); draft.edit('12')
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise); else writes.mockReturnValueOnce(pending.promise)
    const attempt = draft[operation]()
    reads.mockResolvedValueOnce(response(saved))
    if (change === 'unmount') unmount()
    else if (change === 'permissions') auth('admin-a', [])
    else if (change === 'account') auth('admin-b')
    else { auth('', []); auth() }
    await flush()
    if (outcome === 'transport') pending.reject(new Error('offline'))
    else pending.resolve(outcome === 'denial' ? denied(120001) : outcome === 'conflict' ? response(null, 900215) : response({ dailyLimit: 999, updatedAt: original.updatedAt }))
    await attempt; await flush()
    const allowed = change === 'account' || change === 'relogin'
    expect(draft.state.allowed).toBe(allowed); expect(draft.state.limit).toBe(allowed ? '7' : '0')
    expect(draft.state.version).toBe(allowed ? saved.updatedAt : '')
    expect(draft.state.feedback).toBe(''); expect(draft.state.loading).toBe(false); expect(draft.state.saving).toBe(false)
    expect(authReads).not.toHaveBeenCalled()
    expect(client.getQueriesData({ queryKey: adminAccountDailyCreateQuotaKey }).map(([, value]) => value)).toEqual(allowed ? [saved] : [])
  })
  it('shows load and ordinary save errors in the actual card while preserving editable values', async () => {
    reads.mockRejectedValueOnce(new Error('offline')); mount(); await flush()
    expect(screen.getByText('dailyCreateQuota.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    await fireEvent.click(button('reload')); await flush(); await fireEvent.click(toggle()); await fireEvent.update(input(), '12')
    writes.mockRejectedValueOnce(new Error('offline')); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('dailyCreateQuota.saveFailed')).toBeTruthy(); expect(input().value).toBe('12')
    expect(button('save').disabled).toBe(false)
  })
  it.each([['zh-CN', '账号每日创建配额', '限制每日创建数量'], ['en', 'Account daily creation quota', 'Limit daily creation']] as const)('renders %s scope, UTC and zero-limit guidance', async (locale, heading, label) => {
    mount(locale); await flush()
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: label })).toBeTruthy()
    expect(screen.getByText(/UTC/)).toBeTruthy(); expect(screen.getByText(locale === 'en' ? /Administrators/ : /管理员/)).toBeTruthy()
    expect(screen.getByText(locale === 'en' ? /0 blocks/ : /0 表示禁止/)).toBeTruthy()
  })
})
