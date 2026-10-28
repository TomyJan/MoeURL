import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { setImmediate as eventLoop } from 'node:timers/promises'
import { batchAlice, batchBob, batchManager, confirmBatchMembership, membershipResponse, mountBatchMembership, openBatchMembership } from '@/test/user-batch-group'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

let view: ReturnType<typeof mountBatchMembership>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

it.each(['success', 'failure'] as const)('ignores an obsolete batch %s while the new login has its own pending confirmation', async outcome => {
  view = mountBatchMembership()
  await openBatchMembership(); await confirmBatchMembership()
  const old = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => old.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  await revokeAccountIdentity(view.client)
  view.client.setQueryData(['auth', 'me'], { user: batchManager })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await openBatchMembership(); await confirmBatchMembership()
  const fresh = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => fresh.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(2))
  const readCount = view.state.requests.length
  old.resolve(outcome === 'success' ? membershipResponse({ changedCount: 2, unchangedCount: 0 }) : membershipResponse(null, 300105))
  await eventLoop()
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
  expect(screen.queryByText('Changed 2 accounts; 0 unchanged.')).toBeNull()
  expect(screen.queryByText('The batch was not applied. Read the latest list and confirm again.')).toBeNull()
  expect(view.state.requests).toHaveLength(readCount)
  fresh.resolve(membershipResponse({ changedCount: 2, unchangedCount: 0 }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('does not show the prior account list or drafts while a different manager waits for its own read', async () => {
  view = mountBatchMembership()
  await screen.findByText('alice')
  await fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
  await fireEvent.update(screen.getByRole('textbox', { name: 'Nickname' }), 'Secret A draft')
  const readB = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/list?page=1&pageSize=20'] = () => readB.promise
  view.client.setQueryData(['auth', 'me'], { user: { ...batchManager, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } })
  await waitFor(() => expect(screen.queryByText('alice')).toBeNull())
  expect(screen.queryByRole('textbox', { name: 'Nickname' })).toBeNull()
  readB.resolve(membershipResponse({ items: [{ ...batchAlice, username: 'B-only', nickname: '' }, batchBob] }, 0, 200, { total: 2 }))
  await screen.findByText('B-only')
  await fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
  expect(screen.getByRole('textbox', { name: 'Nickname' })).toHaveProperty('value', '')
})

it('keeps legacy single-account writes exclusive and ignores their result after unmount', async () => {
  view = mountBatchMembership()
  await screen.findByText('alice')
  const create = screen.getByText('Create user').closest('a')!
  const checkbox = screen.getByRole('checkbox', { name: 'Select account alice' })
  await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]!)
  await fireEvent.click(screen.getByRole('button', { name: 'Change user group' }))
  await fireEvent.keyDown(screen.getByRole('combobox', { name: 'Target group' }), { key: 'Enter' })
  await fireEvent.click(await screen.findByRole('option', { name: 'Administrator' }))
  await fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm the permission change and revocation of all existing sessions' }))
  const write = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/change-group'] = () => write.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(create.getAttribute('aria-disabled')).toBe('true')
  expect(checkbox).toHaveProperty('disabled', true)
  const count = view.state.requests.length
  view.unmount()
  write.resolve(membershipResponse({ user: { ...batchAlice, group: 'admin' } }))
  await eventLoop()
  expect(view.state.requests).toHaveLength(count)
})

it('does not let a delayed authorization recovery from the prior manager replace a new manager or close its confirmation', async () => {
  view = mountBatchMembership()
  await openBatchMembership(); await confirmBatchMembership()
  const auth = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => membershipResponse(null, 120001)
  view.state.overrides['/api/v1/auth/me'] = () => auth.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await waitFor(() => expect(view.state.requests).toContain('/api/v1/auth/me'))
  const managerB = { ...batchManager, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }
  view.client.setQueryData(['auth', 'me'], { user: managerB })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await openBatchMembership(); await confirmBatchMembership()
  auth.resolve(membershipResponse({ user: batchManager }))
  await eventLoop()
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', false)
  expect(view.client.getQueryData(['auth', 'me'])).toEqual({ user: managerB })
})

it.each(['success', 'failure'])('does not let a prior legacy write %s clear a new pending write after same-account authorization is revoked and restored', async outcome => {
  view = mountBatchMembership()
  await screen.findByText('alice')
  await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]!)
  const old = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/update'] = () => old.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  view.client.setQueryData(['auth', 'me'], { user: { ...batchManager, permissions: [] } })
  await waitFor(() => expect(screen.queryByText('alice')).toBeNull())
  view.client.setQueryData(['auth', 'me'], { user: batchManager })
  await screen.findByText('alice')
  await fireEvent.click(screen.getAllByRole('button', { name: 'More actions' })[0]!)
  const fresh = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/update'] = () => fresh.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(2))
  const reads = view.state.requests.length
  if (outcome === 'success') old.resolve(membershipResponse({ user: { ...batchAlice, status: 'disabled' } }))
  else old.reject(new TypeError('old request disconnected'))
  await eventLoop()
  expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', true)
  expect(screen.queryByText('Saved')).toBeNull()
  expect(view.state.requests).toHaveLength(reads)
  fresh.resolve(membershipResponse({ user: { ...batchAlice, status: 'disabled' } }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', false))
})
