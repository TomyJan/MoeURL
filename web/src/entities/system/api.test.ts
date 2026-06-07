import { describe, expect, it, vi } from 'vitest'

import { getInitStatus, setupSystem } from './api'

describe('system api', () => {
  it('loads initialization status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { initialized: false },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const status = await getInitStatus()

    expect(status.initialized).toBe(false)
  })

  it('posts setup request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { initialized: true },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await setupSystem({
      adminUsername: 'admin',
      adminPassword: 'admin-password',
      adminNickname: 'Admin',
      siteName: 'MoeURL',
      systemDomain: '127.0.0.1:8080',
      shortLinkDomain: '127.0.0.1:8080',
      defaultLanguage: 'zh-CN',
      defaultTheme: 'system',
    })

    expect(result.initialized).toBe(true)
    expect(fetch).toHaveBeenCalledWith('/api/v1/init/setup', expect.objectContaining({ method: 'POST' }))
  })
})
