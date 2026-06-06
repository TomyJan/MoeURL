import { describe, expect, it, vi } from 'vitest'

import { login } from './api'

describe('auth api', () => {
  it('posts local login request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { user: { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'admin', permissions: [] } },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await login({ username: 'alice', password: 'secret' })

    expect(result.user.username).toBe('alice')
    expect(result.user.group).toBe('admin')
    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({ method: 'POST' }))
  })
})
