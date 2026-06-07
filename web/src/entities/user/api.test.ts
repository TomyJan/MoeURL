import { describe, expect, it, vi } from 'vitest'

import { createUser, listUsers, resetUserPassword, updateUser } from './api'

describe('user api', () => {
  it('posts admin create user request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', status: 'active' } },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await createUser({
      username: 'alice',
      password: 'secure-password',
      nickname: 'Alice',
      groupKey: 'user',
      status: 'active',
    })

    expect(result.user.username).toBe('alice')
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user/create', expect.objectContaining({ method: 'POST' }))
  })

  it('gets admin user list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              items: [
                {
                  id: 'user-id',
                  username: 'alice',
                  nickname: 'Alice',
                  group: 'user',
                  status: 'active',
                  builtin: false,
                  createdAt: '2026-06-08T00:00:00Z',
                  updatedAt: '2026-06-08T00:00:00Z',
                },
              ],
            },
            meta: { page: 2, pageSize: 10, total: 21 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await listUsers({ page: 2, pageSize: 10 })

    expect(result.items[0].username).toBe('alice')
    expect(result.meta.total).toBe(21)
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user/list?page=2&pageSize=10', expect.objectContaining({ method: 'GET' }))
  })

  it('uses requested user list meta fallback', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              items: [
                {
                  id: 'user-id',
                  username: 'alice',
                  nickname: 'Alice',
                  group: 'user',
                  status: 'active',
                  builtin: false,
                  createdAt: '2026-06-08T00:00:00Z',
                  updatedAt: '2026-06-08T00:00:00Z',
                },
              ],
            },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await listUsers({ page: 3, pageSize: 15 })

    expect(result.meta).toEqual({ page: 3, pageSize: 15, total: 1 })
  })

  it('posts admin update user request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { user: { id: 'user-id', username: 'alice', nickname: 'Alice Renamed', group: 'user', status: 'disabled', builtin: false } },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await updateUser({ id: 'user-id', nickname: 'Alice Renamed', status: 'disabled' })

    expect(result.user.status).toBe('disabled')
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user/update', expect.objectContaining({ method: 'POST' }))
  })

  it('posts admin reset password request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ code: 0, message: 'OK', data: { reset: true }, meta: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const result = await resetUserPassword({ id: 'user-id', password: 'new-password' })

    expect(result.reset).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/user/reset-password', expect.objectContaining({ method: 'POST' }))
  })
})
