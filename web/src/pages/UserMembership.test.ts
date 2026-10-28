import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { batchAlice, batchBob, batchManager, membershipResponse, mountBatchMembership } from '@/test/user-batch-group'
import { createDeferred } from '@/test/deferred'

let view: ReturnType<typeof mountBatchMembership>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

it('reads no private list before current auth succeeds and never renders the old shared list cache', async () => {
  const auth = createDeferred<Response>()
  view = mountBatchMembership({ identityReady: false, overrides: { '/api/v1/auth/me': () => auth.promise } })
  view.client.setQueryData(['admin-user'], { items: [{ ...batchAlice, username: 'Private old cache' }], meta: { total: 1 } })
  expect(screen.queryByText('Private old cache')).toBeNull()
  expect(view.state.requests).toEqual(['/api/v1/auth/me'])
  auth.resolve(membershipResponse({ user: batchManager }))
  await screen.findByText('alice')
  expect(view.state.requests).toContain('/api/v1/admin/user/list?page=1&pageSize=20')
})

it.each(['guest', 'user'])('does not read or expose administrative accounts to %s without admin capability', async group => {
  view = mountBatchMembership({ user: { ...batchManager, group, username: group, permissions: [] } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Change selected groups' })).toHaveProperty('disabled', true))
  expect(view.state.requests).toEqual([])
  expect(screen.queryByText('alice')).toBeNull()
})

it('keeps the legacy single-account snapshot across background reads and holds the parent read barrier after success', async () => {
  view = mountBatchMembership({ users: [batchAlice, { ...batchBob, id: batchManager.id, username: 'manager' }, { ...batchBob, username: 'guest', builtin: true }] })
  await screen.findByText('alice')
  const row = screen.getAllByTestId('console-user-row')[0]!
  await fireEvent.click(within(row).getByRole('button', { name: 'More actions' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Change user group' }))
  const dialog = within(screen.getByRole('dialog'))
  view.state.users[0]!.updatedAt = '2026-10-28T04:00:00Z'
  await view.client.invalidateQueries({ queryKey: ['admin-user'] })
  await fireEvent.keyDown(dialog.getByRole('combobox', { name: 'Target group' }), { key: 'Enter' })
  await fireEvent.click(await screen.findByRole('option', { name: 'Administrator' }))
  await fireEvent.click(dialog.getByRole('checkbox', { name: 'I confirm the permission change and revocation of all existing sessions' }))
  view.state.overrides['/api/v1/admin/user/change-group'] = () => membershipResponse({ user: { ...batchAlice, group: 'admin' } })
  view.state.overrides['/api/v1/admin/user/list?page=1&pageSize=20'] = () => membershipResponse(null, 900000, 500)
  await fireEvent.click(dialog.getByRole('button', { name: 'Confirm change' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(view.state.writes[0]).toEqual({ path: '/api/v1/admin/user/change-group', input: { id: batchAlice.id, groupKey: 'admin', expectedUpdatedAt: '2026-10-28T01:02:03.123456Z' } })
  await screen.findByRole('button', { name: 'Retry user list' })
  expect(screen.getByRole('checkbox', { name: 'Select account alice' })).toHaveProperty('disabled', true)
})
