import { afterEach, describe, expect, it, vi } from 'vitest'

import { getInitStatus, setupSystem } from './api'

describe('system api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads initialization status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { initialized: false, setupTokenRequired: true },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const status = await getInitStatus()

    expect(status).toEqual({ initialized: false, setupTokenRequired: true })
  })

  it.each([
    { initialized: false },
    { initialized: false, setupTokenRequired: 'yes' },
    { initialized: false, setupTokenRequired: true, setupToken: 'secret' },
  ])('rejects invalid initialization status data %#', async (data) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({ code: 0, message: 'OK', data, meta: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )),
    )

    await expect(getInitStatus()).rejects.toThrow()
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
      setupToken: 'production-setup-token',
    })

    expect(result).toEqual({ initialized: true })
    expect(fetch).toHaveBeenCalledWith('/api/v1/init/setup', expect.objectContaining({
      body: expect.stringContaining('production-setup-token'),
      method: 'POST',
    }))
  })

  it('rejects setup success data outside the setup response contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({
          code: 0,
          message: 'OK',
          data: { initialized: true, setupTokenRequired: false },
          meta: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )),
    )

    await expect(setupSystem({
      adminUsername: 'admin',
      adminPassword: 'admin-password',
      adminNickname: 'Admin',
      siteName: 'MoeURL',
      systemDomain: '127.0.0.1:8080',
      shortLinkDomain: '127.0.0.1:8080',
      defaultLanguage: 'zh-CN',
      defaultTheme: 'system',
    })).rejects.toThrow()
  })
})
