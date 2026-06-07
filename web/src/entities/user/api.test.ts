import { describe, expect, it, vi } from 'vitest'

import { createUser } from './api'

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
})
