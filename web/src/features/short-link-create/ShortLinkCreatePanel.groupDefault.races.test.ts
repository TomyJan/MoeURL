import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { setImmediate as flushEventLoop } from 'node:timers/promises'
import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { mountGroupDefault, response, groupId, personalId, globalId, domains, version } from '@/test/group-default'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
let view: ReturnType<typeof mountGroupDefault>
afterEach(() => { cleanup(); view.client.clear(); vi.unstubAllGlobals() })
/** Submits through the public form, observing the real HTTP payload. */
async function submit() {
  await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
  await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.submit' }))
}
/** Waits for all initial selection requirements rather than relying on fixed delays. */
async function ready() { await waitFor(() => expect(screen.getByRole('button', { name: 'shortLinkCreate.submit' })).toHaveProperty('disabled', false)) }

it('blocks an unknown group choice and preserves an explicit system fallback over the late result', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/group-default': () => pending.promise } })
  await screen.findByText('groupDefault.loading')
  await submit()
  expect(view.writes).toHaveLength(0)
  await fireEvent.click(screen.getByRole('button', { name: 'domainPreference.useSystem' }))
  await ready()
  pending.resolve(response({ selection: { status: 'available', domainId: groupId } }))
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  await submit()
  await waitFor(() => expect(view.writes).toHaveLength(1))
  expect(view.writes[0]?.input).toEqual({ targetUrl: 'https://target.example/docs' })
})

it('provides explicit recovery after a group read failure even with only one candidate', async () => {
  view = mountGroupDefault(ShortLinkCreatePanel, { domains: [domains[0]!], overrides: { '/api/v1/domain/group-default': async () => { throw new Error('offline') } } })
  await screen.findByText('groupDefault.loadFailed')
  expect(screen.getByRole('button', { name: 'shortLinkCreate.submit' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'domainPreference.useSystem' }))
  await submit()
  await waitFor(() => expect(view.writes).toHaveLength(1))
  expect(view.writes[0]?.input).toEqual({ targetUrl: 'https://target.example/docs' })
})

it('retries the group read explicitly and then sends the loaded selection', async () => {
  view = mountGroupDefault(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/group-default': async () => { throw new Error('offline') } } })
  await screen.findByText('groupDefault.loadFailed')
  delete view.overrides['/api/v1/domain/group-default']
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.retry' }))
  await ready(); await submit()
  await waitFor(() => expect(view.writes[0]?.input.domainId).toBe(groupId))
})

it.each(['personal', 'manual'])('lets a valid %s choice bypass a pending group read', async (priority) => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(ShortLinkCreatePanel, { personal: priority === 'personal' ? personalId : null, overrides: { '/api/v1/domain/group-default': () => pending.promise } })
  const select = await screen.findByLabelText('shortLinkCreate.domainLabel')
  if (priority === 'manual') await fireEvent.update(select, personalId)
  await ready()
  pending.resolve(response({ selection: { status: 'available', domainId: groupId } }))
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  await submit()
  await waitFor(() => expect(view.writes[0]?.input.domainId).toBe(personalId))
})

it.each(['not_set', 'unavailable'])('falls back to ordered assigned candidates for %s without inventing an option', async (status) => {
  view = mountGroupDefault(ShortLinkCreatePanel, { domains: [domains[2]!, domains[1]!], selection: { status, domainId: null } })
  await ready()
  if (status === 'unavailable') await screen.findByText('groupDefault.unavailable')
  expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', personalId)
  await submit()
  await waitFor(() => expect(view.writes[0]?.input.domainId).toBe(personalId))
})

it('uses the group domain current role to omit a now-global UUID', async () => {
  view = mountGroupDefault(ShortLinkCreatePanel, { domains: [{ ...domains[0]!, isDefault: false }, { ...domains[1]!, isDefault: true }] })
  await ready(); await submit()
  await waitFor(() => expect(view.writes).toHaveLength(1))
  expect(view.writes[0]?.input).toEqual({ targetUrl: 'https://target.example/docs' })
})

it('refreshes group and available choices after 200114 with zero automatic resend', async () => {
  view = mountGroupDefault(ShortLinkCreatePanel)
  await ready()
  view.state.selection = { domainId: personalId, status: 'available' }
  await submit()
  await waitFor(() => expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', personalId))
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  expect(view.requests.filter((path) => path === '/api/v1/domain/group-default')).toHaveLength(2)
  expect(view.requests).toContain('/api/v1/auth/me')
  expect(view.writes).toHaveLength(1)
  await submit()
  await waitFor(() => expect(view.writes).toHaveLength(2))
  expect(view.writes[1]?.input.domainId).toBe(personalId)
})

it.each(['roundtrip', 'same-id'])('rejects a late group read from an earlier %s login epoch', async (kind) => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(ShortLinkCreatePanel, { overrides: { '/api/v1/domain/group-default': () => pending.promise } })
  await screen.findByText('groupDefault.loading')
  delete view.overrides['/api/v1/domain/group-default']
  view.state.selection = { domainId: personalId, status: 'available' }
  if (kind === 'roundtrip') view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: 'B' } })
  else revokeAccountIdentity(view.client)
  view.client.setQueryData(['auth', 'me'], { user: view.user })
  await ready()
  pending.resolve(response({ selection: { status: 'available', domainId: groupId } }))
  await flushEventLoop()
  expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', personalId)
  expect(view.client.getQueriesData({ queryKey: ['group-default-domain', 'A'] })).toHaveLength(1)
  await submit()
  await waitFor(() => expect(view.writes[0]?.input.domainId).toBe(personalId))
})

it('does not publish a late auth refresh into a different account', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(ShortLinkCreatePanel, { overrides: { '/api/v1/auth/me': () => pending.promise } })
  await ready(); await submit()
  await waitFor(() => expect(view.requests).toContain('/api/v1/auth/me'))
  const other = { ...view.user, id: 'B', username: 'bob' }
  view.state.user = other
  view.client.setQueryData(['auth', 'me'], { user: other })
  pending.resolve(response({ user: view.user }))
  await flushEventLoop()
  expect(view.client.getQueryData(['auth', 'me'])).toEqual({ user: other })
})

it('does not reveal the saved unavailable personal UUID while using a valid group choice', async () => {
  view = mountGroupDefault(ShortLinkCreatePanel, { personal: '44444444-4444-4444-8444-444444444444' })
  await ready()
  await screen.findByText('domainPreference.fallback')
  expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', groupId)
  expect(document.body.textContent).not.toContain('44444444-4444-4444-8444-444444444444')
  await submit()
  await waitFor(() => expect(view.writes[0]?.input.domainId).toBe(groupId))
})

it('allows manual global selection while personal and group reads are both unknown', async () => {
  const personal = createDeferred<Response>(); const group = createDeferred<Response>()
  view = mountGroupDefault(ShortLinkCreatePanel, { overrides: { '/api/v1/user/domain-preference': () => personal.promise, '/api/v1/domain/group-default': () => group.promise } })
  const select = await screen.findByLabelText('shortLinkCreate.domainLabel')
  await fireEvent.update(select, groupId); await fireEvent.update(select, '')
  await ready()
  personal.resolve(response({ preference: { domainId: personalId, updatedAt: version } }))
  group.resolve(response({ selection: { status: 'available', domainId: groupId } }))
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  await submit()
  await waitFor(() => expect(view.writes[0]?.input).toEqual({ targetUrl: 'https://target.example/docs' }))
  expect(view.writes[0]?.input.domainId).not.toBe(globalId)
})
