import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { getCurrentInstance, nextTick, type ComponentInternalInstance } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import type { AdminShortLink } from '@/entities/short-link/model'
import ConsoleLinkList from './ConsoleLinkList.vue'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const row: AdminShortLink = {
  id: 'first', slug: 'first', url: 'https://sho.rt/first', targetUrl: 'https://destination.test/first', title: '', tags: [],
  status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false,
  passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', owner: { id: 'reader', username: 'reader', nickname: '' },
}
/** Runs real list parents, menus and access logic, replacing only HTTP transport and UI primitives. */
async function page(admin: boolean, actions: string[], protectedLink = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const grants = (values: string[]) => client.setQueryData(['auth', 'me'], { user: {
    id: 'reader', username: 'reader', nickname: '', group: admin ? 'admin' : 'user',
    permissions: [...(admin ? ['admin:access'] : []), ...(protectedLink ? ['short_link:set_password'] : []), `short_link:read_${admin ? 'all' : 'own'}`, ...values.map(action => `short_link:${action}_${admin ? 'all' : 'own'}`)],
  } })
  grants(actions)
  const writes: { path: string; body: unknown }[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (init?.method === 'POST') writes.push({ path: url.pathname, body: JSON.parse(String(init.body)) })
    const item = { ...row, passwordEnabled: protectedLink }
    const { owner, ...own } = item; void owner
    const data = url.pathname.endsWith('/auth/me') ? client.getQueryData(['auth', 'me'])
      : url.pathname.endsWith('/user/list-preference') ? { preference: { pageSize: null, updatedAt: null } }
      : url.pathname.endsWith('/short-link/list') ? { items: [admin ? item : own] }
        : url.pathname.endsWith('/short-link/update') ? { shortLink: { ...(admin ? row : own), status: 'disabled' } } : { items: [] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total: 1 } }))
  })
  const instances: ComponentInternalInstance[] = []
  const view = render(admin ? AdminLinksPage : MyLinksPage, { global: {
    mixins: [{ mounted() { const instance = getCurrentInstance(); if (instance) instances.push(instance) } }],
    plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })],
    stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true },
  } })
  await screen.findByText('https://sho.rt/first')
  await waitFor(() => expect(client.isFetching()).toBe(0))
  const list = instances.find(instance => instance.type === ConsoleLinkList)!
  const collection = client.getQueryCache().getAll().find(query => query.queryKey[0] === (admin ? 'admin-short-link' : 'short-link') && query.queryKey.length > 5)!
  return { ...view, list, instances, collection, client, grants, writes }
}

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('single row write authority', () => {
  // Silently rejecting a real form event must not discard a password that never reached HTTP.
  it.each([false, true])('preserves the unsent password through blocked real-form saves and sends it once after recovery, admin=%s', async admin => {
    const view = await page(admin, ['update'], true)
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Access settings' }))
    const dialog = await screen.findByRole('dialog')
    const password = dialog.querySelector<HTMLInputElement>('[data-testid="short-link-password-input"] input')!
    await fireEvent.update(password, 'new-secret-80')
    const save = screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement
    const original = { ...view.collection.state }
    for (const change of [{ fetchStatus: 'fetching' as const }, { isInvalidated: true }, { status: 'error' as const, error: new Error('read failed') }, { data: { ...original.data as object, items: [] } }]) {
      view.collection.setState({ ...original, ...change })
      save.click()
      await nextTick()
      expect(view.writes).toEqual([])
      expect(password.value).toBe('new-secret-80')
      view.collection.setState(original)
      await nextTick()
    }
    await fireEvent.click(save)
    await waitFor(() => expect(view.writes).toHaveLength(1))
    expect(view.writes[0]).toEqual({ path: '/api/v1' + (admin ? '/admin' : '') + '/short-link/update', body: { id: 'first', password: { mode: 'set', value: 'new-secret-80' } } })
    expect(password.value).toBe('')
  })

  // A normal background refresh must disable Save without pretending a mutation started.
  it.each([false, true])('disables the real editor Save while the current collection is refreshing, admin=%s', async admin => {
    const view = await page(admin, ['update'], true)
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Access settings' }))
    const dialog = await screen.findByRole('dialog')
    const password = dialog.querySelector<HTMLInputElement>('[data-testid="short-link-password-input"] input')!
    await fireEvent.update(password, 'retained-secret-80')
    const original = { ...view.collection.state }
    view.collection.setState({ fetchStatus: 'fetching' })
    await waitFor(() => expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText('The list or access state has changed. Wait for the list to recover, or cancel and reopen this editor.')).toBeTruthy()
    view.collection.setState(original)
    await waitFor(() => expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByText('The list or access state has changed. Wait for the list to recover, or cancel and reopen this editor.')).toBeNull()
    expect(password.value).toBe('retained-secret-80')
    expect(view.writes).toEqual([])
  })

  // An unconditional configure/status/delete menu must fail for an account that only reads.
  it.each([false, true])('hides each unavailable write action while preserving read actions, admin=%s', async admin => {
    await page(admin, [])
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const items = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(items).not.toContain('Access settings')
    expect(items).not.toContain('Disable')
    expect(items).not.toContain('Delete')
    expect(items).toContain('Open')
    expect(items).toContain('QR code')
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  // Removing the dispatch-time grant check sends real transport requests before the DOM rerenders.
  it.each([false, true])('rejects queued status/delete/configure events immediately after revocation, admin=%s', async admin => {
    const view = await page(admin, ['update', 'delete'])
    const props = view.list.vnode.props!
    const toggle = props.onToggleStatus as (link: typeof row) => void
    const remove = props.onRemove as (id: string) => void
    const configure = props.onConfigure as (link: typeof row) => void
    view.grants([])
    toggle(row); remove(row.id); configure(row)
    await nextTick()
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    expect(view.writes).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Updating and deleting are separate capabilities, even when both rows are selectable.
  it.each([false, true])('shows only the independently granted row actions, admin=%s', async admin => {
    const view = await page(admin, ['update'])
    await fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: 'Access settings' })).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    view.grants(['delete'])
    await nextTick()
    expect(screen.queryByRole('menuitem', { name: 'Access settings' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Disable' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeNull()
  })

  // Trusting the captured object instead of the live collection flips an already changed row incorrectly.
  it.each([false, true])('derives the status update from the current row rather than the queued snapshot, admin=%s', async admin => {
    const view = await page(admin, ['update'])
    view.client.setQueryData(view.collection.queryKey, { ...view.collection.state.data as object, items: [{ ...row, status: 'disabled' }] })
    const toggle = view.list.vnode.props!.onToggleStatus as (link: typeof row) => void
    toggle(row)
    await waitFor(() => expect(view.writes).toHaveLength(1))
    expect(view.writes).toEqual([{ path: '/api/v1' + (admin ? '/admin' : '') + '/short-link/update', body: { id: 'first', status: 'active' } }])
  })

  // A still-rendered menu is not authority once its collection has become stale, failed or incomplete.
  it.each([false, true])('blocks all queued writes from invalid, fetching, failed and missing-row collections, admin=%s', async admin => {
    const view = await page(admin, ['update', 'delete'])
    const props = view.list.vnode.props!, toggle = props.onToggleStatus as (link: typeof row) => void
    const remove = props.onRemove as (id: string) => void, configure = props.onConfigure as (link: typeof row) => void
    const original = { ...view.collection.state }
    for (const change of [{ isInvalidated: true }, { fetchStatus: 'fetching' as const }, { status: 'error' as const, error: new Error('read failed') }, { data: { ...original.data as object, items: [] } }]) {
      view.collection.setState({ ...original, ...change })
      toggle(row); remove(row.id); configure(row)
      await nextTick()
      await waitFor(() => expect(view.client.isMutating()).toBe(0))
      expect(view.writes).toEqual([])
      expect(screen.queryByRole('dialog')).toBeNull()
    }
  })

  // An editor opened before revocation must not submit after its original grant has gone away.
  it.each([false, true])('retires the settings editor and its queued save when update permission disappears, admin=%s', async admin => {
    const view = await page(admin, ['update'])
    const configure = view.list.vnode.props!.onConfigure as (link: typeof row) => void
    configure(row)
    await screen.findByRole('dialog')
    const dialog = view.instances.find(instance => (instance.type as { __name?: string }).__name === 'ShortLinkSettingsDialog')!
    const save = dialog.vnode.props!.onSave as (input: { id: string; status: string }) => void
    view.grants([])
    save({ id: row.id, status: 'disabled' })
    await nextTick()
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    expect(view.writes).toEqual([])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Removing the editor-ID check would allow a queued editor to write an unrelated current row.
  it.each([false, true])('saves only the active editor target and blocks competing row writes, admin=%s', async admin => {
    const view = await page(admin, ['update', 'delete'])
    view.client.setQueryData(view.collection.queryKey, { ...view.collection.state.data as object, items: [row, { ...row, id: 'second' }] })
    const props = view.list.vnode.props!
    ;(props.onConfigure as (link: typeof row) => void)(row)
    await screen.findByRole('dialog')
    const dialog = view.instances.find(instance => (instance.type as { __name?: string }).__name === 'ShortLinkSettingsDialog')!
    const save = dialog.vnode.props!.onSave as (input: { id: string; status: string }) => void
    save({ id: 'second', status: 'disabled' })
    ;(props.onRemove as (id: string) => void)(row.id)
    ;(props.onToggleStatus as (link: typeof row) => void)(row)
    await nextTick()
    expect(view.writes).toEqual([])
    save({ id: row.id, status: 'disabled' })
    await waitFor(() => expect(view.writes).toHaveLength(1))
    expect(view.writes).toEqual([{ path: '/api/v1' + (admin ? '/admin' : '') + '/short-link/update', body: { id: 'first', status: 'disabled' } }])
  })

  // Keeping an editor alive across two equally privileged accounts would reuse the previous draft.
  it.each([false, true])('retires the old editor on an identity change even when update remains allowed, admin=%s', async admin => {
    const view = await page(admin, ['update'])
    ;(view.list.vnode.props!.onConfigure as (link: typeof row) => void)(row)
    await screen.findByRole('dialog')
    const dialog = view.instances.find(instance => (instance.type as { __name?: string }).__name === 'ShortLinkSettingsDialog')!
    const save = dialog.vnode.props!.onSave as (input: { id: string; status: string }) => void
    const auth = view.client.getQueryData<{ user: { id: string } }>(['auth', 'me'])!
    view.client.setQueryData(['auth', 'me'], { user: { ...auth.user, id: 'next-account' } })
    save({ id: row.id, status: 'disabled' })
    await nextTick()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(view.writes).toEqual([])
  })

  // Allowing reads to imply update, or update to gate delete, breaks delete-only authority.
  it.each([false, true])('dispatches one authorized deletion without update authority and ignores duplicate queued events, admin=%s', async admin => {
    const view = await page(admin, ['delete'])
    const remove = view.list.vnode.props!.onRemove as (id: string) => void
    remove(row.id)
    remove(row.id)
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    expect(view.writes).toEqual([{ path: '/api/v1' + (admin ? '/admin' : '') + '/short-link/delete', body: { id: 'first' } }])
  })
})
