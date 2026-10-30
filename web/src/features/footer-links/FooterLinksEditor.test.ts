import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { setImmediate } from 'node:timers'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminFooterLinksKey, publicFooterLinksKey } from '@/entities/footer-links/api'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import FooterLinksEditor from './FooterLinksEditor.vue'
import { useFooterLinksDraft } from './useFooterLinksDraft'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const original = { links: [{ label: 'First', url: 'https://example.com/one' }], updatedAt: '2026-10-30T01:02:03.123456789+08:00' }
const saved = { links: [{ label: 'Server', url: 'https://example.com/saved' }], updatedAt: '2026-10-30T01:02:04.987654321+08:00' }
const publicBefore = { links: [{ label: 'Public', url: 'https://example.com/public' }] }
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: code ? 'Rejected' : 'OK', data, meta: {} }), { status: 200 })
let client: QueryClient
const reads = vi.fn<() => Promise<Response>>()
const writes = vi.fn<(body: unknown) => Promise<Response>>()
/** Drains promise continuations through an event-loop turn, without a timed sleep. */
const flushPromises = () => new Promise<void>(resolve => setImmediate(resolve))
function auth(id = 'admin-a', permissions = ['admin:access', 'system:manage']) {
  client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', group: id ? 'admin' : 'guest', permissions } })
}
function mount() { return render(FooterLinksEditor, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } }) }
const form = () => screen.getByRole('form', { name: 'footerLinks.form' })
const button = (name: string) => screen.getByRole('button', { name: 'footerLinks.' + name }) as HTMLButtonElement
const labels = () => screen.getAllByRole('textbox', { name: /^footerLinks.label / }) as HTMLInputElement[]
const urls = () => screen.getAllByRole('textbox', { name: /^footerLinks.url / }) as HTMLInputElement[]
async function ready(label = 'First') {
  await nextTick(); form(); await flushPromises()
  expect(labels()[0]!.value).toBe(label); expect(button('save').disabled).toBe(false)
}
function assertPrivateAbsent() { expect(client.getQueriesData({ queryKey: adminFooterLinksKey })).toEqual([]) }

describe('FooterLinksEditor independent ordered draft', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
    client.setQueryDefaults(publicFooterLinksKey, { gcTime: Infinity })
    reads.mockReset().mockImplementation(async () => response(original))
    writes.mockReset().mockImplementation(async () => response(saved))
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      if (url === '/api/v1/admin/system/footer-links' && init.method === 'GET') return reads()
      if (url === '/api/v1/admin/system/footer-links/update' && init.method === 'POST') return writes(JSON.parse(init.body as string))
      throw new Error('Unexpected transport: ' + url)
    }))
    auth(); client.setQueryData(publicFooterLinksKey, publicBefore)
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

  it('renders named controls, sends exact ordered normalized items without row keys and publishes only the server result', async () => {
    client.setQueryDefaults(['admin', 'system', 'settings'], { gcTime: Infinity })
    client.setQueryDefaults(['user', 'preferences'], { gcTime: Infinity })
    client.setQueryData(['admin', 'system', 'settings'], { original: true })
    client.setQueryData(['user', 'preferences'], { theme: 'dark' })
    mount(); await ready()
    await fireEvent.update(labels()[0]!, '  <script>literal</script>  ')
    await fireEvent.update(urls()[0]!, ' HTTPS://EXAMPLE.COM:443/a%2fb?x=@#frag ')
    expect(writes).not.toHaveBeenCalled(); expect(client.getQueryData(publicFooterLinksKey)).toEqual(publicBefore)
    await fireEvent.submit(form()); await flushPromises()
    expect(writes).toHaveBeenCalledExactlyOnceWith({ links: [{ label: '<script>literal</script>', url: 'https://example.com/a%2fb?x=@#frag' }], expectedUpdatedAt: original.updatedAt })
    expect(labels()[0]!.value).toBe('Server'); expect(screen.getByText('footerLinks.saved')).toBeTruthy()
    expect(client.getQueryData(publicFooterLinksKey)).toEqual({ links: saved.links })
    expect(client.getQueryData(['admin', 'system', 'settings'])).toEqual({ original: true })
    expect(client.getQueryData(['user', 'preferences'])).toEqual({ theme: 'dark' })
  })
  it('adds to five, preserves duplicate order, moves with real buttons, rejects empty rows and clears to zero', async () => {
    mount(); await ready()
    for (let i = 1; i < 5; i++) {
      await fireEvent.click(button('add'))
      await fireEvent.update(labels()[i]!, i === 1 ? 'First' : 'Item ' + i)
      await fireEvent.update(urls()[i]!, 'https://example.com/one')
    }
    expect(labels()).toHaveLength(5); expect(button('add').disabled).toBe(true)
    await fireEvent.click(button('add')); expect(labels()).toHaveLength(5)
    expect(button('up 1').disabled).toBe(true); expect(button('down 5').disabled).toBe(true)
    await fireEvent.click(button('up 3')); expect(labels().map(input => input.value)).toEqual(['First', 'Item 2', 'First', 'Item 3', 'Item 4'])
    await fireEvent.click(button('down 2')); expect(labels().map(input => input.value)).toEqual(['First', 'First', 'Item 2', 'Item 3', 'Item 4'])
    await fireEvent.submit(form()); await flushPromises()
    expect(writes.mock.calls[0]![0]).toEqual({ links: ['First', 'First', 'Item 2', 'Item 3', 'Item 4'].map(label => ({ label, url: 'https://example.com/one' })), expectedUpdatedAt: original.updatedAt })
    await fireEvent.click(button('add')); await fireEvent.submit(form())
    expect(screen.getByText('footerLinks.invalid')).toBeTruthy(); expect(writes).toHaveBeenCalledTimes(1)
    while (screen.queryAllByRole('textbox', { name: /^footerLinks.label / }).length) await fireEvent.click(button('remove 1'))
    writes.mockImplementationOnce(async () => response({ links: [], updatedAt: saved.updatedAt }))
    await fireEvent.submit(form()); await flushPromises()
    expect(writes).toHaveBeenLastCalledWith({ links: [], expectedUpdatedAt: saved.updatedAt })
    expect(client.getQueryData(publicFooterLinksKey)).toEqual({ links: [] })
  })
  it.each(['label', 'url', 'add', 'remove', 'up', 'down'] as const)('clears saved feedback on %s without publishing edits', async action => {
    const two = { ...saved, links: [...saved.links, ...saved.links] }
    writes.mockImplementation(async () => response(two))
    mount(); await ready(); await fireEvent.submit(form()); await flushPromises()
    expect(screen.getByText('footerLinks.saved')).toBeTruthy()
    if (action === 'label') await fireEvent.update(labels()[0]!, 'new label')
    else if (action === 'url') await fireEvent.update(urls()[0]!, 'https://example.com/new')
    else await fireEvent.click(button(action === 'up' ? 'up 2' : action === 'down' ? 'down 1' : action === 'remove' ? 'remove 1' : action))
    expect(screen.queryByText('footerLinks.saved')).toBeNull()
    expect(client.getQueryData(publicFooterLinksKey)).toEqual({ links: two.links })
  })
  it('retains conflict draft without automatic read or write, then reloads and explicitly retries using the new complete version', async () => {
    writes.mockImplementationOnce(async () => response(null, 900209))
    mount(); await ready(); await fireEvent.update(labels()[0]!, 'My draft'); await fireEvent.submit(form()); await flushPromises()
    expect(screen.getByText('footerLinks.conflict')).toBeTruthy(); expect(labels()[0]!.value).toBe('My draft')
    await fireEvent.update(labels()[0]!, 'New draft'); expect(screen.getByText('footerLinks.conflict')).toBeTruthy()
    expect(reads).toHaveBeenCalledTimes(1); expect(writes).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(publicBefore)
    reads.mockImplementationOnce(async () => response(saved))
    await fireEvent.click(button('reload')); await ready('Server')
    expect(screen.queryByText('footerLinks.conflict')).toBeNull()
    await fireEvent.submit(form()); await flushPromises()
    expect(writes).toHaveBeenLastCalledWith({ links: saved.links, expectedUpdatedAt: saved.updatedAt })
  })
  it('retains edits made during explicit reload and blocks duplicate loading and structural operations', async () => {
    mount(); await ready()
    const pending = createDeferred<Response>(); reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(button('reload')); await fireEvent.click(button('reload')); await fireEvent.submit(form())
    expect(button('add').disabled).toBe(true); expect(button('remove 1').disabled).toBe(true)
    await fireEvent.click(button('add')); await fireEvent.click(button('remove 1'))
    expect(labels()).toHaveLength(1); expect(reads).toHaveBeenCalledTimes(2); expect(writes).not.toHaveBeenCalled()
    expect(labels()[0]!.disabled).toBe(false); await fireEvent.update(labels()[0]!, 'Newer edit')
    pending.resolve(response(saved)); await flushPromises()
    expect(labels()[0]!.value).toBe('Newer edit'); expect(button('save').disabled).toBe(false)
    await fireEvent.submit(form()); await flushPromises()
    expect(writes).toHaveBeenCalledWith({ links: [{ ...original.links[0]!, label: 'Newer edit' }], expectedUpdatedAt: original.updatedAt })
  })
  it('keeps initial failure retryable and refuses writes without a confirmed version', async () => {
    reads.mockRejectedValueOnce(new Error('offline')); mount(); form(); await flushPromises()
    expect(screen.getByText('footerLinks.loadFailed')).toBeTruthy(); expect(button('save').disabled).toBe(true)
    await fireEvent.submit(form()); expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(button('reload')); await ready()
  })
  it.each([0, 120001] as const)('blocks duplicate saves, keeps failed draft and permits deliberate retry for transport/business failure %s', async code => {
    const pending = createDeferred<Response>(); writes.mockReturnValueOnce(pending.promise)
    mount(); await ready(); await fireEvent.update(labels()[0]!, 'Draft'); await fireEvent.submit(form())
    expect(labels()[0]!.disabled).toBe(true)
    for (const name of ['save', 'reload', 'add', 'remove 1']) expect(button(name).disabled).toBe(true)
    await fireEvent.submit(form()); await fireEvent.click(button('reload')); await fireEvent.click(button('add'))
    expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1); expect(labels()).toHaveLength(1)
    if (code) pending.resolve(response(null, code)); else pending.reject(new Error('offline'))
    await flushPromises(); expect(screen.getByText('footerLinks.saveFailed')).toBeTruthy()
    expect(screen.queryByText('footerLinks.conflict')).toBeNull(); expect(labels()[0]!.value).toBe('Draft')
    await fireEvent.submit(form()); await flushPromises(); expect(screen.getByText('footerLinks.saved')).toBeTruthy()
  })
  it.each([{ permissions: [] }, { permissions: ['admin:access'] }, { permissions: ['system:manage'] }])('requires both current permissions $permissions', async ({ permissions }) => {
    auth('admin-a', permissions); mount(); await flushPromises()
    expect(screen.queryByRole('form')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
  })
  it('waits for a confirmed identity without loading private data', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'] }); mount(); await flushPromises()
    expect(screen.queryByRole('form')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
  })
  it('rejects imperative edits during save and moves beyond list boundaries without changing the draft', async () => {
    let controller!: ReturnType<typeof useFooterLinksDraft>
    render(defineComponent({ setup() { controller = useFooterLinksDraft(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
    await flushPromises()
    controller.move(0, -1); controller.move(0, 1)
    expect(controller.state.rows.map(({ label, url }) => ({ label, url }))).toEqual(original.links)
    const pending = createDeferred<Response>(); writes.mockReturnValueOnce(pending.promise)
    const saving = controller.save()
    controller.edit(0, 'label', 'Forbidden mid-save edit')
    controller.move(0, 1)
    expect(controller.state.rows[0]!.label).toBe('First')
    pending.resolve(response(saved)); await saving
    expect(controller.state.rows[0]!.label).toBe('Server')
    expect(client.getQueryData(publicFooterLinksKey)).toEqual({ links: saved.links })
  })
  it('does not announce the prior identity save after a public cache notification switches accounts', async () => {
    const current = createDeferred<Response>()
    mount(); await ready()
    let switched = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!switched && event.query.queryKey.join('/') === publicFooterLinksKey.join('/') && (event.query.state.data as typeof saved)?.links[0]?.label === 'Server') {
        switched = true; reads.mockReturnValueOnce(current.promise); auth('admin-b')
      }
    })
    await fireEvent.submit(form()); await flushPromises()
    expect(switched).toBe(true); expect(button('save').disabled).toBe(true)
    expect(screen.queryByText('footerLinks.saved')).toBeNull()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    current.resolve(response(original)); await ready(); unsubscribe()
  })

  const transitions = ['account', 'relogin', 'admin:access', 'system:manage'] as const
  function transition(kind: typeof transitions[number]) {
    if (kind === 'account') auth('admin-b')
    else if (kind === 'relogin') { auth('', []); auth() }
    else { auth('admin-a', ['admin:access', 'system:manage'].filter(value => value !== kind)); auth() }
  }
  const matrix = transitions.flatMap(kind => ['load', 'save'].flatMap(operation => ['resolve', 'reject', ...(operation === 'save' ? ['conflict'] : [])].map(outcome => ({ kind, operation, outcome }))))
  it.each(matrix)('retires $kind $operation $outcome including stale cache, feedback and finally', async ({ kind, operation, outcome }) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    else writes.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mount(); form()
    if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    transition(kind); await flushPromises()
    if (operation === 'save') { await ready(); await fireEvent.update(labels()[0]!, 'Current draft'); await fireEvent.submit(form()) }
    if (outcome === 'reject') old.reject(new Error('obsolete')); else old.resolve(response(outcome === 'conflict' ? null : saved, outcome === 'conflict' ? 900209 : 0))
    await flushPromises()
    expect(button('reload').disabled).toBe(true); expect(button('save').disabled).toBe(true)
    for (const feedback of ['saved', 'conflict', 'saveFailed', 'loadFailed']) expect(screen.queryByText('footerLinks.' + feedback)).toBeNull()
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(publicBefore)
    expect(client.getQueriesData({ queryKey: adminFooterLinksKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(false)
    current.resolve(response(operation === 'load' ? original : saved)); await flushPromises()
    if (operation === 'load') await ready(); else expect(client.getQueryData(publicFooterLinksKey)).toEqual({ links: saved.links })
  })
  it.each(['load', 'save'] as const)('rechecks identity after private %s cache notification before state or public publication', async operation => {
    const current = createDeferred<Response>()
    let switched = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!switched && event.query.queryKey.slice(0, 2).join('/') === 'footer-links/admin' && (event.query.state.data as typeof saved)?.updatedAt === saved.updatedAt) {
        switched = true; reads.mockReturnValueOnce(current.promise); auth('admin-b')
      }
    })
    if (operation === 'load') reads.mockImplementationOnce(async () => response(saved))
    mount(); form()
    if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    await flushPromises(); expect(switched).toBe(true); expect(button('save').disabled).toBe(true)
    expect(client.getQueryData(publicFooterLinksKey)).toEqual(publicBefore)
    expect(screen.queryByText('footerLinks.saved')).toBeNull()
    expect(client.getQueriesData({ queryKey: adminFooterLinksKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(false)
    current.resolve(response(original)); await ready(); unsubscribe()
  })
  it.each(['load', 'save'].flatMap(operation => ['resolve', 'reject'].map(outcome => ({ operation, outcome }))))('retires unmounted $operation $outcome and never publishes', async ({ operation, outcome }) => {
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise); else writes.mockReturnValueOnce(pending.promise)
    const view = mount(); form()
    if (operation === 'save') { await ready(); await fireEvent.submit(form()) }
    view.unmount()
    if (outcome === 'resolve') pending.resolve(response(saved)); else pending.reject(new Error('unmounted'))
    await flushPromises(); assertPrivateAbsent(); expect(client.getQueryData(publicFooterLinksKey)).toEqual(publicBefore)
  })
})
