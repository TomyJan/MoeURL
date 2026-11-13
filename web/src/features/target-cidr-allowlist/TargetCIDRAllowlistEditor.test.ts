import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { setImmediate } from 'node:timers'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { adminTargetCIDRAllowlistKey } from '@/entities/target-cidr-allowlist/api'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import TargetCIDRAllowlistEditor from './TargetCIDRAllowlistEditor.vue'
import { useTargetCIDRAllowlistDraft } from './useTargetCIDRAllowlistDraft'

const original = { enabled: false, prefixes: ['192.0.2.0/24'], updatedAt: '2026-11-11T05:00:00.123456Z' }
const saved = { enabled: true, prefixes: ['203.0.113.0/24'], updatedAt: '2026-11-11T05:00:01.654321Z' }
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
  return render(TargetCIDRAllowlistEditor, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
}
const toggle = () => screen.getByRole('checkbox', { name: 'targetCIDRAllowlist.enabled' }) as HTMLInputElement
const form = () => screen.getByRole('form', { name: 'targetCIDRAllowlist.form' })
const button = (name: string) => screen.getByRole('button', { name: 'targetCIDRAllowlist.' + name }) as HTMLButtonElement
const prefixes = () => screen.queryAllByRole('textbox', { name: /^targetCIDRAllowlist.prefix / }) as HTMLInputElement[]
function mountController() {
  let controller!: ReturnType<typeof useTargetCIDRAllowlistDraft>
  const view = render(defineComponent({ setup() { controller = useTargetCIDRAllowlistDraft(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, controller }
}
async function ready(prefix = '192.0.2.0/24') {
  await nextTick(); await flush()
  expect(prefixes()[0]?.value).toBe(prefix); expect(button('save').disabled).toBe(false)
}
describe('independent optional target allowlist draft', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
    client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
    authReads.mockReset().mockImplementation(async () => response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } }))
    reads.mockReset().mockImplementation(async () => response(original))
    writes.mockReset().mockImplementation(async () => response(saved))
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      if (path === '/api/v1/auth/me' && init.method === 'GET') return authReads()
      if (path === '/api/v1/admin/system/target-cidr-allowlist' && init.method === 'GET') return reads()
      if (path === '/api/v1/admin/system/target-cidr-allowlist/update' && init.method === 'POST') return writes(JSON.parse(String(init.body)))
      throw new Error('Unexpected transport: ' + path)
    })
    auth()
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

  it.each(['addition', 'removal'].flatMap(change => ['edited', 'conflict', 'unknown'].map(barrier => ({ change, barrier }))))('policy confirmation preserves $barrier draft across unrelated permission $change without reading', async ({ change, barrier }) => {
    if (change === 'removal') auth('admin-a', ['admin:access', 'system:manage', 'short_link:read_all'])
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.1/32')
    if (barrier === 'conflict') { writes.mockResolvedValueOnce(response(null, 900225)); await controller.save() }
    if (barrier === 'unknown') { writes.mockRejectedValueOnce(new Error('lost response')); await controller.save() }
    const before = { feedback: controller.state.feedback, blocked: controller.state.reloadRequired, reads: reads.mock.calls.length }
    auth('admin-a', ['admin:access', 'system:manage', ...(change === 'addition' ? ['short_link:read_all'] : [])])
    await flush()
    expect(controller.state.rows[0]?.prefix).toBe('198.51.100.1/32'); expect(controller.state.version).toBe(original.updatedAt)
    expect(controller.state.feedback).toBe(before.feedback); expect(controller.state.reloadRequired).toBe(before.blocked)
    expect(reads).toHaveBeenCalledTimes(before.reads)
    if (barrier !== 'edited') { await controller.save(); expect(writes).toHaveBeenCalledTimes(1) }
  })
  it.each(['addition', 'removal'].flatMap(change => (['load', 'save'] as const).map(operation => ({ change, operation }))))('policy confirmation preserves pending $operation across unrelated permission $change', async ({ change, operation }) => {
    if (change === 'removal') auth('admin-a', ['admin:access', 'system:manage', 'short_link:read_all'])
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.1/32')
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise)
    else writes.mockReturnValueOnce(pending.promise)
    const running = controller[operation]()
    const attempts = reads.mock.calls.length
    auth('admin-a', ['admin:access', 'system:manage', ...(change === 'addition' ? ['short_link:read_all'] : [])])
    expect(controller.state.rows[0]?.prefix).toBe('198.51.100.1/32')
    expect(controller.state[operation === 'load' ? 'loading' : 'saving']).toBe(true)
    pending.resolve(response(saved)); await running; await flush()
    expect(reads).toHaveBeenCalledTimes(attempts)
    expect(controller.state.rows[0]?.prefix).toBe('203.0.113.0/24'); expect(controller.state.version).toBe(saved.updatedAt)
    expect(controller.state.feedback).toBe(operation === 'save' ? 'saved' : '')
    expect(controller.state.loading).toBe(false); expect(controller.state.saving).toBe(false)
  })
  it('keeps unsorted raw edits local and replaces them only with the canonical saved response', async () => {
    mount(); await ready()
    await fireEvent.update(prefixes()[0]!, ' 2001:0DB8:0:0::1/48 '); await fireEvent.click(button('add'))
    await fireEvent.update(prefixes()[1]!, '192.0.2.129/24')
    expect(prefixes().map(input => input.value)).toEqual([' 2001:0DB8:0:0::1/48 ', '192.0.2.129/24'])
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey }).map(([, data]) => data)).toContainEqual(original)
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ enabled: false, prefixes: [' 2001:0DB8:0:0::1/48 ', '192.0.2.129/24'], expectedUpdatedAt: original.updatedAt })
    expect(prefixes().map(input => input.value)).toEqual(['203.0.113.0/24']); expect(screen.getByText('targetCIDRAllowlist.saved')).toBeTruthy()
    await fireEvent.update(prefixes()[0]!, '198.51.100.2/32')
    expect(screen.queryByText('targetCIDRAllowlist.saved')).toBeNull()
  })
  it('adds only 100 rows, marks invalid blank input, removes rows and explicitly saves an empty list', async () => {
    reads.mockImplementationOnce(async () => response({ ...original, prefixes: Array.from({ length: 99 }, (_, i) => `192.0.2.${i}/32`).sort() }))
    mount(); await flush(); expect(prefixes()).toHaveLength(99)
    await fireEvent.click(button('add')); expect(prefixes()).toHaveLength(100); expect(button('add').disabled).toBe(true)
    await fireEvent.click(button('add')); expect(prefixes()).toHaveLength(100)
    await fireEvent.submit(form()); expect(screen.getByText('targetCIDRAllowlist.invalid')).toBeTruthy(); expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(button('remove 100')); expect(prefixes()).toHaveLength(99)
    await fireEvent.click(button('clear')); expect(prefixes()).toHaveLength(0); expect(writes).not.toHaveBeenCalled()
    writes.mockResolvedValueOnce(response({ ...saved, enabled: false, prefixes: [] }))
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ enabled: false, prefixes: [], expectedUpdatedAt: original.updatedAt }); expect(prefixes()).toHaveLength(0)
  })
  it('refuses switch edits before a confirmed initial version', async () => {
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    const { controller } = mountController()
    controller.setEnabled(true)
    expect(controller.state.enabled).toBe(false); expect(controller.state.version).toBe('')
    expect(writes).not.toHaveBeenCalled()
    pending.resolve(response(original)); await flush()
    controller.setEnabled(true); expect(controller.state.enabled).toBe(true)
  })
  it('keeps initial failures retryable and blocks any write before a confirmed version', async () => {
    reads.mockRejectedValueOnce(new Error('offline')); mount(); await flush()
    expect(screen.getByText('targetCIDRAllowlist.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    await fireEvent.submit(form()); expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(button('reload')); await ready()
  })
  it('clears private rows when the authentication cache disappears and stays closed before login', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    mount(); await flush()
    expect(screen.queryByRole('form')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
    await fireEvent.update(prefixes()[0]!, '198.51.100.1/32')
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    await nextTick()
    expect(screen.queryByRole('form')).toBeNull()
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey })).toEqual([])
    auth(); await ready()
    expect(prefixes()[0]!.value).toBe('192.0.2.0/24')
  })
  it('preserves edits when the same account refreshes an equivalent permission set', async () => {
    mount(); await ready()
    await fireEvent.update(prefixes()[0]!, '198.51.100.3/32')
    auth('admin-a', ['system:manage', 'admin:access']); await flush()
    expect(prefixes()[0]!.value).toBe('198.51.100.3/32'); expect(reads).toHaveBeenCalledTimes(1)
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ enabled: false, prefixes: ['198.51.100.3/32'], expectedUpdatedAt: original.updatedAt })
  })
  it('keeps a confirmed input rejection editable for an explicit corrected retry', async () => {
    writes.mockResolvedValueOnce(response(null, 900224)); mount(); await ready()
    await fireEvent.update(prefixes()[0]!, '198.51.100.3/32'); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetCIDRAllowlist.saveFailed')).toBeTruthy()
    expect(prefixes()[0]!.value).toBe('198.51.100.3/32'); expect(button('save').disabled).toBe(false)
    expect(writes).toHaveBeenCalledTimes(1)
    await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetCIDRAllowlist.saved')).toBeTruthy(); expect(prefixes()[0]!.value).toBe('203.0.113.0/24')
  })
  it.each(['transport', 'http500', 'invalid-envelope', 'invalid-data', 'business'] as const)('requires an applied explicit reload after an unknown %s save result', async kind => {
    reads.mockResolvedValueOnce(response({ ...original, enabled: true }))
    if (kind === 'transport') writes.mockRejectedValueOnce(new Error('response lost'))
    else if (kind === 'http500') writes.mockResolvedValueOnce(new Response('', { status: 500 }))
    else if (kind === 'invalid-envelope') writes.mockResolvedValueOnce(new Response('not JSON'))
    else if (kind === 'invalid-data') writes.mockResolvedValueOnce(response({ enabled: false }))
    else writes.mockResolvedValueOnce(response(null, 100001))
    mount(); await ready(); await fireEvent.click(toggle())
    await fireEvent.update(prefixes()[0]!, '198.51.100.3/32'); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetCIDRAllowlist.saveUnknown')).toBeTruthy()
    expect(screen.queryByText('targetCIDRAllowlist.saveFailed')).toBeNull()
    expect(toggle().checked).toBe(false); expect(prefixes()[0]!.value).toBe('198.51.100.3/32')
    expect(button('save').disabled).toBe(true)
    await fireEvent.submit(form()); expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    reads.mockRejectedValueOnce(new Error('reload offline')); await fireEvent.click(button('reload')); await flush()
    expect(screen.getByText('targetCIDRAllowlist.saveUnknown')).toBeTruthy()
    expect(screen.queryByText('targetCIDRAllowlist.loadFailed')).toBeNull(); expect(button('save').disabled).toBe(true)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.update(prefixes()[0]!, '198.51.100.4/32')
    const confirmed = { ...saved, enabled: false, prefixes: ['198.51.100.0/24'] }
    pending.resolve(response(confirmed)); await flush()
    expect(prefixes()[0]!.value).toBe('198.51.100.4/32'); expect(button('save').disabled).toBe(true)
    expect(screen.getByText('targetCIDRAllowlist.saveUnknown')).toBeTruthy()
    reads.mockResolvedValueOnce(response(confirmed)); await fireEvent.click(button('reload')); await ready('198.51.100.0/24')
    expect(toggle().checked).toBe(false); expect(screen.queryByText('targetCIDRAllowlist.saveUnknown')).toBeNull()
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenLastCalledWith({ enabled: false, prefixes: ['198.51.100.0/24'], expectedUpdatedAt: saved.updatedAt })
    expect(screen.getByText('targetCIDRAllowlist.saved')).toBeTruthy()
  })
  it.each(['en', 'zh-CN'] as const)('explains the unknown save result persistently in %s and disables another write', async locale => {
    writes.mockRejectedValueOnce(new Error('response lost')); mount(locale); await flush()
    const save = screen.getByRole('button', { name: locale === 'en' ? 'Save allowed CIDRs' : '保存网段白名单' }) as HTMLButtonElement
    await fireEvent.click(save); await flush()
    expect(screen.getByText(locale === 'en' ? /Save result is unknown.*successful reload/ : /保存结果未确认.*核对成功前无法再次保存/)).toBeTruthy()
    expect(save.disabled).toBe(true)
  })
  it('does not load, edit or save without an identity, and clears private state immediately on revocation', async () => {
    auth('', [])
    const { controller } = mountController()
    controller.edit(0, '198.51.100.6/32'); controller.setEnabled(true); controller.add(); controller.remove(0); controller.clear(); await controller.save(); await flush()
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(controller.state.rows).toEqual([])
    auth(); await flush(); expect(controller.state.rows[0]!.prefix).toBe('192.0.2.0/24')
    auth('admin-a', [])
    expect(controller.state.enabled).toBe(false); expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe(''); expect(controller.state.allowed).toBe(false)
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey })).toEqual([])
  })
  it('keeps a conflict barrier after a failed reload and only clears it when new server data is applied', async () => {
    writes.mockResolvedValueOnce(response(null, 900225)); mount(); await ready()
    await fireEvent.submit(form()); await flush()
    reads.mockRejectedValueOnce(new Error('offline')); await fireEvent.click(button('reload')); await flush()
    expect(screen.getByText('targetCIDRAllowlist.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    expect(prefixes()[0]!.value).toBe('192.0.2.0/24'); expect(writes).toHaveBeenCalledTimes(1)
    await fireEvent.click(button('reload')); await ready()
  })
  it('preserves a conflict draft and requires an explicit applied reload without automatic reads or writes', async () => {
    writes.mockResolvedValueOnce(response(null, 900225)); mount(); await ready()
    await fireEvent.update(prefixes()[0]!, '198.51.100.3/32'); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetCIDRAllowlist.conflict')).toBeTruthy(); expect(prefixes()[0]!.value).toBe('198.51.100.3/32')
    await fireEvent.submit(form()); expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.update(prefixes()[0]!, '198.51.100.4/32')
    pending.resolve(response(saved)); await flush()
    expect(prefixes()[0]!.value).toBe('198.51.100.4/32'); expect(button('save').disabled).toBe(true)
    reads.mockResolvedValueOnce(response(saved)); await fireEvent.click(button('reload')); await ready('203.0.113.0/24')
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenLastCalledWith({ enabled: true, prefixes: saved.prefixes, expectedUpdatedAt: saved.updatedAt })
  })
  it('rejects structural edits and duplicate operations during reload but keeps newer typing', async () => {
    mount(); await ready(); const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.click(button('reload')); await fireEvent.submit(form())
    for (const action of ['add', 'clear', 'remove 1']) expect(button(action).disabled).toBe(true)
    await fireEvent.click(button('clear')); await fireEvent.click(button('remove 1')); await fireEvent.click(button('add'))
    await fireEvent.update(prefixes()[0]!, '198.51.100.5/32'); pending.resolve(response(saved)); await flush()
    expect(prefixes()[0]!.value).toBe('198.51.100.5/32'); expect(writes).not.toHaveBeenCalled(); expect(reads).toHaveBeenCalledTimes(2)
  })
  it.each(['transport', 'business', 'invalid'] as const)('blocks all edits while saving and retains a %s failure without automatic retry', async kind => {
    const { controller } = mountController()
    await flush(); controller.edit(0, '198.51.100.3/32')
    const pending = createDeferred<Response>(); writes.mockReturnValueOnce(pending.promise)
    const saving = controller.save()
    controller.edit(0, '198.51.100.6/32'); controller.setEnabled(true); controller.clear(); controller.remove(0); controller.add(); void controller.load(); void controller.save()
    expect(controller.state.enabled).toBe(false)
    expect(controller.state.rows.map(row => row.prefix)).toEqual(['198.51.100.3/32'])
    if (kind === 'transport') pending.reject(new Error('offline'))
    else pending.resolve(response(null, kind === 'business' ? 100001 : 900224))
    await saving
    expect(controller.state.feedback).toBe(kind === 'invalid' ? 'saveFailed' : 'saveUnknown'); expect(controller.state.saving).toBe(false)
    expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    expect(controller.state.rows[0]!.prefix).toBe('198.51.100.3/32')
    await controller.save()
    if (kind === 'invalid') expect(controller.state.rows[0]!.prefix).toBe('203.0.113.0/24')
    else { expect(writes).toHaveBeenCalledTimes(1); expect(controller.state.rows[0]!.prefix).toBe('198.51.100.3/32'); expect(controller.state.reloadRequired).toBe(true) }
  })
  it('retains prefixes when disabled and retains enabled when cleared, without sending implicit writes', async () => {
    mount(); await ready()
    expect(toggle().checked).toBe(false)
    await fireEvent.click(toggle()); expect(toggle().checked).toBe(true)
    await fireEvent.click(button('clear'))
    expect(prefixes()).toHaveLength(0); expect(toggle().checked).toBe(true)
    await fireEvent.submit(form())
    expect(screen.getByText('targetCIDRAllowlist.enabledEmpty')).toBeTruthy()
    expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(toggle())
    writes.mockResolvedValueOnce(response({ ...saved, enabled: false, prefixes: [] }))
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ enabled: false, prefixes: [], expectedUpdatedAt: original.updatedAt })
  })
  it('keeps a preconfigured list when switched off and takes enabled only from the confirmed response', async () => {
    // Retain the inactive private cache for this assertion instead of gcTime: 0.
    client.setQueryDefaults(adminTargetCIDRAllowlistKey, { gcTime: Infinity })
    reads.mockResolvedValueOnce(response({ ...original, enabled: true }))
    writes.mockResolvedValueOnce(response({ ...original, enabled: false }))
    mount(); await ready(); expect(toggle().checked).toBe(true)
    await fireEvent.click(toggle()); expect(prefixes()[0]!.value).toBe('192.0.2.0/24')
    expect(writes).not.toHaveBeenCalled()
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ enabled: false, prefixes: original.prefixes, expectedUpdatedAt: original.updatedAt })
    expect(toggle().checked).toBe(false); expect(prefixes()[0]!.value).toBe('192.0.2.0/24')
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey }).map(([, data]) => data)).toContainEqual({ ...original, enabled: false })
  })
  it('protects a switch edited during reload from a late server read', async () => {
    const { controller } = mountController(); await flush()
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    const loading = controller.load(); controller.setEnabled(true)
    pending.resolve(response({ ...saved, enabled: false })); await loading
    expect(controller.state.enabled).toBe(true)
    expect(controller.state.rows.map(row => row.prefix)).toEqual(original.prefixes)
    expect(controller.state.version).toBe(original.updatedAt)
    expect(controller.state.loading).toBe(false)
    await controller.save()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ enabled: true, prefixes: original.prefixes, expectedUpdatedAt: original.updatedAt })
    controller.setEnabled(false); expect(controller.state.feedback).toBe('')
  })

  const denials = [120001, 401, 403].flatMap(code => (['load', 'save'] as const).map(operation => ({ code, operation })))
  const denial = (code: number) => code === 120001 ? response(null, code) : new Response('', { status: code })
  it.each(denials)('clears private data on current $operation denial $code before authentication recovery', async ({ code, operation }) => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.1/32')
    if (operation === 'load') reads.mockResolvedValueOnce(denial(code))
    else writes.mockResolvedValueOnce(denial(code))
    await controller[operation](); await flush()
    expect(controller.state.allowed).toBe(false)
    expect(controller.state.enabled).toBe(false); expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe('')
    expect(controller.state.loading).toBe(false); expect(controller.state.saving).toBe(false)
    expect(controller.state.feedback).toBe('')
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey })).toEqual([])
    expect(authReads).toHaveBeenCalledTimes(1)
    const attempts = { read: reads.mock.calls.length, write: writes.mock.calls.length }
    controller.add(); controller.edit(0, '198.51.100.6/32'); controller.clear(); controller.remove(0)
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
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey })).toEqual([])
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
    expect(controller.state.rows.map(row => row.prefix)).toEqual(kind === 'permissions' ? [] : original.prefixes)
    expect(writes).toHaveBeenCalledTimes(1)
  })
  it('loads fresh policy only after this identity regains confirmed grants, without retrying the rejected write', async () => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.1/32')
    writes.mockResolvedValueOnce(denial(120001)); await controller.save(); await flush()
    expect(controller.state.rows).toEqual([])
    reads.mockResolvedValueOnce(response(saved))
    recovery.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'admin', permissions: ['admin:access', 'system:manage'] } }))
    await flush()
    expect(controller.state.allowed).toBe(true); expect(controller.state.rows.map(row => row.prefix)).toEqual(saved.prefixes)
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
  it.each(transitions)('retires an unknown private save result across %s before a failed fresh read', async kind => {
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.1/32')
    writes.mockRejectedValueOnce(new Error('response lost')); await controller.save()
    expect(controller.state.feedback).toBe('saveUnknown'); expect(controller.state.reloadRequired).toBe(true)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    transition(kind)
    expect(controller.state.feedback).toBe(''); expect(controller.state.reloadRequired).toBe(false)
    expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe('')
    pending.reject(new Error('fresh identity offline')); await flush()
    expect(controller.state.feedback).toBe('loadFailed'); expect(controller.state.rows).toEqual([])
    await controller.save(); expect(writes).toHaveBeenCalledTimes(1)
  })
  it.each(transitions.flatMap(kind => (['loaded', 'edited'] as const).map(source => ({ kind, source }))))('clears an enabled $source draft synchronously across $kind even if the new read fails and the old read arrives late', async ({ kind, source }) => {
    reads.mockResolvedValueOnce(response({ ...original, enabled: source === 'loaded' }))
    const { controller } = mountController(); await flush()
    if (source === 'edited') controller.setEnabled(true)
    expect(controller.state.enabled).toBe(true)
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    reads.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const retiredRead = controller.load()
    transition(kind)
    expect(controller.state.enabled).toBe(false)
    expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe('')
    await flush(); expect(controller.state.loading).toBe(true)
    current.reject(new Error('new identity offline')); await flush()
    expect(controller.state.enabled).toBe(false); expect(controller.state.feedback).toBe('loadFailed')
    expect(controller.state.loading).toBe(false); expect(controller.state.version).toBe('')
    old.resolve(response(saved)); await retiredRead; await flush()
    expect(controller.state.enabled).toBe(false); expect(controller.state.rows).toEqual([])
    expect(controller.state.feedback).toBe('loadFailed'); expect(controller.state.loading).toBe(false)
    await controller.save(); expect(writes).not.toHaveBeenCalled()
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey }).every(([, data]) => data === undefined)).toBe(true)
  })
  const matrix = transitions.flatMap(kind => ['load', 'save'].flatMap(operation => ['resolve', 'reject', 'denied', ...(operation === 'save' ? ['conflict'] : [])].map(outcome => ({ kind, operation, outcome }))))
  it.each(matrix)('retires $kind $operation $outcome before cache, draft, feedback and finally', async ({ kind, operation, outcome }) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    else writes.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    transition(kind); await flush()
    if (operation === 'save') { await ready(); await fireEvent.update(prefixes()[0]!, '198.51.100.7/32'); await fireEvent.submit(form()) }
    if (outcome === 'reject') old.reject(new Error('stale')); else if (outcome === 'denied') old.resolve(denial(120001)); else old.resolve(response(outcome === 'conflict' ? null : saved, outcome === 'conflict' ? 900225 : 0))
    await flush()
    expect(button('save').disabled).toBe(true); expect(button('reload').disabled).toBe(true)
    for (const feedback of ['saved', 'conflict', 'saveFailed', 'saveUnknown', 'loadFailed']) expect(screen.queryByText('targetCIDRAllowlist.' + feedback)).toBeNull()
    expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(false)
    if (operation === 'load') expect(prefixes()).toHaveLength(0); else expect(prefixes()[0]!.value).toBe('198.51.100.7/32')
    expect(authReads).not.toHaveBeenCalled()
    expect(toggle().checked).toBe(false)
    current.resolve(response(operation === 'load' ? original : saved)); await flush()
    if (operation === 'load') await ready(); else expect(screen.getByText('targetCIDRAllowlist.saved')).toBeTruthy()
  })
  it.each(['load', 'save'] as const)('rechecks identity after synchronous %s cache listeners switch accounts', async operation => {
    const current = createDeferred<Response>(); let switched = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!switched && event.query.queryKey[0] === adminTargetCIDRAllowlistKey[0] && (event.query.state.data as typeof saved)?.updatedAt === saved.updatedAt) {
        switched = true; reads.mockReturnValueOnce(current.promise); auth('admin-b')
      }
    })
    if (operation === 'load') reads.mockResolvedValueOnce(response(saved))
    mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    await flush(); expect(switched).toBe(true); expect(prefixes()).toHaveLength(0); expect(button('save').disabled).toBe(true)
    expect(screen.queryByText('targetCIDRAllowlist.saved')).toBeNull()
    current.resolve(response(original)); await ready(); unsubscribe()
  })
  it.each(['load', 'save'].flatMap(operation => ['resolve', 'reject'].map(outcome => ({ operation, outcome }))))('clears private data on unmount during $operation $outcome', async ({ operation, outcome }) => {
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise); else writes.mockReturnValueOnce(pending.promise)
    const view = mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    view.unmount()
    if (outcome === 'resolve') pending.resolve(response(saved)); else pending.reject(new Error('unmounted'))
    await flush(); expect(client.getQueriesData({ queryKey: adminTargetCIDRAllowlistKey })).toEqual([])
  })
  it.each(['en', 'zh-CN'] as const)('shows usable %s controls and prefix-union scope with real translations', async locale => {
    mount(locale); await flush()
    expect(screen.getByRole('heading', { name: locale === 'en' ? 'Allowed target CIDRs' : '目标 CIDR 白名单' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: locale === 'en' ? 'CIDR 1' : 'CIDR 网段 1' })).toHaveProperty('value', '192.0.2.0/24')
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Clear list' : '清空列表' })).toBeTruthy()
    expect(screen.getByText(messages[locale].targetCIDRAllowlist.scope)).toBeTruthy()
    expect(screen.getByText(locale === 'en' ? /union/ : /并集/)).toBeTruthy()
    expect(screen.getByText(messages[locale].targetCIDRAllowlist.wideWarning)).toBeTruthy()
  })

  it.each([900218, 900219, 900222, 900223])('requires an explicit reload for another resource error %s', async code => {
    const { controller } = mountController(); await flush()
    controller.edit(0, '198.51.100.9/32'); writes.mockResolvedValueOnce(response(null, code))
    await controller.save()
    expect(controller.state.feedback).toBe('saveUnknown'); expect(controller.state.reloadRequired).toBe(true)
    expect(controller.state.rows[0]?.prefix).toBe('198.51.100.9/32')
    await controller.save(); expect(writes).toHaveBeenCalledTimes(1)
  })
  it.each(['', 'example.com/24', '192.0.2.0/024', '192.0.2.0/33', '2001:db8::/129', '::ffff:192.0.2.1/120'])('keeps invalid CIDR %j local without a write', async prefix => {
    const { controller } = mountController(); await flush(); controller.edit(0, prefix)
    await controller.save()
    expect(controller.state.feedback).toBe('invalid'); expect(controller.state.rows[0]?.prefix).toBe(prefix)
    expect(writes).not.toHaveBeenCalled()
  })
  it('refuses canonical duplicates but keeps overlapping rules and both address families', async () => {
    const { controller } = mountController(); await flush()
    controller.edit(0, '192.0.2.1/24'); controller.add(); controller.edit(1, ' 192.0.2.129/24 ')
    await controller.save(); expect(writes).not.toHaveBeenCalled(); expect(controller.state.feedback).toBe('invalid')
    controller.edit(1, '192.0.2.9/32'); controller.add(); controller.edit(2, ' 2001:0DB8::1/128 ')
    controller.add(); controller.edit(3, '0.0.0.0/0'); controller.add(); controller.edit(4, '::/0')
    controller.setEnabled(true)
    const canonical = ['0.0.0.0/0', '192.0.2.0/24', '192.0.2.9/32', '2001:db8::1/128', '::/0']
    writes.mockResolvedValueOnce(response({ ...saved, prefixes: canonical }))
    await controller.save()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ enabled: true, prefixes: ['192.0.2.1/24', '192.0.2.9/32', ' 2001:0DB8::1/128 ', '0.0.0.0/0', '::/0'], expectedUpdatedAt: original.updatedAt })
    expect(controller.state.rows.map(row => row.prefix)).toEqual(canonical)
    expect(controller.state.feedback).toBe('saved')
  })
})
