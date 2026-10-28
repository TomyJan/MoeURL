import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { batchAlice, batchBob, confirmBatchMembership, membershipResponse, mountBatchMembership, openBatchMembership } from '@/test/user-batch-group'
import { createDeferred } from '@/test/deferred'

let view: ReturnType<typeof mountBatchMembership>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

it('selects the two real current-list accounts and opens their group confirmation', async () => {
  view = mountBatchMembership()
  await screen.findByText('alice')
  await screen.findByText('bob')
  // The old page renders the accounts but lacks this new user action: a genuine behavior RED.
  expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'Select account bob' })).toBeTruthy()
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select eligible accounts in this list' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Change selected groups' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText('alice')).toBeTruthy()
  expect(dialog.getByText('bob')).toBeTruthy()
  expect(dialog.getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', true)
})

it.each(['all-removed', 'partly-ineligible'] as const)('reconciles the current selection after cancelling a frozen confirmation with %s accounts', async kind => {
  view = mountBatchMembership()
  await openBatchMembership()
  const charlie = { ...batchAlice, id: '44444444-4444-4444-8444-444444444444', username: 'charlie', nickname: 'Charlie' }
  view.state.users = kind === 'all-removed' ? [charlie] : [{ ...batchAlice, builtin: true }, batchBob]
  await view.client.refetchQueries({ queryKey: ['admin-user', '11111111-1111-4111-8111-111111111111', 1] })
  // The currently open confirmation must retain both original accounts until explicitly cancelled.
  const frozen = within(screen.getByRole('dialog'))
  expect(frozen.getByText('alice')).toBeTruthy()
  expect(frozen.getByText('bob')).toBeTruthy()
  await fireEvent.click(frozen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  if (kind === 'all-removed') {
    expect(screen.queryByText('2 accounts selected')).toBeNull()
    expect(screen.getByRole('button', { name: 'Change selected groups' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveProperty('disabled', false)
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Select account charlie' }))
  } else {
    expect(screen.getByText('1 account selected')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Select account bob' })).toHaveProperty('checked', true)
  }
  await fireEvent.click(screen.getByRole('button', { name: 'Change selected groups' }))
  const reopened = within(screen.getByRole('dialog'))
  expect(reopened.queryByText('alice')).toBeNull()
  expect(reopened.getByText(kind === 'all-removed' ? 'charlie' : 'bob')).toBeTruthy()
  if (kind === 'all-removed') expect(reopened.queryByText('bob')).toBeNull()
  expect(view.state.writes).toEqual([])
})

it.each([
  { users: [batchAlice], selected: '1 account selected', changedCount: 1, unchangedCount: 0, success: 'Changed 1 account; 0 unchanged.' },
  { users: [batchAlice, batchBob], selected: '2 accounts selected', changedCount: 2, unchangedCount: 0, success: 'Changed 2 accounts; 0 unchanged.' },
  { users: [batchAlice, { ...batchBob, group: 'admin' }], selected: '2 accounts selected', changedCount: 1, unchangedCount: 1, success: 'Changed 1 account; 1 unchanged.' },
])('reports $selected and the committed changed/unchanged counts in English', async ({ users, selected, changedCount, unchangedCount, success }) => {
  view = mountBatchMembership({ users })
  await screen.findByText('alice')
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Select eligible accounts in this list' }))
  expect(screen.getByText(selected)).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'Change selected groups' }))
  await confirmBatchMembership()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => membershipResponse({ changedCount, unchangedCount })
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await screen.findByText(success)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(view.state.writes).toHaveLength(1)
  expect(view.state.writes[0]!.input).toEqual({ items: users.map(item => ({ id: item.id, expectedUpdatedAt: item.updatedAt })), groupKey: 'admin' })
})

it('sends the frozen full-precision batch once, then holds a read barrier until an actual successful retry', async () => {
  view = mountBatchMembership()
  await openBatchMembership()
  await confirmBatchMembership()
  const write = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => write.promise
  view.state.overrides['/api/v1/admin/user/list?page=1&pageSize=20'] = () => membershipResponse(null, 900000, 500)
  // A later background record must not replace the confirmation's original version.
  view.client.setQueryData(['admin-user', '11111111-1111-4111-8111-111111111111', 1], { items: [{ ...batchAlice, updatedAt: '2026-10-28T03:00:00Z' }, batchBob], meta: { total: 2 } })
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  expect(view.state.writes[0]!.input).toEqual({ items: [{ id: batchAlice.id, expectedUpdatedAt: '2026-10-28T01:02:03.123456Z' }, { id: batchBob.id, expectedUpdatedAt: '2026-10-28T01:02:04.654321Z' }], groupKey: 'admin' })
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  expect(view.state.writes).toHaveLength(1)
  write.resolve(membershipResponse({ changedCount: 2, unchangedCount: 0 }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  await screen.findByText('Changed 2 accounts; 0 unchanged.')
  await screen.findByRole('button', { name: 'Retry user list' })
  expect(screen.queryByText('Could not confirm the batch outcome. Refresh to check its outcome before retrying.')).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Select eligible accounts in this list' })).toHaveProperty('disabled', true)
  delete view.state.overrides['/api/v1/admin/user/list?page=1&pageSize=20']
  await fireEvent.click(screen.getByRole('button', { name: 'Retry user list' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', false))
})

it.each([300105, 300103, 300102, 300106, 100001])('discards a rejected batch %s and requires a successful fresh list before reselection', async code => {
  view = mountBatchMembership()
  await openBatchMembership()
  await confirmBatchMembership()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => membershipResponse(null, code)
  const read = createDeferred<Response>()
  view.state.overrides['/api/v1/admin/user/list?page=1&pageSize=20'] = () => read.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await screen.findByText('The batch was not applied. Read the latest list and confirm again.')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', true)
  read.resolve(membershipResponse({ items: [batchAlice, batchBob] }, 0, 200, { total: 2 }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', false))
  expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('checked', false)
})

it.each([500, 'network'] as const)('keeps the original confirmation after %s without silently replaying a possibly committed write', async kind => {
  view = mountBatchMembership()
  await openBatchMembership()
  await confirmBatchMembership()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => {
    if (kind === 'network') throw new TypeError('Network disconnected')
    return membershipResponse(null, 900000, 500)
  }
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await screen.findByText('Could not confirm the batch outcome. Refresh to check its outcome before retrying.')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save group changes' })).toHaveProperty('disabled', false)
  expect(view.state.writes).toHaveLength(1)
  await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('2 accounts selected')).toBeTruthy()
})

it.each([120001, 401, 403])('refreshes current authorization after batch denial %s and hides revoked account data', async code => {
  view = mountBatchMembership()
  await openBatchMembership()
  await confirmBatchMembership()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => membershipResponse(null, code === 120001 ? code : 900000, code === 120001 ? 200 : code)
  view.state.user = { ...view.state.user, group: 'user', permissions: [] }
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await waitFor(() => expect(view.state.requests).toContain('/api/v1/auth/me'))
  await waitFor(() => expect(screen.queryByText('alice')).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByRole('button', { name: 'Change selected groups' })).toHaveProperty('disabled', true)
})

it('holds an authorization recovery failure behind a retryable barrier and rechecks identity before reading again', async () => {
  view = mountBatchMembership()
  await openBatchMembership(); await confirmBatchMembership()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => membershipResponse(null, 120001)
  view.state.overrides['/api/v1/auth/me'] = () => membershipResponse(null, 900000, 500)
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await screen.findByText('Authorization changed. Verify the current identity again.')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry user list' })).toHaveProperty('disabled', false))
  expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', true)
  delete view.state.overrides['/api/v1/auth/me']
  await fireEvent.click(screen.getByRole('button', { name: 'Retry user list' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', false))
  expect(view.state.requests.filter(path => path === '/api/v1/auth/me')).toHaveLength(2)
  expect(view.state.writes).toHaveLength(1)
})

it('offers a real HTTP list retry after an initial read failure without replaying any write', async () => {
  view = mountBatchMembership({ overrides: { '/api/v1/admin/user/list?page=1&pageSize=20': () => membershipResponse(null, 900000, 500) } })
  await screen.findByText('Failed to load users')
  delete view.state.overrides['/api/v1/admin/user/list?page=1&pageSize=20']
  await fireEvent.click(screen.getByRole('button', { name: 'Retry user list' }))
  await screen.findByText('alice')
  expect(view.state.writes).toEqual([])
})

it('explains an empty eligible selection when only protected accounts are visible', async () => {
  view = mountBatchMembership({ users: [{ ...batchAlice, builtin: true }] })
  await screen.findByText('alice')
  expect(screen.getByText('No eligible accounts in this list.')).toBeTruthy()
  expect(screen.getByRole('checkbox', { name: 'Select eligible accounts in this list' })).toHaveProperty('disabled', true)
})

it.each(['invalid-count', 'malformed-json'])('keeps the outcome uncertain after a %s success response rather than claiming zero changes', async kind => {
  view = mountBatchMembership()
  await openBatchMembership(); await confirmBatchMembership()
  view.state.overrides['/api/v1/admin/user/batch-change-group'] = () => kind === 'invalid-count'
    ? membershipResponse({ changedCount: 1, unchangedCount: 0 })
    : new Response('not-json', { status: 200 })
  await fireEvent.click(screen.getByRole('button', { name: 'Save group changes' }))
  await screen.findByText('Could not confirm the batch outcome. Refresh to check its outcome before retrying.')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.queryByText('The batch was not applied. Read the latest list and confirm again.')).toBeNull()
  expect(view.state.writes).toHaveLength(1)
})
