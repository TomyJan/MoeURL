import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { setImmediate } from 'node:timers'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { adminTargetIPDenylistKey } from '@/entities/target-ip-denylist/api'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import TargetIPDenylistEditor from './TargetIPDenylistEditor.vue'
import { useTargetIPDenylistDraft } from './useTargetIPDenylistDraft'

const original = { addresses: ['192.0.2.1'], updatedAt: '2026-11-11T05:00:00.123456Z' }
const saved = { addresses: ['203.0.113.9'], updatedAt: '2026-11-11T05:00:01.654321Z' }
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
  return render(TargetIPDenylistEditor, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
}
const form = () => screen.getByRole('form', { name: 'targetIPPolicy.form' })
const button = (name: string) => screen.getByRole('button', { name: 'targetIPPolicy.' + name }) as HTMLButtonElement
const addresses = () => screen.queryAllByRole('textbox', { name: /^targetIPPolicy.address / }) as HTMLInputElement[]
function mountController() {
  let controller!: ReturnType<typeof useTargetIPDenylistDraft>
  const view = render(defineComponent({ setup() { controller = useTargetIPDenylistDraft(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, controller }
}
async function ready(address = '192.0.2.1') {
  await nextTick(); await flush()
  expect(addresses()[0]?.value).toBe(address); expect(button('save').disabled).toBe(false)
}
describe('independent target policy draft', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
    client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
    authReads.mockReset().mockImplementation(async () => response({ user: { id: 'admin-a', username: 'admin-a', group: 'user', permissions: [] } }))
    reads.mockReset().mockImplementation(async () => response(original))
    writes.mockReset().mockImplementation(async () => response(saved))
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      if (path === '/api/v1/auth/me' && init.method === 'GET') return authReads()
      if (path === '/api/v1/admin/system/target-ip-denylist' && init.method === 'GET') return reads()
      if (path === '/api/v1/admin/system/target-ip-denylist/update' && init.method === 'POST') return writes(JSON.parse(String(init.body)))
      throw new Error('Unexpected transport: ' + path)
    })
    auth()
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

  it.each(['transport', 'http500', 'invalid-envelope', 'invalid-data', 'other-code', 'foreign-input-rejection'] as const)('policy confirmation keeps unknown %s results until an accepted explicit reload', async kind => {
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.1')
    if (kind === 'transport') writes.mockRejectedValueOnce(new Error('response lost'))
    else if (kind === 'http500') writes.mockResolvedValueOnce(new Response('', { status: 500 }))
    else if (kind === 'invalid-envelope') writes.mockResolvedValueOnce(new Response('{}'))
    else if (kind === 'invalid-data') writes.mockResolvedValueOnce(response({ ...saved, updatedAt: 'invalid' }))
    else writes.mockResolvedValueOnce(response(null, kind === 'other-code' ? 900204 : 900218))
    await controller.save()
    expect(controller.state.feedback).toBe('saveUnknown'); expect(controller.state.reloadRequired).toBe(true)
    expect(controller.state.rows[0]?.address).toBe('198.51.100.1'); expect(controller.state.version).toBe(original.updatedAt)
    expect(controller.state.saving).toBe(false)
    await controller.save(); expect(writes).toHaveBeenCalledTimes(1)
    reads.mockRejectedValueOnce(new Error('reload offline')); await controller.load()
    expect(controller.state.feedback).toBe('saveUnknown'); expect(controller.state.reloadRequired).toBe(true)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    const reloading = controller.load(); controller.edit(0, '198.51.100.2')
    pending.resolve(response(saved)); await reloading
    expect(controller.state.rows[0]?.address).toBe('198.51.100.2'); expect(controller.state.version).toBe(original.updatedAt)
    expect(controller.state.feedback).toBe('saveUnknown'); expect(controller.state.reloadRequired).toBe(true)
    await controller.save(); expect(writes).toHaveBeenCalledTimes(1)
    reads.mockResolvedValueOnce(response(saved)); await controller.load()
    expect(controller.state.rows[0]?.address).toBe('203.0.113.9'); expect(controller.state.version).toBe(saved.updatedAt)
    expect(controller.state.feedback).toBe(''); expect(controller.state.reloadRequired).toBe(false)
    await controller.save()
    expect(writes).toHaveBeenLastCalledWith({ addresses: ['203.0.113.9'], expectedUpdatedAt: saved.updatedAt })
    expect(writes).toHaveBeenCalledTimes(2)
  })
  it('policy confirmation retries only an explicit resource input rejection', async () => {
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.1')
    writes.mockResolvedValueOnce(response(null, 900220)); await controller.save()
    expect(controller.state.feedback).toBe('saveFailed'); expect(controller.state.reloadRequired).toBe(false)
    expect(controller.state.rows[0]?.address).toBe('198.51.100.1')
    controller.edit(0, '198.51.100.4'); await controller.save()
    expect(writes).toHaveBeenLastCalledWith({ addresses: ['198.51.100.4'], expectedUpdatedAt: original.updatedAt })
    expect(controller.state.feedback).toBe('saved')
  })
  it.each(['en', 'zh-CN'] as const)('policy confirmation persists usable %s unknown feedback and blocks another submit', async locale => {
    mount(locale); await flush()
    writes.mockRejectedValueOnce(new Error('response lost'))
    await fireEvent.submit(screen.getByRole('form')); await flush()
    const message = messages[locale].targetIPPolicy.saveUnknown
    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.getByRole('button', { name: messages[locale].targetIPPolicy.save })).toHaveProperty('disabled', true)
    await fireEvent.submit(screen.getByRole('form')); expect(writes).toHaveBeenCalledTimes(1)
  })

  it.each(['addition', 'removal'].flatMap(change => ['edited', 'conflict', 'unknown'].map(barrier => ({ change, barrier }))))('policy confirmation preserves $barrier draft across unrelated permission $change without reading', async ({ change, barrier }) => {
    if (change === 'removal') auth('admin-a', ['admin:access', 'system:manage', 'short_link:read_all'])
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.3')
    if (barrier === 'conflict') { writes.mockResolvedValueOnce(response(null, 900221)); await controller.save() }
    if (barrier === 'unknown') { writes.mockRejectedValueOnce(new Error('lost response')); await controller.save() }
    const before = { feedback: controller.state.feedback, blocked: controller.state.reloadRequired, reads: reads.mock.calls.length }
    auth('admin-a', ['admin:access', 'system:manage', ...(change === 'addition' ? ['short_link:read_all'] : [])])
    await flush()
    expect(controller.state.rows[0]?.address).toBe('198.51.100.3'); expect(controller.state.version).toBe(original.updatedAt)
    expect(controller.state.feedback).toBe(before.feedback); expect(controller.state.reloadRequired).toBe(before.blocked)
    expect(reads).toHaveBeenCalledTimes(before.reads)
    if (barrier !== 'edited') { await controller.save(); expect(writes).toHaveBeenCalledTimes(1) }
  })
  it.each(['addition', 'removal'].flatMap(change => (['load', 'save'] as const).map(operation => ({ change, operation }))))('policy confirmation preserves pending $operation across unrelated permission $change', async ({ change, operation }) => {
    if (change === 'removal') auth('admin-a', ['admin:access', 'system:manage', 'short_link:read_all'])
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.3')
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise)
    else writes.mockReturnValueOnce(pending.promise)
    const running = controller[operation]()
    const attempts = reads.mock.calls.length
    auth('admin-a', ['admin:access', 'system:manage', ...(change === 'addition' ? ['short_link:read_all'] : [])])
    expect(controller.state.rows[0]?.address).toBe('198.51.100.3')
    expect(controller.state[operation === 'load' ? 'loading' : 'saving']).toBe(true)
    pending.resolve(response(saved)); await running; await flush()
    expect(reads).toHaveBeenCalledTimes(attempts)
    expect(controller.state.rows[0]?.address).toBe('203.0.113.9'); expect(controller.state.version).toBe(saved.updatedAt)
    expect(controller.state.feedback).toBe(operation === 'save' ? 'saved' : '')
    expect(controller.state.loading).toBe(false); expect(controller.state.saving).toBe(false)
  })
  it('keeps unsorted raw edits local and replaces them only with the canonical saved response', async () => {
    mount(); await ready()
    await fireEvent.update(addresses()[0]!, ' 2001:0DB8::1 '); await fireEvent.click(button('add'))
    await fireEvent.update(addresses()[1]!, '::ffff:192.0.2.1')
    expect(addresses().map(input => input.value)).toEqual([' 2001:0DB8::1 ', '::ffff:192.0.2.1'])
    expect(client.getQueriesData({ queryKey: adminTargetIPDenylistKey }).map(([, data]) => data)).toContainEqual(original)
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ addresses: [' 2001:0DB8::1 ', '::ffff:192.0.2.1'], expectedUpdatedAt: original.updatedAt })
    expect(addresses().map(input => input.value)).toEqual(['203.0.113.9']); expect(screen.getByText('targetIPPolicy.saved')).toBeTruthy()
    await fireEvent.update(addresses()[0]!, '198.51.100.6')
    expect(screen.queryByText('targetIPPolicy.saved')).toBeNull()
  })
  it('adds only 100 rows, marks invalid blank input, removes rows and explicitly saves an empty list', async () => {
    reads.mockImplementationOnce(async () => response({ ...original, addresses: Array.from({ length: 99 }, (_, i) => `192.0.2.${i}`).sort() }))
    mount(); await flush(); expect(addresses()).toHaveLength(99)
    await fireEvent.click(button('add')); expect(addresses()).toHaveLength(100); expect(button('add').disabled).toBe(true)
    await fireEvent.click(button('add')); expect(addresses()).toHaveLength(100)
    await fireEvent.submit(form()); expect(screen.getByText('targetIPPolicy.invalid')).toBeTruthy(); expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(button('remove 100')); expect(addresses()).toHaveLength(99)
    await fireEvent.click(button('clear')); expect(addresses()).toHaveLength(0); expect(writes).not.toHaveBeenCalled()
    writes.mockResolvedValueOnce(response({ ...saved, addresses: [] }))
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ addresses: [], expectedUpdatedAt: original.updatedAt }); expect(addresses()).toHaveLength(0)
  })
  it('keeps initial failures retryable and blocks any write before a confirmed version', async () => {
    reads.mockRejectedValueOnce(new Error('offline')); mount(); await flush()
    expect(screen.getByText('targetIPPolicy.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    await fireEvent.submit(form()); expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(button('reload')); await ready()
  })
  it('clears private rows when the authentication cache disappears and stays closed before login', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    mount(); await flush()
    expect(screen.queryByRole('form')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
    await fireEvent.update(addresses()[0]!, '198.51.100.3')
    client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    await nextTick()
    expect(screen.queryByRole('form')).toBeNull()
    expect(client.getQueriesData({ queryKey: adminTargetIPDenylistKey })).toEqual([])
    auth(); await ready()
    expect(addresses()[0]!.value).toBe('192.0.2.1')
  })
  it('preserves edits when the same account refreshes an equivalent permission set', async () => {
    mount(); await ready()
    await fireEvent.update(addresses()[0]!, '198.51.100.1')
    auth('admin-a', ['system:manage', 'admin:access']); await flush()
    expect(addresses()[0]!.value).toBe('198.51.100.1'); expect(reads).toHaveBeenCalledTimes(1)
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ addresses: ['198.51.100.1'], expectedUpdatedAt: original.updatedAt })
  })
  it('shows a confirmed input rejection and keeps the editable draft available for an explicit retry', async () => {
    writes.mockResolvedValueOnce(response(null, 900220)); mount(); await ready()
    await fireEvent.update(addresses()[0]!, '198.51.100.1'); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetIPPolicy.saveFailed')).toBeTruthy()
    expect(addresses()[0]!.value).toBe('198.51.100.1'); expect(button('save').disabled).toBe(false)
    expect(writes).toHaveBeenCalledTimes(1)
    await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetIPPolicy.saved')).toBeTruthy(); expect(addresses()[0]!.value).toBe('203.0.113.9')
  })
  it('does not load, edit or save without an identity, and clears private state immediately on revocation', async () => {
    auth('', [])
    const { controller } = mountController()
    controller.edit(0, '198.51.100.5'); controller.add(); controller.remove(0); controller.clear(); await controller.save(); await flush()
    expect(reads).not.toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(controller.state.rows).toEqual([])
    auth(); await flush(); expect(controller.state.rows[0]!.address).toBe('192.0.2.1')
    auth('admin-a', [])
    expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe(''); expect(controller.state.allowed).toBe(false)
    expect(client.getQueriesData({ queryKey: adminTargetIPDenylistKey })).toEqual([])
  })
  it('keeps a conflict barrier after a failed reload and only clears it when new server data is applied', async () => {
    writes.mockResolvedValueOnce(response(null, 900221)); mount(); await ready()
    await fireEvent.submit(form()); await flush()
    reads.mockRejectedValueOnce(new Error('offline')); await fireEvent.click(button('reload')); await flush()
    expect(screen.getByText('targetIPPolicy.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    expect(addresses()[0]!.value).toBe('192.0.2.1'); expect(writes).toHaveBeenCalledTimes(1)
    await fireEvent.click(button('reload')); await ready()
  })
  it('preserves a conflict draft and requires an explicit applied reload without automatic reads or writes', async () => {
    writes.mockResolvedValueOnce(response(null, 900221)); mount(); await ready()
    await fireEvent.update(addresses()[0]!, '198.51.100.1'); await fireEvent.submit(form()); await flush()
    expect(screen.getByText('targetIPPolicy.conflict')).toBeTruthy(); expect(addresses()[0]!.value).toBe('198.51.100.1')
    await fireEvent.submit(form()); expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.update(addresses()[0]!, '198.51.100.2')
    pending.resolve(response(saved)); await flush()
    expect(addresses()[0]!.value).toBe('198.51.100.2'); expect(button('save').disabled).toBe(true)
    reads.mockResolvedValueOnce(response(saved)); await fireEvent.click(button('reload')); await ready('203.0.113.9')
    await fireEvent.submit(form()); await flush()
    expect(writes).toHaveBeenLastCalledWith({ addresses: saved.addresses, expectedUpdatedAt: saved.updatedAt })
  })
  it('rejects structural edits and duplicate operations during reload but keeps newer typing', async () => {
    mount(); await ready(); const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.click(button('reload')); await fireEvent.submit(form())
    for (const action of ['add', 'clear', 'remove 1']) expect(button(action).disabled).toBe(true)
    await fireEvent.click(button('clear')); await fireEvent.click(button('remove 1')); await fireEvent.click(button('add'))
    await fireEvent.update(addresses()[0]!, '198.51.100.8'); pending.resolve(response(saved)); await flush()
    expect(addresses()[0]!.value).toBe('198.51.100.8'); expect(writes).not.toHaveBeenCalled(); expect(reads).toHaveBeenCalledTimes(2)
  })
  it.each(['transport', 'business', 'invalid'] as const)('blocks all edits while saving and retains a %s failure without automatic retry', async kind => {
    const { controller } = mountController()
    await flush(); controller.edit(0, '198.51.100.1')
    const pending = createDeferred<Response>(); writes.mockReturnValueOnce(pending.promise)
    const saving = controller.save()
    controller.edit(0, '198.51.100.5'); controller.clear(); controller.remove(0); controller.add(); void controller.load(); void controller.save()
    expect(controller.state.rows.map(row => row.address)).toEqual(['198.51.100.1'])
    if (kind === 'transport') pending.reject(new Error('offline'))
    else pending.resolve(response(null, kind === 'business' ? 100001 : 900220))
    await saving
    expect(controller.state.feedback).toBe(kind === 'invalid' ? 'saveFailed' : 'saveUnknown'); expect(controller.state.saving).toBe(false)
    expect(controller.state.reloadRequired).toBe(kind !== 'invalid')
    expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    expect(controller.state.rows[0]!.address).toBe('198.51.100.1')
    await controller.save()
    expect(writes).toHaveBeenCalledTimes(kind === 'invalid' ? 2 : 1)
    expect(controller.state.rows[0]!.address).toBe(kind === 'invalid' ? '203.0.113.9' : '198.51.100.1')
  })
  const denials = [120001, 401, 403].flatMap(code => (['load', 'save'] as const).map(operation => ({ code, operation })))
  const denial = (code: number) => code === 120001 ? response(null, code) : new Response('', { status: code })
  it.each(denials)('clears private data on current $operation denial $code before authentication recovery', async ({ code, operation }) => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.3')
    if (operation === 'load') reads.mockResolvedValueOnce(denial(code))
    else writes.mockResolvedValueOnce(denial(code))
    await controller[operation](); await flush()
    expect(controller.state.allowed).toBe(false)
    expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe('')
    expect(controller.state.loading).toBe(false); expect(controller.state.saving).toBe(false)
    expect(controller.state.feedback).toBe('')
    expect(client.getQueriesData({ queryKey: adminTargetIPDenylistKey })).toEqual([])
    expect(authReads).toHaveBeenCalledTimes(1)
    const attempts = { read: reads.mock.calls.length, write: writes.mock.calls.length }
    controller.add(); controller.edit(0, '198.51.100.5'); controller.clear(); controller.remove(0)
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
    expect(client.getQueriesData({ queryKey: adminTargetIPDenylistKey })).toEqual([])
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
    expect(controller.state.rows.map(row => row.address)).toEqual(kind === 'permissions' ? [] : original.addresses)
    expect(writes).toHaveBeenCalledTimes(1)
  })
  it('loads fresh policy only after this identity regains confirmed grants, without retrying the rejected write', async () => {
    const recovery = createDeferred<Response>(); authReads.mockReturnValueOnce(recovery.promise)
    const { controller } = mountController(); await flush(); controller.edit(0, '198.51.100.3')
    writes.mockResolvedValueOnce(denial(120001)); await controller.save(); await flush()
    expect(controller.state.rows).toEqual([])
    reads.mockResolvedValueOnce(response(saved))
    recovery.resolve(response({ user: { id: 'admin-a', username: 'admin-a', group: 'admin', permissions: ['admin:access', 'system:manage'] } }))
    await flush()
    expect(controller.state.allowed).toBe(true); expect(controller.state.rows.map(row => row.address)).toEqual(saved.addresses)
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
  it.each([...transitions, 'unmount'] as const)('retires an unknown private save result across %s before a failed fresh read', async kind => {
    const { controller, unmount } = mountController(); await flush(); controller.edit(0, '198.51.100.3')
    writes.mockRejectedValueOnce(new Error('response lost')); await controller.save()
    expect(controller.state.feedback).toBe('saveUnknown'); expect(controller.state.reloadRequired).toBe(true)
    const pending = createDeferred<Response>()
    if (kind === 'unmount') unmount()
    else { reads.mockReturnValueOnce(pending.promise); transition(kind) }
    expect(controller.state.feedback).toBe(''); expect(controller.state.reloadRequired).toBe(false)
    expect(controller.state.rows).toEqual([]); expect(controller.state.version).toBe('')
    if (kind !== 'unmount') {
      pending.reject(new Error('fresh identity offline')); await flush()
      expect(controller.state.feedback).toBe('loadFailed'); expect(controller.state.rows).toEqual([])
    }
    await controller.save(); expect(writes).toHaveBeenCalledTimes(1)
  })
  const matrix = transitions.flatMap(kind => ['load', 'save'].flatMap(operation => ['resolve', 'reject', 'denied', ...(operation === 'save' ? ['conflict'] : [])].map(outcome => ({ kind, operation, outcome }))))
  it.each(matrix)('retires $kind $operation $outcome before cache, draft, feedback and finally', async ({ kind, operation, outcome }) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    else writes.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    transition(kind); await flush()
    if (operation === 'save') { await ready(); await fireEvent.update(addresses()[0]!, '198.51.100.7'); await fireEvent.submit(form()) }
    if (outcome === 'reject') old.reject(new Error('stale')); else if (outcome === 'denied') old.resolve(denial(120001)); else old.resolve(response(outcome === 'conflict' ? null : saved, outcome === 'conflict' ? 900221 : 0))
    await flush()
    expect(button('save').disabled).toBe(true); expect(button('reload').disabled).toBe(true)
    for (const feedback of ['saved', 'conflict', 'saveFailed', 'saveUnknown', 'loadFailed']) expect(screen.queryByText('targetIPPolicy.' + feedback)).toBeNull()
    expect(client.getQueriesData({ queryKey: adminTargetIPDenylistKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(false)
    if (operation === 'load') expect(addresses()).toHaveLength(0); else expect(addresses()[0]!.value).toBe('198.51.100.7')
    expect(authReads).not.toHaveBeenCalled()
    current.resolve(response(operation === 'load' ? original : saved)); await flush()
    if (operation === 'load') await ready(); else expect(screen.getByText('targetIPPolicy.saved')).toBeTruthy()
  })
  it.each(['load', 'save'] as const)('rechecks identity after synchronous %s cache listeners switch accounts', async operation => {
    const current = createDeferred<Response>(); let switched = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!switched && event.query.queryKey[0] === adminTargetIPDenylistKey[0] && (event.query.state.data as typeof saved)?.updatedAt === saved.updatedAt) {
        switched = true; reads.mockReturnValueOnce(current.promise); auth('admin-b')
      }
    })
    if (operation === 'load') reads.mockResolvedValueOnce(response(saved))
    mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    await flush(); expect(switched).toBe(true); expect(addresses()).toHaveLength(0); expect(button('save').disabled).toBe(true)
    expect(screen.queryByText('targetIPPolicy.saved')).toBeNull()
    current.resolve(response(original)); await ready(); unsubscribe()
  })
  it.each(['load', 'save'].flatMap(operation => ['resolve', 'reject'].map(outcome => ({ operation, outcome }))))('clears private data on unmount during $operation $outcome', async ({ operation, outcome }) => {
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise); else writes.mockReturnValueOnce(pending.promise)
    const view = mount(); if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    view.unmount()
    if (outcome === 'resolve') pending.resolve(response(saved)); else pending.reject(new Error('unmounted'))
    await flush(); expect(client.getQueriesData({ queryKey: adminTargetIPDenylistKey })).toEqual([])
  })
  it.each(['en', 'zh-CN'] as const)('shows usable %s controls and exact-address scope with real translations', async locale => {
    mount(locale); await flush()
    expect(screen.getByRole('heading', { name: locale === 'en' ? 'Blocked target IP addresses' : '目标 IP 黑名单' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: locale === 'en' ? 'IP address 1' : 'IP 地址 1' })).toHaveProperty('value', '192.0.2.1')
    expect(screen.getByRole('button', { name: locale === 'en' ? 'Clear list' : '清空列表' })).toBeTruthy()
    expect(screen.getByText(locale === 'en' ? /does not resolve DNS/ : /不解析 DNS/)).toBeTruthy()
  })
})
