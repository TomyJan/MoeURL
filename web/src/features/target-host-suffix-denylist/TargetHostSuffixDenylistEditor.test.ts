import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { setImmediate } from 'node:timers'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { adminTargetHostSuffixDenylistKey } from '@/entities/target-host-suffix-denylist/api'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import TargetHostSuffixDenylistEditor from './TargetHostSuffixDenylistEditor.vue'
import { useTargetHostSuffixDenylistDraft } from './useTargetHostSuffixDenylistDraft'

const original = { suffixes: ['blocked.example'], updatedAt: '2026-11-11T05:00:00.123456Z' }
const saved = { suffixes: ['new.example'], updatedAt: '2026-11-11T05:00:01.654321Z' }
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: code ? 'private error' : 'OK', data, meta: {} }))
const authReads = vi.fn<() => Promise<Response>>()
const reads = vi.fn<() => Promise<Response>>()
const writes = vi.fn<(body: unknown) => Promise<Response>>()
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
let client: QueryClient
function auth(id = 'admin-a', permissions = ['admin:access', 'system:manage']) {
  client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', group: id ? 'admin' : 'guest', permissions } })
}
function mount(locale: 'en' | 'zh-CN' | 'keys' = 'keys') {
  const i18n = createI18n({ legacy: false, locale, fallbackLocale: false, missingWarn: false, fallbackWarn: false, messages: locale === 'keys' ? {} : messages })
  return render(TargetHostSuffixDenylistEditor, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
}
const form = () => screen.getByRole('form', { name: 'targetSuffixPolicy.form' })
const button = (name: string) => screen.getByRole('button', { name: 'targetSuffixPolicy.' + name }) as HTMLButtonElement
const suffixes = () => screen.queryAllByRole('textbox', { name: /^targetSuffixPolicy.host / }) as HTMLInputElement[]
function mountController() {
  let controller!: ReturnType<typeof useTargetHostSuffixDenylistDraft>
  const view = render(defineComponent({ setup() { controller = useTargetHostSuffixDenylistDraft(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, controller }
}
async function ready(host = 'blocked.example') {
  await nextTick(); await flush()
  expect(suffixes()[0]?.value).toBe(host); expect(button('save').disabled).toBe(false)
}
describe('independent target policy draft', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
    client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
    authReads.mockReset().mockImplementation(async () => response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } }))
    reads.mockReset().mockImplementation(async () => response(original))
    writes.mockReset().mockImplementation(async () => response(saved))
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      if (path === '/api/v1/auth/me' && init.method === 'GET') return authReads()
      if (path === '/api/v1/admin/system/target-host-suffix-denylist' && init.method === 'GET') return reads()
      if (path === '/api/v1/admin/system/target-host-suffix-denylist/update' && init.method === 'POST') return writes(JSON.parse(String(init.body)))
      throw new Error('Unexpected transport: ' + path)
    })
    auth()
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })
  it('keeps unsorted raw edits local and replaces them only with the canonical saved response', async () => {
    mount(); await ready()
    await fireEvent.update(suffixes()[0]!, ' Z.example. '); await fireEvent.click(button('add'))
    await fireEvent.update(suffixes()[1]!, 'A.EXAMPLE')
    expect(suffixes().map(input => input.value)).toEqual([' Z.example. ', 'A.EXAMPLE'])
    expect(client.getQueriesData({ queryKey: adminTargetHostSuffixDenylistKey }).map(([, data]) => data)).toContainEqual(original)
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ suffixes: [' Z.example. ', 'A.EXAMPLE'], expectedUpdatedAt: original.updatedAt })
    expect(suffixes().map(input => input.value)).toEqual(['new.example']); expect(screen.getByText('targetSuffixPolicy.saved')).toBeTruthy()
    await fireEvent.update(suffixes()[0]!, 'another.example')
    expect(screen.queryByText('targetSuffixPolicy.saved')).toBeNull()
  })
  it('adds only 100 rows, marks invalid blank input, removes rows and explicitly saves an empty list', async () => {
    reads.mockImplementationOnce(async () => response({ ...original, suffixes: Array.from({ length: 99 }, (_, i) => `h${String(i).padStart(3, '0')}.example`) }))
    mount(); await flush(); expect(suffixes()).toHaveLength(99)
    await fireEvent.click(button('add')); expect(suffixes()).toHaveLength(100); expect(button('add').disabled).toBe(true)
    await fireEvent.click(button('add')); expect(suffixes()).toHaveLength(100)
    await fireEvent.submit(form()); expect(screen.getByText('targetSuffixPolicy.invalid')).toBeTruthy(); expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(button('remove 100')); expect(suffixes()).toHaveLength(99)
    await fireEvent.click(button('clear')); expect(suffixes()).toHaveLength(0); expect(writes).not.toHaveBeenCalled()
    writes.mockResolvedValueOnce(response({ ...saved, suffixes: [] }))
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ suffixes: [], expectedUpdatedAt: original.updatedAt }); expect(suffixes()).toHaveLength(0)
  })
  it('keeps initial failures retryable and blocks any write before a confirmed version', async () => {
    reads.mockRejectedValueOnce(new Error('offline')); mount(); await flush()
    expect(screen.getByText('targetSuffixPolicy.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    await fireEvent.submit(form()); expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(button('reload')); await ready()
  })
  it('clears private rows when the authentication cache disappears and stays closed before login', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    mount(); await flush()
    expect(screen.queryByRole('form')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
    await fireEvent.update(suffixes()[0]!, 'private.example')
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    await nextTick()
    expect(screen.queryByRole('form')).toBeNull()
    expect(client.getQueriesData({ queryKey: adminTargetHostSuffixDenylistKey })).toEqual([])
    auth(); await ready()
    expect(suffixes()[0]!.value).toBe('blocked.example')
  })
  it('preserves edits when the same account refreshes an equivalent permission set', async () => {
    mount(); await ready()
    await fireEvent.update(suffixes()[0]!, 'draft.example')
    auth('admin-a', ['system:manage', 'admin:access']); await flush()
    expect(suffixes()[0]!.value).toBe('draft.example'); expect(reads).toHaveBeenCalledTimes(1)
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ suffixes: ['draft.example'], expectedUpdatedAt: original.updatedAt })
  })
  it('shows a save failure and keeps the editable draft available for an explicit retry', async () => {
    writes.mockRejectedValueOnce(new Error('offline')); mount(); await ready()
    await fireEvent.update(suffixes()[0]!, 'draft.example'); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetSuffixPolicy.saveFailed')).toBeTruthy()
    expect(suffixes()[0]!.value).toBe('draft.example'); expect(button('save').disabled).toBe(false)
    expect(writes).toHaveBeenCalledTimes(1)
    await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetSuffixPolicy.saved')).toBeTruthy(); expect(suffixes()[0]!.value).toBe('new.example')
  })
  it('does not load, edit or save without an identity, and clears private state immediately on revocation', async () => {
    auth('', [])
    const { controller } = mountController()
    controller.edit(0, 'forbidden.example'); controller.add(); controller.remove(0); controller.clear(); await controller.save(); await flush()
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(controller.state.rows).toEqual([])
    auth(); await flush(); expect(controller.state.rows[0]!.host).toBe('blocked.example')
    auth('admin-a', [])
    expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe(''); expect(controller.state.allowed).toBe(false)
    expect(client.getQueriesData({ queryKey: adminTargetHostSuffixDenylistKey })).toEqual([])
  })
  it('keeps a conflict barrier after a failed reload and only clears it when new server data is applied', async () => {
    writes.mockResolvedValueOnce(response(null, 900217)); mount(); await ready()
    await fireEvent.submit(form()); await flush()
    reads.mockRejectedValueOnce(new Error('offline')); await fireEvent.click(button('reload')); await flush()
    expect(screen.getByText('targetSuffixPolicy.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    expect(suffixes()[0]!.value).toBe('blocked.example'); expect(writes).toHaveBeenCalledTimes(1)
    await fireEvent.click(button('reload')); await ready()
  })
  it('preserves a conflict draft and requires an explicit applied reload without automatic reads or writes', async () => {
    writes.mockResolvedValueOnce(response(null, 900217)); mount(); await ready()
    await fireEvent.update(suffixes()[0]!, 'draft.example'); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetSuffixPolicy.conflict')).toBeTruthy(); expect(suffixes()[0]!.value).toBe('draft.example')
    await fireEvent.submit(form()); expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.update(suffixes()[0]!, 'newer.example')
    pending.resolve(response(saved)); await flush()
    expect(suffixes()[0]!.value).toBe('newer.example'); expect(button('save').disabled).toBe(true)
    reads.mockResolvedValueOnce(response(saved)); await fireEvent.click(button('reload')); await ready('new.example')
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenLastCalledWith({ suffixes: saved.suffixes, expectedUpdatedAt: saved.updatedAt })
  })
  it('rejects structural edits and duplicate operations during reload but keeps newer typing', async () => {
    mount(); await ready(); const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.click(button('reload')); await fireEvent.submit(form())
    for (const action of ['add', 'clear', 'remove 1']) expect(button(action).disabled).toBe(true)
    await fireEvent.click(button('clear')); await fireEvent.click(button('remove 1')); await fireEvent.click(button('add'))
    await fireEvent.update(suffixes()[0]!, 'typed.example'); pending.resolve(response(saved)); await flush()
    expect(suffixes()[0]!.value).toBe('typed.example'); expect(writes).not.toHaveBeenCalled(); expect(reads).toHaveBeenCalledTimes(2)
  })
  it.each(['transport', 'business', 'invalid'] as const)('blocks all edits while saving and retains a %s failure without automatic retry', async kind => {
    const { controller } = mountController()
    await flush(); controller.edit(0, 'draft.example')
    const pending = createDeferred<Response>(); writes.mockReturnValueOnce(pending.promise)
    const saving = controller.save()
    controller.edit(0, 'forbidden.example'); controller.clear(); controller.remove(0); controller.add(); void controller.load(); void controller.save()
    expect(controller.state.rows.map(row => row.host)).toEqual(['draft.example'])
    if (kind === 'transport') pending.reject(new Error('offline'))
    else pending.resolve(response(null, kind === 'business' ? 100001 : 900216))
    await saving
    expect(controller.state.feedback).toBe('saveFailed'); expect(controller.state.saving).toBe(false)
    expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    expect(controller.state.rows[0]!.host).toBe('draft.example')
    await controller.save(); expect(controller.state.rows[0]!.host).toBe('new.example')
  })
  const denials = [120001, 401, 403].flatMap(code => (['load', 'save'] as const).map(operation => ({ code, operation })))
  const denial = (code: number) => code === 120001 ? response(null, code) : new Response('', { status: code })
  it.each(denials)('clears private data on current $operation denial $code before authentication recovery', async ({ code, operation }) => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { controller } = mountController(); await flush(); controller.edit(0, 'private.example')
    if (operation === 'load') reads.mockResolvedValueOnce(denial(code))
    else writes.mockResolvedValueOnce(denial(code))
    await controller[operation](); await flush()
    expect(controller.state.allowed).toBe(false)
    expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe('')
    expect(controller.state.loading).toBe(false); expect(controller.state.saving).toBe(false)
    expect(controller.state.feedback).toBe('')
    expect(client.getQueriesData({ queryKey: adminTargetHostSuffixDenylistKey })).toEqual([])
    expect(authReads).toHaveBeenCalledTimes(1)
    const attempts = { read: reads.mock.calls.length, write: writes.mock.calls.length }
    controller.add(); controller.edit(0, 'forbidden.example'); controller.clear(); controller.remove(0)
    await controller.load(); await controller.save()
    expect(reads).toHaveBeenCalledTimes(attempts.read); expect(writes).toHaveBeenCalledTimes(attempts.write)
    recovery.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } }))
    await flush(); expect(controller.state.allowed).toBe(false); expect(controller.state.rows).toEqual([])
  })
  it('keeps denied grants cleared if the authentication recovery fails', async () => {
    authReads.mockRejectedValueOnce(new Error('offline'))
    const { controller } = mountController(); await flush()
    writes.mockResolvedValueOnce(denial(120001)); await controller.save(); await flush()
    expect(controller.state.allowed).toBe(false); expect(controller.state.rows).toEqual([])
    expect(client.getQueriesData({ queryKey: adminTargetHostSuffixDenylistKey })).toEqual([])
    await controller.save(); expect(writes).toHaveBeenCalledTimes(1)
  })
  it.each(['account', 'relogin', 'permissions'] as const)('does not apply an old authentication recovery after a newer %s notification', async kind => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { controller } = mountController(); await flush()
    writes.mockResolvedValueOnce(denial(120001)); await controller.save(); await flush()
    expect(controller.state.allowed).toBe(false)
    if (kind === 'account') auth('admin-b')
    else if (kind === 'relogin') { auth('', []); auth() }
    else auth('admin-a', ['system:manage'])
    await flush()
    recovery.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'admin', permissions: ['admin:access', 'system:manage'] } }))
    await flush()
    expect(client.getQueryData(['auth', 'me'])).toMatchObject({ user: { id: kind === 'account' ? 'admin-b' : 'admin-a', permissions: kind === 'permissions' ? ['system:manage'] : ['admin:access', 'system:manage'] } })
    expect(controller.state.allowed).toBe(kind !== 'permissions')
    expect(controller.state.rows.map(row => row.host)).toEqual(kind === 'permissions' ? [] : original.suffixes)
    expect(writes).toHaveBeenCalledTimes(1)
  })
  it('loads fresh policy only after this identity regains confirmed grants, without retrying the rejected write', async () => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { controller } = mountController(); await flush(); controller.edit(0, 'private.example')
    writes.mockResolvedValueOnce(denial(120001)); await controller.save(); await flush()
    expect(controller.state.rows).toEqual([])
    reads.mockResolvedValueOnce(response(saved))
    recovery.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'admin', permissions: ['admin:access', 'system:manage'] } }))
    await flush()
    expect(controller.state.allowed).toBe(true); expect(controller.state.rows.map(row => row.host)).toEqual(saved.suffixes)
    expect(controller.state.version).toBe(saved.updatedAt); expect(writes).toHaveBeenCalledTimes(1)
  })

  it.each([{ permissions: [] }, { permissions: ['admin:access'] }, { permissions: ['system:manage'] }])('requires both current permissions $permissions', async ({ permissions }) => {
    auth('admin-a', permissions); mount(); await flush()
    expect(screen.queryByRole('form')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
  })
  const transitions = ['account', 'relogin', 'admin:access', 'system:manage'] as const
  function transition(kind: typeof transitions[number]) {
    if (kind === 'account') auth('admin-b')
    else if (kind === 'relogin') { auth('', []); auth() }
    else { auth('admin-a', ['admin:access', 'system:manage'].filter(value => value !== kind)); auth() }
  }
  const matrix = transitions.flatMap(kind => ['load', 'save'].flatMap(operation => ['resolve', 'reject', 'denied', ...(operation === 'save' ? ['conflict'] : [])].map(outcome => ({ kind, operation, outcome }))))
  it.each(matrix)('retires $kind $operation $outcome before cache, draft, feedback and finally', async ({ kind, operation, outcome }) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    else writes.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    transition(kind); await flush()
    if (operation === 'save') { await ready(); await fireEvent.update(suffixes()[0]!, 'current.example'); await fireEvent.submit(form()) }
    if (outcome === 'reject') old.reject(new Error('stale')); else if (outcome === 'denied') old.resolve(denial(120001)); else old.resolve(response(outcome === 'conflict' ? null : saved, outcome === 'conflict' ? 900217 : 0))
    await flush()
    expect(button('save').disabled).toBe(true); expect(button('reload').disabled).toBe(true)
    for (const feedback of ['saved', 'conflict', 'saveFailed', 'loadFailed']) expect(screen.queryByText('targetSuffixPolicy.' + feedback)).toBeNull()
    expect(client.getQueriesData({ queryKey: adminTargetHostSuffixDenylistKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(false)
    if (operation === 'load') expect(suffixes()).toHaveLength(0); else expect(suffixes()[0]!.value).toBe('current.example')
    expect(authReads).not.toHaveBeenCalled()
    current.resolve(response(operation === 'load' ? original : saved)); await flush()
    if (operation === 'load') await ready(); else expect(screen.getByText('targetSuffixPolicy.saved')).toBeTruthy()
  })
  it.each(['load', 'save'] as const)('rechecks identity after synchronous %s cache listeners switch accounts', async operation => {
    const current = createDeferred<Response>(); let switched = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!switched && event.query.queryKey[0] === adminTargetHostSuffixDenylistKey[0] && (event.query.state.data as typeof saved)?.updatedAt === saved.updatedAt) {
        switched = true; reads.mockReturnValueOnce(current.promise); auth('admin-b')
      }
    })
    if (operation === 'load') reads.mockResolvedValueOnce(response(saved))
    mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    await flush(); expect(switched).toBe(true); expect(suffixes()).toHaveLength(0); expect(button('save').disabled).toBe(true)
    expect(screen.queryByText('targetSuffixPolicy.saved')).toBeNull()
    current.resolve(response(original)); await ready(); unsubscribe()
  })
  it.each(['load', 'save'].flatMap(operation => ['resolve', 'reject'].map(outcome => ({ operation, outcome }))))('clears private data on unmount during $operation $outcome', async ({ operation, outcome }) => {
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise); else writes.mockReturnValueOnce(pending.promise)
    const view = mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    view.unmount()
    if (outcome === 'resolve') pending.resolve(response(saved)); else pending.reject(new Error('unmounted'))
    await flush(); expect(client.getQueriesData({ queryKey: adminTargetHostSuffixDenylistKey })).toEqual([])
  })
  it.each(['en', 'zh-CN'] as const)('shows usable %s controls, suffix scope and deny-before-allow priority with real translations', async locale => {
    mount(locale); await flush()
    expect(screen.getByRole('heading', { name: locale === 'en' ? 'Blocked target host suffixes' : '目标 DNS 后缀黑名单' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: locale === 'en' ? 'DNS suffix 1' : 'DNS 后缀 1' })).toHaveProperty('value', 'blocked.example')
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Clear list' : '清空列表' })).toBeTruthy()
    expect(screen.getByText(locale === 'en' ? /subdomains at every depth/ : /所有层级的子域/)).toBeTruthy()
    expect(screen.getByText(locale === 'en' ? /Exact and suffix denial take priority over both allow rules/ : /精确及后缀拒绝均优先于两种允许规则/)).toBeTruthy()
    expect(screen.getByText(locale === 'en' ? /com blocks all new \.com targets and changes to \.com targets/ : /com 会拒绝所有新的 \.com 目标及改为 \.com 的目标/)).toBeTruthy()
  })
})
