import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import { setImmediate as flushEventLoop } from 'node:timers/promises'
import AdminUserGroupsPage from './AdminUserGroupsPage.vue'
import { mountGroupDefault, response, groupId, version, nextVersion } from '@/test/group-default'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
let view: ReturnType<typeof mountGroupDefault>
afterEach(() => { cleanup(); view.client.clear(); vi.unstubAllGlobals() })
/** Opens a real target editor only after both versioned reads have completed. */
async function userEditor() {
  await fireEvent.click(await screen.findByRole('tab', { name: 'user' }))
  const select = await screen.findByLabelText('groupDefault.domain')
  await waitFor(() => expect(select).toHaveProperty('disabled', false))
  return select
}

it('keeps permissions locked until the corresponding default snapshot is known', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/domain-default?groupKey=user': () => pending.promise } })
  await fireEvent.click(await screen.findByRole('tab', { name: 'user' }))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('disabled', true)
  pending.resolve(response(view.management('user')))
  await waitFor(() => expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('disabled', false))
})

it('preserves both independent drafts when changing tabs and when candidates refresh at the same revision', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  const select = await userEditor()
  await fireEvent.update(select, groupId)
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('tab', { name: 'admin' }))
  await waitFor(() => expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('disabled', false))
  await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('tab', { name: 'user' }))
  const key = view.client.getQueriesData({ queryKey: ['admin-user-group-domain-default'] }).find(([key]) => key[3] === 'user')![0]
  view.client.setQueryData(key, view.management('user'))
  await nextTick()
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('value', groupId)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.cancel' }))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('disabled', false)
  await fireEvent.click(screen.getByRole('tab', { name: 'admin' }))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
})

it('preserves a dirty original snapshot on background version change and explicitly reloads both forms', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await fireEvent.update(await userEditor(), groupId)
  const key = view.client.getQueriesData({ queryKey: ['admin-user-groups'] })[0]![0]
  view.groups.find(({ key }) => key === 'user')!.updatedAt = nextVersion
  view.client.setQueryData(key, view.catalog())
  await screen.findAllByText('userGroups.dataStale')
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('value', groupId)
  expect(screen.getByRole('button', { name: 'groupDefault.save' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.reload' }))
  await waitFor(() => expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('value', '')
  await fireEvent.update(screen.getByLabelText('groupDefault.domain'), groupId)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await waitFor(() => expect(view.writes[0]?.input.expectedUpdatedAt).toBe(nextVersion))
})

it('blocks duplicate writes and tab switching while saving', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/set-domain-default': () => pending.promise } })
  await fireEvent.update(await userEditor(), groupId)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await waitFor(() => expect(view.writes).toHaveLength(1))
  await fireEvent.click(screen.getByRole('tab', { name: 'admin' }))
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  expect(screen.getByTestId('user-group-summary').textContent).toContain('user')
  expect(view.writes).toHaveLength(1)
  pending.resolve(response(view.management('user')))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
})

it.each(['roundtrip', 'same-id', 'unmount'])('discards a late save and refresh for %s', async (kind) => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/set-domain-default': () => pending.promise } })
  await fireEvent.update(await userEditor(), groupId)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await waitFor(() => expect(view.writes).toHaveLength(1))
  const before = view.requests.filter((path) => path === '/api/v1/auth/me').length
  if (kind === 'unmount') view.unmount()
  else {
    if (kind === 'roundtrip') view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: 'B' } })
    else revokeAccountIdentity(view.client)
    view.client.setQueryData(['auth', 'me'], { user: view.user })
  }
  pending.resolve(response(view.management('user')))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(view.requests.filter((path) => path === '/api/v1/auth/me')).toHaveLength(before)
  expect(screen.queryByText('groupDefault.saved')).toBeNull()
})

it('locks after a committed write whose refresh fails, then explicitly recovers without replaying it', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await fireEvent.update(await userEditor(), groupId)
  view.overrides['/api/v1/auth/me'] = async () => { throw new Error('offline') }
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await screen.findByText('groupDefault.refreshRequired')
  expect(screen.getByRole('button', { name: 'groupDefault.save' })).toHaveProperty('disabled', true)
  delete view.overrides['/api/v1/auth/me']
  await fireEvent.click(screen.getAllByRole('button', { name: 'groupDefault.reload' })[0]!)
  await waitFor(() => expect(screen.queryByText('groupDefault.refreshRequired')).toBeNull())
  expect(view.writes).toHaveLength(1)
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('value', groupId)
})

it('keeps a default conflict draft and never resends it automatically', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/set-domain-default': async () => response(null, 300202) } })
  await fireEvent.update(await userEditor(), groupId)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await screen.findByText('groupDefault.conflict')
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('value', groupId)
  expect(screen.getByRole('button', { name: 'groupDefault.save' })).toHaveProperty('disabled', true)
  await flushEventLoop()
  expect(view.writes).toHaveLength(1)
  expect(view.writes[0]?.input.expectedUpdatedAt).toBe(version)
})

it('rejects two captured save events dispatched within the same turn', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/set-domain-default': () => pending.promise } })
  await fireEvent.update(await userEditor(), groupId)
  const save = screen.getByRole('button', { name: 'groupDefault.save' })
  save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushEventLoop()
  expect(view.writes).toHaveLength(1)
  pending.resolve(response(view.management('user')))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
})
