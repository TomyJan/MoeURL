import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { setImmediate as flushEventLoop } from 'node:timers/promises'
import AdminUserGroupsPage from './AdminUserGroupsPage.vue'
import { mountGroupDefault, response, groupId, version, nextVersion } from '@/test/group-default'
import { userGroupQueryKey } from '@/entities/user-group/api'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: ref('en') }) }))
let view: ReturnType<typeof mountGroupDefault>
afterEach(() => { cleanup(); view.client.clear(); vi.unstubAllGlobals() })
/** Opens a target after its complete shared configuration is available. */
async function selectUser() {
  await fireEvent.click(await screen.findByRole('tab', { name: 'user' }))
  await waitFor(() => expect(screen.getByLabelText('userGroups.preset')).toHaveProperty('disabled', false))
}
/** Creates a real permission draft through the public checkbox. */
async function editPermission() {
  await selectUser()
  await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))
}

it('shows initial loading and then the actual catalog', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/list': () => pending.promise } })
  expect(screen.getByRole('progressbar')).toBeTruthy()
  pending.resolve(response(view.catalog()))
  await screen.findByRole('tab', { name: 'user' })
})
it('retries a failed initial catalog read without writing', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/list': async () => { throw new Error('offline') } } })
  await screen.findByText('userGroups.loadFailed')
  delete view.overrides['/api/v1/admin/user-group/list']
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.retry' }))
  await screen.findByRole('tab', { name: 'user' })
  expect(view.writes).toEqual([])
})
it('displays an actual empty catalog safely', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/list': async () => response({ groups: [], permissions: [], presets: ['restricted', 'basic', 'standard'].map((key) => ({ key, applicableGroups: ['user'], permissions: [] })) }) } })
  await screen.findByText('userGroups.empty')
  expect(screen.queryByRole('button', { name: 'userGroups.save' })).toBeNull()
})
it('creates an empty custom group and opens the server-assigned key', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await screen.findByRole('tab', { name: 'user' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.createCustom' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'Operations')
  await fireEvent.update(screen.getByLabelText('userGroups.descriptionField'), 'On-call team')
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.create' }))
  await screen.findByRole('tab', { name: 'Operations' })
  expect(view.writes).toContainEqual({ path: '/api/v1/admin/user-group/create', input: { name: 'Operations', description: 'On-call team' } })
  expect(view.groups.find(({ key }) => key === 'new-custom-key')).toMatchObject({ builtin: false, permissions: [], memberCount: 0 })
})
it('keeps the create form open with actionable feedback after a server rejection', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/create': async () => response(null, 900000) } })
  await screen.findByRole('tab', { name: 'user' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.createCustom' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'Operations')
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.create' }))
  await screen.findAllByText('userGroups.managementFailed')
  expect(screen.getAllByText('userGroups.managementFailed')).toHaveLength(2)
  expect(screen.getByLabelText('userGroups.name')).toHaveProperty('value', 'Operations')
  expect(view.writes).toHaveLength(1)
})
it('rejects empty create submissions even when a disabled button is activated directly', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await screen.findByRole('tab', { name: 'user' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.createCustom' }))
  const create = screen.getByRole('button', { name: 'userGroups.create' })
  expect(create).toHaveProperty('disabled', true)
  create.removeAttribute('disabled')
  await fireEvent.click(create)
  expect(view.writes.filter(({ path }) => path.endsWith('/create'))).toHaveLength(0)
})
it('does not send a group mutation when identity is revoked before its queued mutation starts', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await screen.findByRole('tab', { name: 'user' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.createCustom' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'Operations')

  screen.getByRole('button', { name: 'userGroups.create' }).click()
  revokeAccountIdentity(view.client)
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(view.writes.filter(({ path }) => path.endsWith('/create'))).toHaveLength(0)
  expect(screen.queryByText('userGroups.managementFailed')).toBeNull()
})
it('does not apply a stale edit dialog to a newly selected builtin group', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.editDetails' }))
  await fireEvent.click(screen.getByRole('tab', { name: 'user' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'Changed')
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.saveDetails' }))
  expect(view.writes.filter(({ path }) => path.endsWith('/update'))).toHaveLength(0)
})
it('requires resolving a dirty permission draft before opening the details editor', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: ['short_link:create'], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  const permission = screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement
  await waitFor(() => expect(permission.disabled).toBe(false))
  expect(permission.checked).toBe(true)
  await fireEvent.click(permission)
  expect(permission.checked).toBe(false)
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', false)

  const editButton = screen.getByRole('button', { name: 'userGroups.editDetails' }) as HTMLButtonElement
  expect(editButton.disabled).toBe(true)
  expect(screen.getByText('userGroups.detailsEditBlockedByDraft')).toBeTruthy()
  editButton.removeAttribute('disabled')
  await fireEvent.click(editButton)
  expect(screen.queryByLabelText('userGroups.name')).toBeNull()
})
it('requires resolving a dirty default-domain draft before opening the details editor', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  const defaultDomain = await screen.findByLabelText('groupDefault.domain') as HTMLSelectElement
  await waitFor(() => expect(defaultDomain.disabled).toBe(false))
  await fireEvent.update(defaultDomain, groupId)

  const editButton = screen.getByRole('button', { name: 'userGroups.editDetails' }) as HTMLButtonElement
  expect(editButton.disabled).toBe(true)
  expect(screen.getByText('userGroups.detailsEditBlockedByDraft')).toBeTruthy()
  editButton.removeAttribute('disabled')
  await fireEvent.click(editButton)
  expect(screen.queryByLabelText('userGroups.name')).toBeNull()
})
it('keeps the group form open while a create mutation is pending', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/create': () => pending.promise } })
  await screen.findByRole('tab', { name: 'user' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.createCustom' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'Operations')
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.create' }))
  await waitFor(() => expect(view.writes.filter(({ path }) => path.endsWith('/create'))).toHaveLength(1))
  const cancel = screen.getByRole('button', { name: 'userGroups.cancel' })
  expect(cancel).toHaveProperty('disabled', true)
  cancel.removeAttribute('disabled')
  await fireEvent.click(cancel)
  expect(screen.getByRole('dialog')).toBeTruthy()
  pending.resolve(response({ group: { key: 'created', name: 'Operations', description: '', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: nextVersion } }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})
it.each([true, false])('ignores a late custom-group create %s result after identity revocation', async (success) => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/create': () => pending.promise } })
  await screen.findByRole('tab', { name: 'user' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.createCustom' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'Operations')
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.create' }))
  await waitFor(() => expect(view.writes.filter(({ path }) => path.endsWith('/create'))).toHaveLength(1))

  revokeAccountIdentity(view.client)
  pending.resolve(success
    ? response({ group: { key: 'late-custom', name: 'Operations', description: '', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: nextVersion } })
    : response(null, 900000))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(screen.queryByRole('tab', { name: 'Operations' })).toBeNull()
  expect(screen.queryByText('userGroups.managementFailed')).toBeNull()
})
it('closes group dialogs through the dialog model and preserves delete failure feedback', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: version }
  const dialogStub = { props: ['modelValue'], emits: ['update:modelValue'], template: '<div v-if="modelValue" role="dialog"><button aria-label="dismiss-dialog" @click="$emit(\'update:modelValue\', false)" /><slot /></div>' }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom], overrides: { '/api/v1/admin/user-group/delete': async () => response(null, 900000) }, stubs: { VDialog: dialogStub } })
  await screen.findByRole('tab', { name: 'Operations' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.createCustom' }))
  await fireEvent.click(screen.getByRole('button', { name: 'dismiss-dialog' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  await fireEvent.click(screen.getByRole('tab', { name: 'Operations' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.deleteCustom' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.confirmDelete' }))
  await screen.findAllByText('userGroups.managementFailed')
  expect(screen.getAllByText('userGroups.managementFailed')).toHaveLength(2)
  await fireEvent.click(screen.getByRole('button', { name: 'dismiss-dialog' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(view.writes.filter(({ path }) => path.endsWith('/delete'))).toHaveLength(1)
})
it('edits custom details with the captured revision and blocks deletion while members remain', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 2, permissions: [], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.editDetails' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'On call')
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.saveDetails' }))
  await screen.findByRole('tab', { name: 'On call' })
  expect(view.writes).toContainEqual({ path: '/api/v1/admin/user-group/update', input: { groupKey: custom.key, name: 'On call', description: custom.description, expectedUpdatedAt: version } })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.deleteCustom' }))
  const confirmDelete = screen.getByRole('button', { name: 'userGroups.confirmDelete' })
  expect(confirmDelete).toHaveProperty('disabled', true)
  expect(screen.getByText('userGroups.deleteMembersBlocked')).toBeTruthy()
  confirmDelete.removeAttribute('disabled')
  await fireEvent.click(confirmDelete)
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(view.writes.some(({ path }) => path.endsWith('/delete'))).toBe(false)
})
it('uses the revision captured when opening details even if the group refreshes during editing', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.editDetails' }))
  await fireEvent.update(screen.getByLabelText('userGroups.name'), 'My edit')

  const refreshed = view.groups.find(({ key }) => key === custom.key)!
  refreshed.name = 'Concurrent edit'
  refreshed.updatedAt = nextVersion
  view.client.setQueryData([...userGroupQueryKey, 'A', 1], view.catalog())
  await screen.findByRole('tab', { name: 'Concurrent edit' })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.saveDetails' }))

  await waitFor(() => expect(view.writes.filter(({ path }) => path.endsWith('/update'))).toHaveLength(1))
  expect(view.writes.find(({ path }) => path.endsWith('/update'))?.input).toEqual({ groupKey: custom.key, name: 'My edit', description: custom.description, expectedUpdatedAt: version })
})
it('deletes an empty custom group using its captured version and refreshes the list', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.deleteCustom' }))
  expect(screen.getByText('userGroups.deleteDomainGrants')).toBeTruthy()
  expect(screen.getByText('userGroups.deleteConfirmation')).toBeTruthy()
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.cancel' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.deleteCustom' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.confirmDelete' }))
  await waitFor(() => expect(view.writes).toContainEqual({ path: '/api/v1/admin/user-group/delete', input: { groupKey: custom.key, expectedUpdatedAt: version } }))
  await waitFor(() => expect(screen.queryByRole('tab', { name: 'Operations' })).toBeNull())
})
it('does not invalidate account-scoped queries when a delete refresh completes after identity revocation', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  const priorListReads = view.requests.filter((path) => path === '/api/v1/admin/user-group/list').length
  const priorScopedReads = view.requests.filter((path) => path === '/api/v1/domain/available' || path === '/api/v1/domain/group-default').length
  const pendingRefresh = createDeferred<Response>()
  view.overrides['/api/v1/admin/user-group/list'] = () => pendingRefresh.promise

  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.deleteCustom' }))
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.confirmDelete' }))
  await waitFor(() => expect(view.requests.filter((path) => path === '/api/v1/admin/user-group/list')).toHaveLength(priorListReads + 1))

  revokeAccountIdentity(view.client)
  pendingRefresh.resolve(response(view.catalog()))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(view.requests.filter((path) => path === '/api/v1/domain/available' || path === '/api/v1/domain/group-default')).toHaveLength(priorScopedReads)
})
it('locks protected permissions and omits builtin presets for custom groups', async () => {
  const custom = { key: 'opaque-custom-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: version }
  view = mountGroupDefault(AdminUserGroupsPage, { customGroups: [custom] })
  await fireEvent.click(await screen.findByRole('tab', { name: 'Operations' }))
  expect(screen.queryByLabelText('userGroups.preset')).toBeNull()
  expect(screen.getByLabelText('userGroups.permissions.admin:access.label')).toHaveProperty('disabled', true)
})
it('keeps guest read-only in both editors', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await screen.findByTestId('group-default-editor')
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', true)
  expect(screen.queryByLabelText('groupDefault.domain')).toBeNull()
  expect(view.writes).toEqual([])
})
it('retains the old permission-only management capability without domain:manage', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { permissions: ['admin:access'] })
  await editPermission()
  expect(screen.queryByTestId('group-default-editor')).toBeNull()
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await waitFor(() => expect(view.writes).toHaveLength(1))
  expect(view.writes[0]).toEqual({ path: '/api/v1/admin/user-group/update-permissions', input: { groupKey: 'user', permissions: ['short_link:create'], expectedUpdatedAt: version } })
  await screen.findByText('userGroups.saveSuccess')
})
it('does not read private group settings without management permission', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { permissions: ['domain:manage'] })
  await screen.findByText('groupDefault.accessDenied')
  expect(view.requests).toEqual([])
})
it('saves complete permission drafts and aligns both editors to the new shared revision', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await editPermission()
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await screen.findByText('userGroups.saveSuccess')
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', true)
  await fireEvent.update(screen.getByLabelText('groupDefault.domain'), groupId)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await waitFor(() => expect(view.writes).toHaveLength(2))
  expect(view.writes[1]?.input.expectedUpdatedAt).toBe(nextVersion)
})
it('applies catalog presets, preserves independent drafts and cancels only the selected one', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await selectUser()
  await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'basic')
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
  await fireEvent.click(screen.getByRole('tab', { name: 'admin' }))
  await waitFor(() => expect(screen.getByLabelText('userGroups.preset')).toHaveProperty('disabled', false))
  await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))
  await fireEvent.click(screen.getByRole('tab', { name: 'user' }))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.cancelPermissions' }))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', false)
  expect(screen.getByLabelText('userGroups.preset')).toHaveProperty('value', '')
  await fireEvent.click(screen.getByRole('tab', { name: 'admin' }))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
})
it('preserves a dirty permission snapshot when the server revision changes', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await editPermission()
  view.groups.find(({ key }) => key === 'user')!.updatedAt = nextVersion
  const key = view.client.getQueriesData({ queryKey: ['admin-user-groups'] })[0]![0]
  view.client.setQueryData(key, view.catalog())
  await screen.findAllByText('userGroups.dataStale')
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', true)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.reloadPermissions' }))
  await waitFor(() => expect(screen.getByLabelText('userGroups.preset')).toHaveProperty('disabled', false))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', false)
})
it('cancels a preset draft in place without retaining its selected preset label', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await selectUser()
  await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'basic')
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.cancelPermissions' }))
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', false)
  expect(screen.getByLabelText('userGroups.preset')).toHaveProperty('value', '')
})
it('reloads a permission conflict once and never retries its rejected write', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/update-permissions': async () => response(null, 300202) } })
  await editPermission()
  view.groups.find(({ key }) => key === 'user')!.updatedAt = nextVersion
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await screen.findByText('userGroups.conflict')
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', false)
  expect(view.writes).toHaveLength(1)
})
it('keeps a failed conflict reload locked until explicit recovery', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/update-permissions': async () => response(null, 300202) } })
  await editPermission()
  view.overrides['/api/v1/auth/me'] = async () => { throw new Error('offline') }
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await screen.findByText('userGroups.conflictReloadFailed')
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', true)
})
it('preserves a failed permission draft and requires rereading before another save', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/update-permissions': async () => response(null, 900000) } })
  await editPermission()
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await screen.findByText('userGroups.saveFailed')
  expect(screen.getByLabelText('userGroups.permissions.short_link:create.label')).toHaveProperty('checked', true)
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', true)
  expect(view.writes).toHaveLength(1)
})
it('recovers a failed setting read by rereading both shared resources', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/domain-default?groupKey=user': async () => { throw new Error('offline') } } })
  await fireEvent.click(await screen.findByRole('tab', { name: 'user' }))
  await screen.findByText('groupDefault.loadFailed')
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', true)
  delete view.overrides['/api/v1/admin/user-group/domain-default?groupKey=user']
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.retry' }))
  await waitFor(() => expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('disabled', false))
})
it('can clear an unavailable saved domain even when no candidates remain', async () => {
  view = mountGroupDefault(AdminUserGroupsPage, { domains: [] })
  view.values.user = groupId
  await selectUser()
  await screen.findByText('groupDefault.savedUnavailable')
  await fireEvent.update(screen.getByLabelText('groupDefault.domain'), '')
  await fireEvent.click(screen.getByRole('button', { name: 'groupDefault.save' }))
  await waitFor(() => expect(view.writes[0]?.input.domainId).toBeNull())
})
it.each(['roundtrip', 'same-id', 'unmount'])('discards late permission outcomes after %s', async (kind) => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage, { overrides: { '/api/v1/admin/user-group/update-permissions': () => pending.promise } })
  await editPermission()
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await waitFor(() => expect(view.writes).toHaveLength(1))
  if (kind === 'unmount') view.unmount()
  else {
    if (kind === 'roundtrip') view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: 'B' } })
    else revokeAccountIdentity(view.client)
    view.client.setQueryData(['auth', 'me'], { user: view.user })
  }
  pending.resolve(response({ group: view.groups.find(({ key }) => key === 'user') }))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(screen.queryByText('userGroups.saveSuccess')).toBeNull()
  expect(view.requests).not.toContain('/api/v1/auth/me')
})
it('does not publish a late management auth refresh over another account', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(AdminUserGroupsPage)
  await editPermission()
  view.overrides['/api/v1/auth/me'] = () => pending.promise
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await waitFor(() => expect(view.requests).toContain('/api/v1/auth/me'))
  const other = { ...view.user, id: 'B', username: 'bob' }
  view.client.setQueryData(['auth', 'me'], { user: other })
  pending.resolve(response({ user: view.user }))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(view.client.getQueryData(['auth', 'me'])).toEqual({ user: other })
  expect(screen.queryByText('userGroups.saveSuccess')).toBeNull()
})
it('stops both editors when refreshed current permissions revoke administration', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await editPermission()
  view.overrides['/api/v1/auth/me'] = async () => response({ user: { ...view.user, permissions: [] } })
  await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))
  await screen.findByText('groupDefault.accessDenied')
  await flushEventLoop()
  expect(view.writes).toHaveLength(1)
})
it('refuses a setting snapshot whose shared revision differs from the group list', async () => {
  view = mountGroupDefault(AdminUserGroupsPage)
  await selectUser()
  const key = view.client.getQueriesData({ queryKey: ['admin-user-group-domain-default'] }).find(([key]) => key[3] === 'user')![0]
  const snapshot = view.management('user')
  snapshot.setting.updatedAt = nextVersion
  view.client.setQueryData(key, snapshot)
  await nextTick()
  expect(screen.getByRole('button', { name: 'userGroups.save' })).toHaveProperty('disabled', true)
  expect(screen.getByLabelText('groupDefault.domain')).toHaveProperty('disabled', true)
})
