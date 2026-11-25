import { afterEach, describe, expect, it, vi } from 'vitest'

import { INVALID_REQUEST_CODE } from '@/shared/api/error-codes'

import { createCustomUserGroup, deleteCustomUserGroup, listUserGroups, updateCustomUserGroup, updateUserGroupPermissions } from './api'

const responseData = {
  groups: [
    { key: 'guest', name: 'Guest', description: 'Guest group', builtin: true, editable: false, memberCount: 0, permissions: [], updatedAt: '2026-08-20T00:00:00Z' },
    { key: 'user', name: 'User', description: 'User group', builtin: true, editable: true, memberCount: 0, permissions: ['short_link:create'], updatedAt: '2026-08-20T00:00:01Z' },
    { key: 'admin', name: 'Admin', description: 'Admin group', builtin: true, editable: true, memberCount: 1, permissions: ['admin:access'], updatedAt: '2026-08-20T00:00:02Z' },
  ],
  permissions: [
    { key: 'short_link:create', category: 'short_link_basic', protected: false },
    { key: 'admin:access', category: 'administration', protected: true },
  ],
  presets: [
    { key: 'restricted', applicableGroups: ['user', 'admin'], permissions: [] },
    { key: 'basic', applicableGroups: ['user', 'admin'], permissions: ['short_link:create'] },
    { key: 'standard', applicableGroups: ['user', 'admin'], permissions: ['short_link:create'] },
  ],
}

/** Returns a malformed group fixture without its required editable field. */
function omitEditable(group: (typeof responseData.groups)[number]) {
  const malformed: Partial<typeof group> = { ...group }
  delete malformed.editable
  return malformed
}

/** Returns a server row missing the count required by the strict list contract. */
function omitMemberCount(group: (typeof responseData.groups)[number]) {
  const malformed: Partial<typeof group> = { ...group }
  delete malformed.memberCount
  return malformed
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('user group api', () => {
  it('strictly parses groups, permissions, presets, editable state and applicable groups', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: responseData, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).resolves.toEqual(responseData)
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user-group/list', expect.objectContaining({ method: 'GET' }))
  })

  it('accepts an empty group list for the page empty state', async () => {
    const data = { ...responseData, groups: [] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).resolves.toEqual(data)
  })

  it('accepts opaque custom keys while requiring the complete builtin catalog', async () => {
    const data = {
      ...responseData,
      groups: [...responseData.groups, {
        key: '52ef11fc-95a4-4a8d-8f72-1f707b5c6a80', name: 'Operations', description: 'On-call team',
        builtin: false, editable: true, memberCount: 3, permissions: ['short_link:create'], updatedAt: '2026-08-20T00:00:03Z',
      }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).resolves.toEqual(data)
  })

  it('accepts presets that each target one editable group', async () => {
    const data = {
      ...responseData,
      presets: responseData.presets.map((preset, index) => ({
        ...preset,
        applicableGroups: [index === 1 ? 'admin' : 'user'],
      })),
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).resolves.toEqual(data)
  })

  it.each([
    ['unknown category', { ...responseData, permissions: [{ key: 'short_link:create', category: 'unknown', protected: false }] }],
    ['missing editable', { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? omitEditable(group) : group) }],
    ['inconsistent editable', { ...responseData, groups: responseData.groups.map((group, index) => index === 0 ? { ...group, editable: true } : group) }],
    ['missing builtin group', { ...responseData, groups: responseData.groups.slice(1) }],
    ['custom group marked builtin', { ...responseData, groups: [...responseData.groups, { ...responseData.groups[1], key: 'custom-key', builtin: true }] }],
    ['missing member count', { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? omitMemberCount(group) : group) }],
    ['duplicate group key', { ...responseData, groups: [responseData.groups[0], responseData.groups[1], { ...responseData.groups[2], key: 'user' }] }],
    ['duplicate permission key', { ...responseData, permissions: [responseData.permissions[0], responseData.permissions[0]] }],
    ['unknown group permission', { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? { ...group, permissions: ['unknown'] } : group) }],
    ['duplicate preset key', { ...responseData, presets: [responseData.presets[0], responseData.presets[1], { ...responseData.presets[2], key: 'basic' }] }],
    ['missing preset key', { ...responseData, presets: responseData.presets.slice(0, 2) }],
    ['unknown preset key', { ...responseData, presets: responseData.presets.map((preset, index) => index === 0 ? { ...preset, key: 'custom' } : preset) }],
    ['invalid applicable groups', { ...responseData, presets: responseData.presets.map((preset, index) => index === 0 ? { ...preset, applicableGroups: ['guest'] } : preset) }],
    ['empty applicable groups', { ...responseData, presets: responseData.presets.map((preset, index) => index === 0 ? { ...preset, applicableGroups: [] } : preset) }],
    ['duplicate applicable group', { ...responseData, presets: responseData.presets.map((preset, index) => index === 0 ? { ...preset, applicableGroups: ['user', 'user'] } : preset) }],
    ['unknown preset permission', { ...responseData, presets: responseData.presets.map((preset, index) => index === 0 ? { ...preset, permissions: ['unknown'] } : preset) }],
    ['invalid updatedAt', { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? { ...group, updatedAt: 'invalid' } : group) }],
  ])('rejects an invalid %s response', async (_name, data) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).rejects.toEqual(expect.objectContaining({ code: INVALID_REQUEST_CODE }))
  })

  it('includes the first schema issue path in development diagnostics', async () => {
    const data = { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? omitEditable(group) : group) }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).rejects.toEqual(expect.objectContaining({
      code: INVALID_REQUEST_CODE,
      message: expect.stringContaining('groups.1.editable'),
    }))
  })

  it('keeps schema diagnostics out of the production error message', async () => {
    vi.stubEnv('DEV', false)
    const data = { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? omitEditable(group) : group) }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).rejects.toEqual(expect.objectContaining({
      code: INVALID_REQUEST_CODE,
      message: 'Invalid user group response',
    }))
  })

  it('uses the custom permissions endpoint for opaque group keys', async () => {
    const group = { ...responseData.groups[1], key: 'custom-key', builtin: false, editable: true, permissions: [] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { group }, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))
    const input = { groupKey: group.key, permissions: [], expectedUpdatedAt: group.updatedAt }
    await expect(updateUserGroupPermissions(input)).resolves.toEqual({ group })
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user-group/update-custom-permissions', expect.anything())
  })

  it('posts the complete optimistic update and parses the returned group', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      message: 'OK',
      data: { group: responseData.groups[1] },
      meta: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    const input = {
      groupKey: 'user' as const,
      permissions: ['short_link:create'],
      expectedUpdatedAt: '2026-08-20T00:00:01Z',
    }
    await expect(updateUserGroupPermissions(input)).resolves.toEqual({ group: responseData.groups[1] })

    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user-group/update-permissions', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
    }))
  })

  it('creates a custom group without a client-chosen key and parses the empty server group', async () => {
    const group = { key: '52ef11fc-95a4-4a8d-8f72-1f707b5c6a80', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 0, permissions: [], updatedAt: '2026-08-20T00:00:03Z' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { group }, meta: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    await expect(createCustomUserGroup({ name: 'Operations', description: 'Ops' })).resolves.toEqual({ group })
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user-group/create', expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Operations', description: 'Ops' }) }))
  })

  it('updates custom details using the original opaque key and full revision', async () => {
    const group = { key: 'custom-opaque-key', name: 'Operations', description: 'Ops', builtin: false, editable: true, memberCount: 2, permissions: [], updatedAt: '2026-08-20T00:00:03Z' }
    const input = { groupKey: group.key, name: group.name, description: group.description, expectedUpdatedAt: group.updatedAt }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { group }, meta: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    await expect(updateCustomUserGroup(input)).resolves.toEqual({ group })
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user-group/update', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
  })

  it('deletes only the requested custom group at its captured revision', async () => {
    const input = { groupKey: 'custom-opaque-key', expectedUpdatedAt: '2026-08-20T00:00:03Z' }
    const result = { groupKey: input.groupKey, name: 'Operations' }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: result, meta: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    await expect(deleteCustomUserGroup(input)).resolves.toEqual(result)
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user-group/delete', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
  })
})
