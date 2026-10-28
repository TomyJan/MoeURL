import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { setImmediate as eventLoop } from 'node:timers/promises'
import AdminDomainsPage from './AdminDomainsPage.vue'
import { messages } from '@/app/i18n'
import { globalId, otherId, mountRedirectDefaults, nextRevision, revision, redirectResponse } from '@/test/domain-redirect-default'
import { createDeferred } from '@/test/deferred'
import { toast } from 'vue-sonner'

let view: ReturnType<typeof mountRedirectDefaults>
const settingPath = (id: string) => '/api/v1/admin/domain/redirect-default?id=' + id
afterEach(() => { toast.dismiss(); cleanup(); view?.client.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
/** Waits for authoritative HTTP reads without sleeping. */
async function loaded() { await waitFor(() => expect(view.client.isFetching()).toBe(0)) }
/** Locates the legacy form independently of the policy editor. */
function details() { return within(screen.getByRole('textbox', { name: messages.en.domains.host }).closest('form')!) }
/** The error recovery button remains separate from a disabled stale editor. */
function retry() { return within(screen.getByText(messages.en.domainRedirectManagement.readFailed).closest('[role=alert]')!).getByRole('button', { name: 'Reload domain mode' }) }

it('allows a local mode cancellation after an ordinary background read failure', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  view.state.overrides[settingPath(globalId)] = async () => { throw new Error('offline') }
  await view.client.invalidateQueries({ queryKey: ['admin-domain-redirect-default'] })
  await screen.findByText(messages.en.domainRedirectManagement.readFailed); await loaded()
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  const cancel = screen.getByRole('button', { name: 'Cancel mode draft' })
  expect(cancel).toHaveProperty('disabled', false)
  await fireEvent.click(cancel)
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('textbox', { name: messages.en.domains.displayName })).toHaveProperty('disabled', false)
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  expect(view.state.writes).toHaveLength(0)
})

it('does not erase a dirty details draft while recovering a failed mode read', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true, overrides: { [settingPath(globalId)]: async () => { throw new Error('offline') } } })
  await screen.findByText(messages.en.domainRedirectManagement.readFailed)
  expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', false)
  await fireEvent.update(screen.getByRole('textbox', { name: messages.en.domains.displayName }), 'Unsaved details')
  delete view.state.overrides[settingPath(globalId)]
  await fireEvent.click(retry())
  await screen.findByRole('button', { name: 'Save redirect default' })
  await loaded()
  expect(screen.getByRole('textbox', { name: messages.en.domains.displayName })).toHaveProperty('value', 'Unsaved details')
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  expect(view.state.writes).toHaveLength(0)
})

it.each(['setting', 'list'])('keeps dependent writes blocked when the post-save %s read fails', async (failure) => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  const failedPath = failure === 'setting' ? settingPath(globalId) : '/api/v1/admin/domain/list'
  const previousReads = view.state.requests.filter((path) => path === failedPath).length
  view.state.overrides[failedPath] = async () => { throw new Error('offline') }
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await screen.findByText(messages.en.domainRedirectManagement.readFailed)
  await waitFor(() => expect(view.state.requests.filter((path) => path === failedPath)).toHaveLength(previousReads + 1))
  await loaded()
  await waitFor(() => expect(retry()).toHaveProperty('disabled', false))
  expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: messages.en.domainOrder.save })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Cancel mode draft' })).toHaveProperty('disabled', true)
  await fireEvent.click(within(screen.getByRole('complementary', { name: messages.en.domains.listLabel })).getByText('Global'))
  const discard = screen.queryByRole('button', { name: messages.en.domains.confirmDiscard })
  if (discard) await fireEvent.click(discard)
  expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: 'Cancel mode draft' })).toHaveProperty('disabled', true)
  delete view.state.overrides[failedPath]
  await fireEvent.click(retry())
  await loaded()
  await waitFor(() => expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', false))
  expect(view.state.writes).toHaveLength(1)
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
})

it('does not fetch a mode for an empty target when starting a new-domain form', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: messages.en.domains.add }))
  await loaded()
  expect(screen.queryByRole('heading', { name: 'Default redirect mode' })).toBeNull()
  expect(view.state.requests).not.toContain(settingPath(''))
})

it('releases an earlier account pending observer without publishing its late success into B', async () => {
  const pending = createDeferred<Response>()
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  view.state.overrides['/api/v1/admin/domain/set-redirect-default'] = async () => {
    view.state.managed[0]!.updatedAt = nextRevision
    view.state.defaults = [{ domainId: globalId, redirectMode: 'intermediate' }, { domainId: otherId, redirectMode: 'intermediate' }]
    return pending.promise
  }
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  view.state.user = { ...view.state.user, id: 'B', username: 'bob' }
  view.client.setQueryData(['auth', 'me'], { user: view.state.user })
  await screen.findByRole('button', { name: 'Direct redirect' })
  await loaded()
  expect(screen.getByRole('button', { name: 'Direct redirect' })).toHaveProperty('disabled', false)
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  pending.resolve(redirectResponse({ setting: { domainId: globalId, redirectMode: 'intermediate', updatedAt: nextRevision } }))
  await eventLoop()
  expect(screen.getByRole('button', { name: 'Direct redirect' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByText('Redirect default saved.')).toBeNull()
  expect(view.state.writes).toHaveLength(1)
})

it('does not apply a delayed other-target read or its revision to the current editor', async () => {
  const pending = createDeferred<Response>()
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true, overrides: { [settingPath(globalId)]: () => pending.promise } })
  await fireEvent.click(await screen.findByText('Other'))
  await screen.findByRole('heading', { name: 'Default redirect mode' })
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  pending.resolve(redirectResponse({ setting: { domainId: globalId, redirectMode: 'confirmation', updatedAt: nextRevision } }))
  await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ id: otherId, redirectMode: 'direct', expectedUpdatedAt: revision })
})

it('configures enhanced defaults without granting the manager short-link mode capabilities', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true, permissions: ['admin:access', 'domain:manage'] })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]).toEqual({ id: globalId, redirectMode: 'intermediate', expectedUpdatedAt: revision })
})

it('hides denied mode data and recovers only after fresh identity, list and setting reads', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true, overrides: { [settingPath(globalId)]: async () => redirectResponse(null, 120001) } })
  await screen.findByText(messages.en.domainOrder.accessDenied)
  expect(screen.queryByRole('heading', { name: 'Default redirect mode' })).toBeNull()
  delete view.state.overrides[settingPath(globalId)]
  await fireEvent.click(screen.getByRole('button', { name: messages.en.domainOrder.reloadAccess }))
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  expect(view.state.requests).toContain('/api/v1/auth/me')
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', false)
  expect(view.state.writes).toHaveLength(0)
})

it('preserves a deleted target mode draft instead of silently editing the next domain', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  view.state.managed = view.state.managed.filter(({ id }) => id !== globalId)
  await view.client.invalidateQueries({ queryKey: ['admin', 'domains'] })
  await screen.findByText(messages.en.domains.removedDraft)
  expect(screen.getByRole('textbox', { name: messages.en.domains.host })).toHaveProperty('value', 'global.example')
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByText('Other'))
  await screen.findByText(messages.en.domains.discardWarning)
  await fireEvent.click(screen.getByRole('button', { name: messages.en.domains.confirmDiscard }))
  await loaded()
  expect(screen.getByRole('textbox', { name: messages.en.domains.host })).toHaveProperty('value', 'other.example')
  expect(view.state.writes).toHaveLength(0)
})

it('keeps a stale same-value save conflicted until explicit reload supplies the new revision', async () => {
  const concurrentRevision = '2026-10-28T00:00:00.654321Z'
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  view.state.managed[0]!.updatedAt = concurrentRevision
  view.state.defaults[0]!.redirectMode = 'intermediate'
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await screen.findByText(messages.en.domainRedirectManagement.conflict)
  expect(view.state.writes[0]).toEqual({ id: globalId, redirectMode: 'intermediate', expectedUpdatedAt: revision })
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  const reload = screen.getByRole('button', { name: 'Reload domain mode' })
  await waitFor(() => expect(reload).toHaveProperty('disabled', false))
  await fireEvent.click(reload); await loaded()
  await waitFor(() => expect(screen.queryByText(messages.en.domainRedirectManagement.conflict)).toBeNull())
  await fireEvent.click(screen.getByRole('button', { name: 'Direct redirect' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(2))
  expect(view.state.writes[1]).toEqual({ id: globalId, redirectMode: 'direct', expectedUpdatedAt: concurrentRevision })
})

it('does not overwrite a dirty mode when a background read publishes a newer shared version', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  view.state.managed[0]!.updatedAt = nextRevision
  view.state.defaults[0]!.redirectMode = 'direct'
  await view.client.invalidateQueries({ queryKey: ['admin-domain-redirect-default'] })
  await screen.findByText(messages.en.domainRedirectManagement.conflict)
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel mode draft' }))
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Reload domain mode' }))
  await loaded()
  await waitFor(() => expect(screen.queryByText(messages.en.domainRedirectManagement.conflict)).toBeNull())
  expect(screen.getByRole('button', { name: 'Direct redirect' }).getAttribute('aria-pressed')).toBe('true')
  expect(view.state.writes).toHaveLength(0)
})

it('preserves an unconfirmed mode save and never retries the write automatically', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  view.state.overrides['/api/v1/admin/domain/set-redirect-default'] = async () => { throw new Error('offline') }
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await screen.findByText(messages.en.domainRedirectManagement.failed)
  expect(screen.getByRole('button', { name: 'Intermediate page' }).getAttribute('aria-pressed')).toBe('true')
  expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', true)
  await fireEvent.click(retry()); await loaded()
  await waitFor(() => expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', false))
  expect(screen.getByRole('button', { name: 'Confirmation page' }).getAttribute('aria-pressed')).toBe('true')
  expect(view.state.writes).toHaveLength(1)
})

it('rejects a captured A write if identity changes while cancellation is awaited before HTTP', async () => {
  const gate = createDeferred<void>()
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  const cancel = view.client.cancelQueries.bind(view.client)
  vi.spyOn(view.client, 'cancelQueries').mockImplementationOnce(async (...args) => { await cancel(...args); await gate.promise })
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save redirect default' })).toHaveProperty('disabled', true))
  view.state.user = { ...view.state.user, id: 'B', username: 'bob' }
  view.client.setQueryData(['auth', 'me'], { user: view.state.user })
  await screen.findByRole('button', { name: 'Direct redirect' }); await loaded()
  gate.resolve()
  await eventLoop()
  expect(view.state.writes).toHaveLength(0)
  expect(screen.queryByText(messages.en.domainRedirectManagement.failed)).toBeNull()
})

it('can recover access to an empty list without querying a nonexistent domain', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true, overrides: { [settingPath(globalId)]: async () => redirectResponse(null, 120001) } })
  await screen.findByText(messages.en.domainOrder.accessDenied)
  view.state.managed = []
  delete view.state.overrides[settingPath(globalId)]
  await fireEvent.click(screen.getByRole('button', { name: messages.en.domainOrder.reloadAccess }))
  await screen.findByText(messages.en.domains.empty)
  await waitFor(() => expect(screen.getByRole('button', { name: messages.en.domains.add })).toHaveProperty('disabled', false))
  expect(view.state.requests).not.toContain(settingPath(''))
  expect(view.state.writes).toHaveLength(0)
})

it('masks a write-time denial without replaying the mode mutation', async () => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  view.state.overrides['/api/v1/admin/domain/set-redirect-default'] = async () => redirectResponse(null, 120001)
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await screen.findByText(messages.en.domainOrder.accessDenied)
  expect(screen.queryByRole('heading', { name: 'Default redirect mode' })).toBeNull()
  expect(view.state.writes).toHaveLength(1)
  expect(screen.queryByText(messages.en.domainRedirectManagement.saved)).toBeNull()
})

it.each(['missing', 'newer'])('keeps the write barrier when independent refreshed snapshots are %s', async (kind) => {
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  view.state.overrides['/api/v1/admin/domain/set-redirect-default'] = async () => {
    view.state.defaults[0]!.redirectMode = 'intermediate'
    view.state.managed[0]!.updatedAt = '2026-10-28T00:00:02.123456Z'
    if (kind === 'missing') view.state.managed = view.state.managed.filter(({ id }) => id !== globalId)
    view.state.overrides[settingPath(globalId)] = async () => redirectResponse({ setting: { domainId: globalId, redirectMode: 'intermediate', updatedAt: nextRevision } })
    return redirectResponse({ setting: { domainId: globalId, redirectMode: 'intermediate', updatedAt: nextRevision } })
  }
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await waitFor(() => expect(view.state.requests.filter((path) => path === settingPath(globalId))).toHaveLength(2))
  await loaded()
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(screen.getByText(messages.en.domainRedirectManagement.readFailed)).toBeTruthy()
  expect(details().getByRole('button', { name: messages.en.domains.save })).toHaveProperty('disabled', true)
  expect(view.state.writes).toHaveLength(1)
})

it('does not revive A private cache after a refresh cancellation crosses an account transition', async () => {
  const gate = createDeferred<void>()
  view = mountRedirectDefaults(AdminDomainsPage, { admin: true })
  await screen.findByRole('heading', { name: 'Default redirect mode' }); await loaded()
  await fireEvent.click(screen.getByRole('button', { name: 'Intermediate page' }))
  view.state.managed[0]!.updatedAt = nextRevision
  await fireEvent.click(screen.getByRole('button', { name: 'Save redirect default' }))
  await screen.findByText(messages.en.domainRedirectManagement.conflict)
  const reload = screen.getByRole('button', { name: 'Reload domain mode' })
  await waitFor(() => expect(reload).toHaveProperty('disabled', false))
  const cancel = view.client.cancelQueries.bind(view.client)
  vi.spyOn(view.client, 'cancelQueries').mockImplementationOnce(async (...args) => { await cancel(...args); await gate.promise })
  await fireEvent.click(reload)
  await waitFor(() => expect(reload).toHaveProperty('disabled', true))
  view.state.user = { ...view.state.user, id: 'B', username: 'bob' }
  view.client.setQueryData(['auth', 'me'], { user: view.state.user })
  await screen.findByRole('button', { name: 'Direct redirect' }); await loaded()
  gate.resolve()
  await eventLoop()
  expect(view.client.getQueriesData({ queryKey: ['admin-domain-redirect-default', 'A'] })).toHaveLength(0)
  expect(view.state.writes).toHaveLength(1)
})
