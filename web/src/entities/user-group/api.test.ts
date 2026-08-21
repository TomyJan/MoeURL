import { afterEach, describe, expect, it, vi } from 'vitest'

import { listUserGroups, updateUserGroupPermissions } from './api'

const responseData = {
  groups: [
    { key: 'guest', name: 'Guest', description: 'Guest group', builtin: true, editable: false, permissions: [], updatedAt: '2026-08-20T00:00:00Z' },
    { key: 'user', name: 'User', description: 'User group', builtin: true, editable: true, permissions: ['short_link:create'], updatedAt: '2026-08-20T00:00:01Z' },
    { key: 'admin', name: 'Admin', description: 'Admin group', builtin: true, editable: true, permissions: ['admin:access'], updatedAt: '2026-08-20T00:00:02Z' },
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

  it.each([
    ['unknown category', { ...responseData, permissions: [{ key: 'short_link:create', category: 'unknown', protected: false }] }],
    ['missing editable', { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? omitEditable(group) : group) }],
    ['inconsistent editable', { ...responseData, groups: responseData.groups.map((group, index) => index === 0 ? { ...group, editable: true } : group) }],
    ['duplicate group key', { ...responseData, groups: [responseData.groups[0], responseData.groups[1], { ...responseData.groups[2], key: 'user' }] }],
    ['duplicate permission key', { ...responseData, permissions: [responseData.permissions[0], responseData.permissions[0]] }],
    ['duplicate preset key', { ...responseData, presets: [responseData.presets[0], responseData.presets[1], { ...responseData.presets[2], key: 'basic' }] }],
    ['invalid applicable groups', { ...responseData, presets: responseData.presets.map((preset, index) => index === 0 ? { ...preset, applicableGroups: ['guest'] } : preset) }],
    ['unknown preset permission', { ...responseData, presets: responseData.presets.map((preset, index) => index === 0 ? { ...preset, permissions: ['unknown'] } : preset) }],
    ['invalid updatedAt', { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? { ...group, updatedAt: 'invalid' } : group) }],
  ])('rejects an invalid %s response', async (_name, data) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).rejects.toEqual(expect.objectContaining({ code: 100001 }))
  })

  it('includes the first schema issue path in development diagnostics', async () => {
    const data = { ...responseData, groups: responseData.groups.map((group, index) => index === 1 ? omitEditable(group) : group) }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(listUserGroups()).rejects.toEqual(expect.objectContaining({
      code: 100001,
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
      code: 100001,
      message: 'Invalid user group response',
    }))
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
})
