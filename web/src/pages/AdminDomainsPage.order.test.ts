import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { setImmediate as flushEventLoop } from 'node:timers/promises'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import AdminDomainsPage from './AdminDomainsPage.vue'
import type { ManagedDomain } from '@/entities/domain/api'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const primary: ManagedDomain = {
  id: '00000000-0000-4000-8000-000000000801', host: 'https://primary.example', displayName: 'Primary',
  purpose: 'short_link', enabled: true, isDefault: true, sortOrder: 0, allowedGroups: ['admin', 'user'], referenced: false, updatedAt: '2026-10-27T01:02:03.123456Z',
}
const secondary: ManagedDomain = { ...primary, id: '00000000-0000-4000-8000-000000000802', host: 'https://secondary.example', displayName: 'Secondary', isDefault: false }
const clients: QueryClient[] = []
function response(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: '', data, meta: {} })) }

/** Runs the real editor, API parser, identity observer and QueryClient; only HTTP is controlled. */
function mount(options: { save?: () => Promise<Response>; listFails?: boolean; authFails?: boolean; authPermissions?: string[]; authRead?: () => Promise<Response>; read?: () => Promise<ManagedDomain[]>; realVuetify?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  clients.push(client)
  const user = { id: 'A', username: 'admin', nickname: '', group: 'admin', permissions: ['admin:access', 'domain:manage'] }
  client.setQueryData(['auth', 'me'], { user })
  let items = [{ ...primary }, { ...secondary }]
  const bodies: Array<{ id: string; sortOrder: number; expectedUpdatedAt: string }> = []
  const reads: string[] = []
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    requests.push(url)
    if (url === '/api/v1/auth/me') {
      if (options.authRead) return options.authRead()
      if (options.authFails) throw new Error('controlled auth read failure')
      return response({ user: { ...user, permissions: options.authPermissions ?? user.permissions } })
    }
    if (url === '/api/v1/admin/domain/list') {
      reads.push(url)
      if (options.listFails) throw new Error('controlled offline list')
      return response({ items: options.read ? await options.read() : items })
    }
    if (url === '/api/v1/admin/domain/set-order') {
      const input = JSON.parse(init.body as string)
      bodies.push(input)
      if (options.save) return options.save()
      const saved = { ...items.find(({ id }) => id === input.id)!, sortOrder: input.sortOrder, updatedAt: '2026-10-27T01:02:04.654321Z' }
      items = items.map((item) => item.id === saved.id ? saved : item)
      return response({ domain: saved })
    }
    if (url === '/api/v1/admin/domain/update') {
      const input = JSON.parse(init.body as string)
      const saved = { ...items.find(({ id }) => id === input.id)!, host: input.host, displayName: input.displayName, enabled: input.enabled, allowedGroups: input.allowedGroups, updatedAt: '2026-10-27T01:02:07.123456Z' }
      items = items.map((item) => item.id === saved.id ? saved : item)
      return response({ domain: saved })
    }
    throw new Error(`Unexpected request ${url}`)
  }))
  if (options.realVuetify) {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} }))
    vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  }
  const view = render(AdminDomainsPage, { global: {
    plugins: options.realVuetify ? [[VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives })] : [[VueQueryPlugin, { queryClient: client }]],
    stubs: options.realVuetify ? { ActionToast: componentStubs.ActionToast } : componentStubs,
  } })
  return { ...view, client, bodies, reads, requests, user, options, setItems: (value: ManagedDomain[]) => { items = value } }
}

async function selectSecondary() {
  await fireEvent.click(await screen.findByRole('button', { name: /Secondary/ }))
  await waitFor(() => expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '0'))
}
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('domain ordering with real queries', () => {
  it.each(['button', 'native form'])('submits real Vuetify fields through the independent %s path', async (method) => {
    const { bodies } = mount({ realVuetify: true })
    await selectSecondary()
    const input = screen.getByRole('textbox', { name: 'domainOrder.value' })
    input.focus()
    await fireEvent.update(input, '-20')
    const form = input.closest('form')!
    expect(form.parentElement?.closest('form')).toBeNull()
    if (method === 'button') await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    else await fireEvent.submit(form)
    await waitFor(() => expect(bodies).toEqual([{ id: secondary.id, sortOrder: -20, expectedUpdatedAt: secondary.updatedAt }]))
  })
  it.each([-10000, 0, 10000])('saves priority %s as one exact versioned command', async (value) => {
    const { bodies } = mount()
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), String(value))
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await waitFor(() => expect(bodies).toEqual([{ id: secondary.id, sortOrder: value, expectedUpdatedAt: secondary.updatedAt }]))
    await screen.findByText('domainOrder.saved')
    expect(screen.getByRole('button', { name: /Secondary/ }).getAttribute('aria-current')).toBe('true')
  })

  it.each(['', '1.5', '1e2', '10001', '-10001', '+1', ' 1', '1 '])('rejects non-decimal/range input %j without a write', async (value) => {
    const { bodies } = mount()
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), value)
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    await fireEvent.submit(screen.getByLabelText('domainOrder.value').closest('form')!)
    expect(bodies).toEqual([])
    expect(screen.getByText(/domainOrder.invalid/)).toBeTruthy()
  })

  it('keeps drafts mutually exclusive and confirms a switch before dropping an order edit', async () => {
    const { bodies } = mount()
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Details draft')
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('disabled', true)
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'Secondary')
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'domains.setDefault' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'domains.delete' })).toHaveProperty('disabled', true)
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    await fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'domains.cancel' }))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    expect(screen.queryByLabelText('domainOrder.value')).toBeNull()
    expect(screen.getByText('domains.createTitle')).toBeTruthy()
    expect(bodies).toEqual([])
  })

  it('keeps all writes blocked after a saved order until a failed list refresh is retried successfully', async () => {
    const { bodies, reads, options } = mount()
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    options.listFails = true
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domains.loadFailed')
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'domains.save' })).toHaveProperty('disabled', true)
    expect(bodies).toHaveLength(1)
    options.listFails = false
    await fireEvent.click(screen.getByRole('button', { name: 'domains.retry' }))
    await waitFor(() => expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('disabled', false))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
    expect(reads).toHaveLength(3)
    expect(bodies).toHaveLength(1)
  })

  it('preserves a conflicted order and original revision until explicit successful reload', async () => {
    const options = { save: async () => response(null, 210103) }
    const { bodies, reads, setItems } = mount(options)
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    setItems([primary, { ...secondary, sortOrder: 80, updatedAt: '2026-10-27T01:02:05.111111Z' }])
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.conflict')
    await waitFor(() => expect(reads).toHaveLength(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', false))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
    expect(bodies).toEqual([{ id: secondary.id, sortOrder: -20, expectedUpdatedAt: secondary.updatedAt }])
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reload' }))
    await waitFor(() => expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '80'))
    expect(bodies).toHaveLength(1)
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-30')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual({ id: secondary.id, sortOrder: -30, expectedUpdatedAt: '2026-10-27T01:02:05.111111Z' })
  })

  it('blocks stale order writes when a conflict refresh fails while keeping its draft visible', async () => {
    const { options, client } = mount({ save: async () => response(null, 210103) })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    options.listFails = true
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domains.loadFailed')
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
  })

  it('blocks further order writes after a server permission denial', async () => {
    const { client } = mount({ save: async () => response(null, 120001) })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.saveFailed')
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await waitFor(() => expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true))
  })

  it('does not adopt a newer conflict revision merely by cancelling local input', async () => {
    const { client, bodies, setItems } = mount({ save: async () => response(null, 210103) })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    setItems([primary, { ...secondary, sortOrder: 80, updatedAt: '2026-10-27T01:02:05.111111Z' }])
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.conflict')
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.cancel' }))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '0')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]?.expectedUpdatedAt).toBe(secondary.updatedAt)
  })

  it('retains an unchanged conflicted order snapshot across a separate details save until explicit reload', async () => {
    const { client, setItems } = mount({ save: async () => response(null, 210103) })
    await selectSecondary()
    setItems([primary, { ...secondary, sortOrder: 80, updatedAt: '2026-10-27T01:02:05.111111Z' }])
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.conflict')
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await fireEvent.update(screen.getByLabelText('domains.displayName'), 'New details')
    await fireEvent.click(screen.getByRole('button', { name: 'domains.save' }))
    await screen.findByText('domains.saved')
    await waitFor(() => expect(client.isMutating() + client.isFetching()).toBe(0))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '0')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reload' }))
    await waitFor(() => expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '80'))
  })

  it('recovers a confirmed permission denial only through successful explicit identity and domain reads', async () => {
    const { options, client, bodies, reads } = mount({ save: async () => response(null, 120001) })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.accessDenied')
    await waitFor(() => expect(client.isMutating()).toBe(0))
    options.authFails = true
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reloadAccess' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'domainOrder.reloadAccess' })).toHaveProperty('disabled', false))
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    options.authFails = false; options.authPermissions = []
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reloadAccess' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'domainOrder.reloadAccess' })).toHaveProperty('disabled', false))
    expect(reads).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    options.authPermissions = undefined; options.listFails = true
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reloadAccess' }))
    await screen.findByText('domains.loadFailed')
    await waitFor(() => expect(screen.getByRole('button', { name: 'domainOrder.reloadAccess' })).toHaveProperty('disabled', false))
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    options.listFails = false; options.save = undefined
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reloadAccess' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', false))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.saved')
    expect(bodies).toHaveLength(2)
  })

  it.each(['auth', 'domains'])('keeps an older access read at the %s stage out of the new account cache', async (stage) => {
    const authRead = createDeferred<Response>()
    const domainRead = createDeferred<ManagedDomain[]>()
    const { client, options, user, requests, reads } = mount({ save: async () => response(null, 120001) })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.accessDenied')
    await waitFor(() => expect(client.isMutating()).toBe(0))
    if (stage === 'auth') options.authRead = () => authRead.promise
    else options.read = () => domainRead.promise
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reloadAccess' }))
    await waitFor(() => expect(stage === 'auth' ? requests.filter((url) => url === '/api/v1/auth/me').length : reads.length).toBe(stage === 'auth' ? 1 : 2))
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reloadAccess' }))
    expect(requests.filter((url) => url === '/api/v1/auth/me')).toHaveLength(1)
    options.authRead = undefined; options.read = undefined
    client.setQueryData(['auth', 'me'], { user: { ...user, id: 'B' } })
    if (stage === 'auth') authRead.resolve(response({ user }))
    else domainRead.resolve([primary, { ...secondary, sortOrder: 80 }])
    await flushEventLoop()
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await nextTick()
    expect(client.getQueryData<{ user: { id: string } }>(['auth', 'me'])?.user.id).toBe('B')
    await waitFor(() => expect(client.getQueryData<{ items: ManagedDomain[] }>(['admin', 'domains', 'B', 2])?.items[1]?.sortOrder).toBe(0))
    expect(screen.queryByText('domainOrder.accessDenied')).toBeNull()
  })

  it('blocks a write when a fresh identity read fails even though old identity data remains cached', async () => {
    const { client, options, bodies } = mount()
    await selectSecondary()
    options.authFails = true
    await client.refetchQueries({ queryKey: ['auth', 'me'] })
    await waitFor(() => expect(client.isFetching()).toBe(0))
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    await fireEvent.submit(screen.getByLabelText('domainOrder.value').closest('form')!)
    expect(bodies).toEqual([])
  })

  it.each(['offline', 'deleted', 'unmount', 'same-account', 'revoked'])('preserves an explicit order reload over %s', async (failure) => {
    const gate = createDeferred<ManagedDomain[]>()
    const { client, options, user, reads, setItems, unmount, bodies } = mount({ save: async () => response(null, 210103) })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await screen.findByText('domainOrder.conflict')
    await waitFor(() => expect(client.isMutating()).toBe(0))
    if (failure === 'offline') options.listFails = true
    else if (failure === 'deleted') setItems([primary])
    else options.read = () => gate.promise
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reload' }))
    if (failure === 'offline') {
      await screen.findByText('domains.loadFailed')
      expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
      options.listFails = false
      await fireEvent.click(screen.getByRole('button', { name: 'domains.retry' }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'domainOrder.reload' })).toHaveProperty('disabled', false))
      expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
      await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reload' }))
      await waitFor(() => expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '0'))
    } else if (failure === 'deleted') {
      await screen.findByText('domains.removedDraft')
      expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
      expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    } else {
      await waitFor(() => expect(reads).toHaveLength(3))
      await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.reload' }))
      await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
      expect(reads).toHaveLength(3)
      expect(screen.queryByText('domains.createTitle')).toBeNull()
      options.read = undefined
      if (failure === 'unmount') unmount()
      else if (failure === 'same-account') { await revokeAccountIdentity(client); client.setQueryData(['auth', 'me'], { user }) }
      else client.setQueryData(['auth', 'me'], { user: { ...user, permissions: [] } })
      gate.resolve([primary, { ...secondary, sortOrder: 80 }])
      await waitFor(() => expect(client.isFetching()).toBe(0))
      if (failure === 'same-account') expect(client.getQueryData<{ items: ManagedDomain[] }>(['admin', 'domains', 'A', 3])?.items[1]?.sortOrder).toBe(0)
      if (failure === 'revoked') expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    }
    expect(bodies).toHaveLength(1)
  })

  it('prevents duplicate submission and selection changes during the order request', async () => {
    const pending = createDeferred<Response>()
    const { bodies, client } = mount({ save: () => pending.promise })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    await fireEvent.submit(screen.getByLabelText('domainOrder.value').closest('form')!)
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    expect(screen.getByRole('button', { name: /Secondary/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('button', { name: 'domains.add' })).toHaveProperty('disabled', true)
    await fireEvent.click(screen.getByRole('button', { name: 'domains.add' }))
    expect(screen.queryByText('domains.createTitle')).toBeNull()
    expect(bodies).toHaveLength(1)
    pending.resolve(response({ domain: { ...secondary, sortOrder: -20, updatedAt: '2026-10-27T01:02:06Z' } }))
    await waitFor(() => expect(client.isMutating()).toBe(0))
  })

  it('suppresses late errors and synchronously blocks writes after a permission cache revocation', async () => {
    const pending = createDeferred<Response>()
    const { bodies, client, user } = mount({ save: () => pending.promise })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    client.setQueryData(['auth', 'me'], { user: { ...user, permissions: [] } })
    await nextTick()
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    pending.resolve(response(null, 900000))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(screen.queryByText('domainOrder.saveFailed')).toBeNull()
    expect(bodies).toHaveLength(1)
  })

  it('restores the current saved order when normal local edits are cancelled', async () => {
    const { bodies } = mount()
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.cancel' }))
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '0')
    expect(screen.getByLabelText('domains.displayName')).toHaveProperty('disabled', false)
    expect(bodies).toEqual([])
  })

  it('rejects a queued submission from the previous editor before its selection patch finishes', async () => {
    const { bodies } = mount()
    await selectSecondary()
    const oldForm = screen.getByLabelText('domainOrder.value').closest('form')!
    // Both events dispatch synchronously; await only after the old form has submitted.
    await Promise.all([fireEvent.click(screen.getByRole('button', { name: /Primary/ })), fireEvent.submit(oldForm)])
    expect(screen.getByRole('button', { name: /Primary/ }).getAttribute('aria-current')).toBe('true')
    expect(bodies).toEqual([])
  })

  it('rejects a stale legacy action event after synchronous permission loss', async () => {
    const { client, user, requests } = mount()
    await selectSecondary()
    client.setQueryData(['auth', 'me'], { user: { ...user, permissions: [] } })
    const button = screen.getByRole('button', { name: 'domains.setDefault' })
    await waitFor(() => expect(button).toHaveProperty('disabled', true))
    await fireEvent.click(button)
    expect(requests).not.toContain('/api/v1/admin/domain/set-default')
  })

  it.each(['same-account', 'unmount'])('suppresses a late failed response after %s', async (transition) => {
    const pending = createDeferred<Response>()
    const { bodies, client, user, unmount } = mount({ save: () => pending.promise })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    if (transition === 'unmount') unmount()
    else { await revokeAccountIdentity(client); client.setQueryData(['auth', 'me'], { user }) }
    pending.resolve(response(null, 210103))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(screen.queryByText('domainOrder.conflict')).toBeNull()
    expect(bodies).toHaveLength(1)
  })

  it.each(['guest', 'B', 'same-account', 'unmount'])('suppresses a late save after %s without cache/feedback/refresh contamination', async (transition) => {
    const pending = createDeferred<Response>()
    const { client, bodies, reads, user, unmount } = mount({ save: () => pending.promise })
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    await fireEvent.click(screen.getByRole('button', { name: 'domainOrder.save' }))
    await waitFor(() => expect(bodies).toHaveLength(1))
    if (transition === 'unmount') unmount()
    else if (transition === 'B') client.setQueryData(['auth', 'me'], { user: { ...user, id: 'B' } })
    else { await revokeAccountIdentity(client); if (transition === 'same-account') client.setQueryData(['auth', 'me'], { user }) }
    await nextTick()
    await waitFor(() => expect(client.isFetching({ queryKey: ['admin', 'domains'] })).toBe(0))
    const readCount = reads.length
    pending.resolve(response({ domain: { ...secondary, sortOrder: -20, updatedAt: '2026-10-27T01:02:06Z' } }))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(screen.queryByText('domainOrder.saved')).toBeNull()
    expect(reads).toHaveLength(readCount)
    for (const [, data] of client.getQueriesData<{ items: ManagedDomain[] }>({ queryKey: ['admin', 'domains'] })) {
      if (data) expect(data.items.find(({ id }) => id === secondary.id)?.sortOrder).toBe(0)
    }
  })

  it('disables a deleted target and retains its unsaved order until a confirmed switch', async () => {
    const { client, setItems, bodies } = mount()
    await selectSecondary()
    await fireEvent.update(screen.getByLabelText('domainOrder.value'), '-20')
    setItems([primary])
    await client.refetchQueries({ queryKey: ['admin', 'domains'] })
    await screen.findByText('domains.removedDraft')
    expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '-20')
    expect(screen.getByRole('button', { name: 'domainOrder.save' })).toHaveProperty('disabled', true)
    expect(bodies).toEqual([])
    await fireEvent.click(screen.getByRole('button', { name: /Primary/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'domains.confirmDiscard' }))
    await waitFor(() => expect(screen.getByLabelText('domainOrder.value')).toHaveProperty('value', '0'))
  })
})
