import { afterEach, expect, it, vi } from 'vitest'
import { updateUserGroupMemberships, type UpdateUserGroupMembershipsInput } from './supplemental-group-membership'
import { ApiClientError } from '@/shared/api/client'

const input: UpdateUserGroupMembershipsInput = {
  id: '22222222-2222-4222-8222-222222222222',
  groupKeys: ['custom-ops', 'custom-support'],
  expectedUpdatedAt: '2026-11-26T01:02:03.123456789Z',
}
const user = {
  id: input.id, username: 'member', nickname: 'Member', group: 'admin', status: 'active' as const,
  builtin: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-11-26T01:02:04.987654321Z',
  supplementalGroups: [{ key: 'custom-ops', name: 'Operations' }, { key: 'custom-support', name: 'Support' }],
}
afterEach(() => vi.unstubAllGlobals())

it('posts the frozen account revision and returns verified membership display data', async () => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/v1/admin/user/update-group-memberships')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual(input)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data: { user }, meta: {} }))
  })
  await expect(updateUserGroupMemberships(input)).resolves.toEqual({ user })
})

it('sends an empty array to explicitly remove all supplemental groups', async () => {
  const clearInput = { ...input, groupKeys: [] }
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    expect(JSON.parse(init.body as string)).toEqual(clearInput)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data: { user: { ...user, supplementalGroups: [] } }, meta: {} }))
  })
  await expect(updateUserGroupMemberships(clearInput)).resolves.toMatchObject({ user: { supplementalGroups: [] } })
})

it.each([
  null,
  { user: { ...user, supplementalGroups: null } },
  { user: { ...user, supplementalGroups: [{ key: 'admin', name: 'Administrator' }] } },
  { user: { ...user, builtin: true } },
  { user: { ...user, supplementalGroups: [{ key: 'custom-ops' }] } },
  { user: { ...user, updatedAt: 'not-a-timestamp' } },
  { user, unexpected: 'private' },
])('rejects malformed membership readback %j', async (data) => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} })))
  await expect(updateUserGroupMemberships(input)).rejects.toMatchObject({ code: 100001 })
})

it('preserves a server conflict and sends exactly one request', async () => {
  let calls = 0
  vi.stubGlobal('fetch', async () => { calls++; return new Response(JSON.stringify({ code: 300105, message: 'private conflict detail', data: null, meta: {} })) })
  await expect(updateUserGroupMemberships(input)).rejects.toBeInstanceOf(ApiClientError)
  expect(calls).toBe(1)
})
