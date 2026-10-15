import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { changePassword, getPasswordStatus } from './password'

/** Supplies an untrusted response through the real authenticated HTTP client. */
function respond(data: unknown, code = 0, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: 'private server detail', data, meta: {} }), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => vi.unstubAllGlobals())

describe('password API', () => {
  it.each([true, false])('loads the strict availability flag %s', async (canChangePassword) => {
    const fetcher = respond({ canChangePassword })
    await expect(getPasswordStatus()).resolves.toEqual({ canChangePassword })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/password/status', expect.objectContaining({ method: 'GET', credentials: 'include' }))
  })

  it('posts only the original credentials and accepts a confirmed change', async () => {
    const fetcher = respond({ changed: true })
    const input = { currentPassword: ' old ', newPassword: '  特殊"\\$<>&密码  ' }
    await expect(changePassword(input)).resolves.toEqual({ changed: true })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/auth/password/change', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
  })

  it.each([{}, null, { canChangePassword: 'true' }, { canChangePassword: true, extra: false }])('rejects malformed status %j', async (data) => {
    respond(data)
    await expect(getPasswordStatus()).rejects.toMatchObject({ code: 100001 })
  })

  it.each([{}, null, { changed: false }, { changed: true, extra: false }])('rejects unconfirmed change %j', async (data) => {
    respond(data)
    await expect(changePassword({ currentPassword: 'old', newPassword: 'password' })).rejects.toBeInstanceOf(ApiClientError)
  })

  it.each([100001, 110101, 110103, 110105, 900000])('preserves business failure %s', async (code) => {
    respond(null, code)
    await expect(changePassword({ currentPassword: 'old', newPassword: 'password' })).rejects.toMatchObject({ code })
  })

  it('preserves the shared HTTP 401 mapping for expired sessions', async () => {
    respond(null, 110101, 401)
    await expect(getPasswordStatus()).rejects.toMatchObject({ code: 401 })
  })
})
