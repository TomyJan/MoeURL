import { afterEach, describe, expect, it, vi } from 'vitest'

import { getAdminSettings, getInitStatus, getPublicConfig, PublicConfigSchema, setupSystem, updateAdminSettings } from './api'

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

  it.each([
    ['site name length', { siteName: 'x'.repeat(65) }],
    ['language', { defaultLanguage: 'fr' }],
    ['theme', { defaultTheme: 'sepia' }],
  ] as const)('rejects invalid setup %s before sending a request', async (_name, override) => {
    const fetch = vi.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'OK', data: { initialized: true }, meta: {} }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetch)

    await expect(setupSystem({
      adminUsername: 'admin',
      adminPassword: 'admin-password',
      adminNickname: 'Admin',
      siteName: 'MoeURL',
      systemDomain: '127.0.0.1:8080',
      shortLinkDomain: '127.0.0.1:8080',
      defaultLanguage: 'zh-CN',
      defaultTheme: 'system',
      ...override,
    })).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('strictly parses public configuration', async () => {
    mockSuccess({ siteName: 'Example', defaultLanguage: 'en', defaultTheme: 'dark', footerText: 'Footer', showPoweredBy: false })

    await expect(getPublicConfig()).resolves.toEqual({ siteName: 'Example', defaultLanguage: 'en', defaultTheme: 'dark', footerText: 'Footer', showPoweredBy: false })
    expect(fetch).toHaveBeenCalledWith('/api/v1/system/public-config', expect.objectContaining({ method: 'GET' }))
  })

  it('rejects invalid public configuration instead of leaking unchecked defaults', async () => {
    mockSuccess({ siteName: '', defaultLanguage: 'fr', defaultTheme: 'dark', footerText: '', showPoweredBy: true })
    await expect(getPublicConfig()).rejects.toThrow()
  })

  it('counts site and footer limits by Unicode characters', () => {
    const base = { defaultLanguage: 'zh-CN', defaultTheme: 'system', showPoweredBy: true } as const

    expect(PublicConfigSchema.safeParse({ ...base, siteName: '😀'.repeat(64), footerText: '😀'.repeat(200) }).success).toBe(true)
    expect(PublicConfigSchema.safeParse({ ...base, siteName: '😀'.repeat(65), footerText: '' }).success).toBe(false)
    expect(PublicConfigSchema.safeParse({ ...base, siteName: 'MoeURL', footerText: '😀'.repeat(201) }).success).toBe(false)
  })

  it('loads and updates the complete administrative settings document', async () => {
    const settings = { siteName: 'Example', defaultLanguage: 'zh-CN' as const, defaultTheme: 'system' as const, footerText: '', showPoweredBy: true, localLoginEnabled: false, updatedAt: '2026-10-09T00:00:00Z' }
    mockSuccess(settings)
    await expect(getAdminSettings()).resolves.toEqual(settings)

    mockSuccess({ ...settings, siteName: 'Changed' })
    const { updatedAt, ...values } = settings
    await expect(updateAdminSettings({ ...values, expectedUpdatedAt: updatedAt })).resolves.toEqual({ ...settings, siteName: 'Changed' })
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/admin/system/settings/update', expect.objectContaining({ method: 'POST' }))
  })
})

/** Installs one successful API envelope for the next request. */
function mockSuccess(data: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify({ code: 0, message: 'OK', data, meta: {} }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )))
}
