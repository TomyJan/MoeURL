import { cleanup, waitFor } from '@testing-library/vue'
import { defineComponent, nextTick } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { mountGroupDefault, response, groupId, nextVersion } from '@/test/group-default'
import { createDeferred } from '@/test/deferred'
import { useGroupDefaultManagement } from './useGroupDefaultManagement'
import { getCurrentGroupDefaultDomain } from '@/entities/user-group/domain-default'

let manager: ReturnType<typeof useGroupDefaultManagement>
let view: ReturnType<typeof mountGroupDefault>
const Host = defineComponent({ setup() { manager = useGroupDefaultManagement(); return () => null } })
afterEach(() => { cleanup(); view.client.clear(); vi.unstubAllGlobals() })
/** Delivers editor events to the exported coordinator using real query state and HTTP. */
async function ready() {
  await waitFor(() => expect(manager.displayedGroups.value).toHaveLength(3))
  manager.changeGroup('user')
  await waitFor(() => expect(manager.activeGroup.value && manager.groupReady(manager.activeGroup.value)).toBe(true))
  return { group: manager.activeGroup.value!, target: manager.currentDefault.value!.result.setting }
}

it('ignores stale or duplicate child events without changing drafts or issuing writes', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(Host, { overrides: { '/api/v1/admin/user-group/set-domain-default': () => pending.promise } })
  const { group, target } = await ready()
  manager.savePermissions(group)
  manager.selectDefault(target, '44444444-4444-4444-8444-444444444444')
  expect(manager.currentDefault.value!.value).toBeNull()
  manager.selectDefault(target, groupId)
  manager.applyPreset(group, 'basic')
  manager.setPermission(group, 'short_link:create', true)
  manager.savePermissions(group)
  expect(manager.draft.permissionsFor('user')).toEqual([])
  manager.saveDefault(target)
  await waitFor(() => expect(view.writes).toHaveLength(1))
  manager.cancelDefault(target)
  manager.cancelPermissions(group)
  manager.savePermissions(group)
  manager.saveDefault(target)
  manager.selectDefault(target, null)
  manager.changeGroup('admin')
  expect(manager.activeGroupKey.value).toBe('user')
  expect(manager.currentDefault.value!.value).toBe(groupId)
  expect(view.writes).toHaveLength(1)
  pending.resolve(response(view.management('user')))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  manager.cancelDefault(target)
  manager.saveDefault(target)
  expect(view.writes).toHaveLength(1)
})

it('retains a dirty domain snapshot when a newer default arrives in the background', async () => {
  view = mountGroupDefault(Host)
  const { target } = await ready()
  manager.selectDefault(target, groupId)
  const key = view.client.getQueriesData({ queryKey: ['admin-user-group-domain-default'] }).find(([key]) => key[3] === 'user')![0]
  const result = view.management('user'); result.setting.updatedAt = nextVersion
  view.client.setQueryData(key, result)
  await nextTick()
  expect(manager.currentDefault.value!.result.setting.updatedAt).toBe(target.updatedAt)
  expect(manager.currentDefault.value!.value).toBe(groupId)
  expect(manager.stale.has('user')).toBe(true)
})

it('rejects a captured save after its candidate loses eligibility without changing the draft', async () => {
  view = mountGroupDefault(Host)
  const { target } = await ready()
  manager.selectDefault(target, groupId)
  const key = view.client.getQueriesData({ queryKey: ['admin-user-group-domain-default'] }).find(([key]) => key[3] === 'user')![0]
  view.client.setQueryData(key, { ...view.management('user'), candidates: [] })
  await nextTick()
  manager.saveDefault(manager.currentDefault.value!.result.setting)
  expect(view.writes).toEqual([])
  expect(manager.currentDefault.value!.value).toBe(groupId)
})

it('handles stale catalog events without inventing permissions or presets', async () => {
  view = mountGroupDefault(Host)
  const { group } = await ready()
  const key = view.client.getQueriesData({ queryKey: ['admin-user-groups'] })[0]![0]
  view.client.setQueryData(key, { ...view.catalog(), permissions: [], presets: [] })
  await nextTick()
  const current = manager.activeGroup.value!
  manager.applyPreset(current, 'basic')
  expect(manager.feedback.value).toBe('error')
  manager.setPermission(current, 'short_link:create', true)
  expect(manager.draft.permissionsFor('user')).toEqual([])
  manager.applyPreset(group, 'basic')
  expect(view.writes).toEqual([])
})

it.each(['identity', 'admin-access', 'domain-manage'])('rejects a queued write when %s changes before its dispatch microtask', async (kind) => {
  view = mountGroupDefault(Host)
  const { target } = await ready()
  manager.selectDefault(target, groupId)
  manager.saveDefault(target)
  view.client.setQueryData(['auth', 'me'], { user: kind === 'identity' ? { ...view.user, id: 'B' } : { ...view.user, permissions: view.user.permissions.filter((key) => key !== (kind === 'admin-access' ? 'admin:access' : 'domain:manage')) } })
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(view.writes).toEqual([])
  expect(manager.feedback.value).toBe(kind === 'identity' ? '' : 'error')
})

it('does not show a late rejected write after identity changes', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(Host, { overrides: { '/api/v1/admin/user-group/set-domain-default': () => pending.promise } })
  const { target } = await ready()
  manager.selectDefault(target, groupId); manager.saveDefault(target)
  await waitFor(() => expect(view.writes).toHaveLength(1))
  view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: 'B' } })
  pending.reject(new Error('old failure'))
  await waitFor(() => expect(view.client.isMutating()).toBe(0))
  expect(manager.feedback.value).toBe('')
})

it('keeps the current auth cache when a Cookie read unexpectedly returns another account', async () => {
  view = mountGroupDefault(Host)
  await ready()
  view.overrides['/api/v1/auth/me'] = async () => response({ user: { ...view.user, id: 'B' } })
  expect(await manager.reload('user')).toBe(false)
  expect(view.client.getQueryData(['auth', 'me'])).toEqual({ user: view.user })
  expect(manager.refreshBroken.value).toBe(true)
})

it('rejects overlapping and stale reload requests without starting another auth read', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(Host)
  await ready()
  const oldScope = manager.identity.scope.value
  view.overrides['/api/v1/auth/me'] = () => pending.promise
  const first = manager.reload('user')
  expect(await manager.reload('user')).toBe(false)
  expect(view.requests.filter((path) => path === '/api/v1/auth/me')).toHaveLength(1)
  view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: 'B' } })
  expect(await manager.reload('user', oldScope)).toBe(false)
  pending.reject(new Error('old read failure'))
  expect(await first).toBe(false)
  expect(manager.refreshBroken.value).toBe(false)
})

it('discards a configuration read that completes after the auth scope changes', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(Host)
  await ready()
  view.overrides['/api/v1/admin/user-group/domain-default?groupKey=user'] = () => pending.promise
  const reload = manager.reload('user')
  await waitFor(() => expect(view.requests.filter((path) => path.endsWith('domain-default?groupKey=user'))).toHaveLength(2))
  view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: 'B' } })
  delete view.overrides['/api/v1/admin/user-group/domain-default?groupKey=user']
  pending.resolve(response(view.management('user')))
  expect(await reload).toBe(false)
  expect(manager.feedback.value).toBe('')
  expect(view.client.getQueriesData({ queryKey: ['admin-user-group-domain-default', 'A'] })).toEqual([])
})

it('blocks continued saving when the shared revision changes between the two reload reads', async () => {
  view = mountGroupDefault(Host)
  await ready()
  view.overrides['/api/v1/admin/user-group/domain-default?groupKey=user'] = async () => {
    const result = view.management('user'); result.setting.updatedAt = nextVersion
    return response(result)
  }
  expect(await manager.reload('user')).toBe(false)
  expect(manager.refreshBroken.value).toBe(true)
  expect(manager.stale.has('user')).toBe(true)
})

it('does not finish recovery after a visible creation choice refresh switches identity', async () => {
  const pending = createDeferred<Response>()
  view = mountGroupDefault(Host)
  await ready()
  // A real active consumer makes the required invalidation wait for this HTTP read.
  const { QueryObserver } = await import('@tanstack/vue-query')
  const observer = new QueryObserver(view.client, { queryKey: ['group-default-domain', 'A', 1], queryFn: getCurrentGroupDefaultDomain, staleTime: Infinity })
  const unsubscribe = observer.subscribe(() => {})
  await waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true))
  view.overrides['/api/v1/domain/group-default'] = () => pending.promise
  const reload = manager.reload('user')
  await waitFor(() => expect(view.requests.filter((path) => path === '/api/v1/domain/group-default')).toHaveLength(2))
  view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: 'B' } })
  pending.resolve(response({ selection: { status: 'not_set', domainId: null } }))
  expect(await reload).toBe(false)
  expect(manager.feedback.value).toBe('')
  unsubscribe()
})
