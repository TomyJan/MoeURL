import { describe, expect, it, vi } from 'vitest'

import { ApiClientError, apiGet } from './client'

describe('api client', () => {
  it('returns decoded unified response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { status: 'ok' },
            meta: {},
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }),
    )

    const response = await apiGet<{ status: string }>('/health')

    expect(response.code).toBe(0)
    expect(response.data.status).toBe('ok')
    expect(fetch).toHaveBeenCalledWith('/api/v1/health', {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
      method: 'GET',
    })
  })

  it('throws api error for business failure response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 110101,
            message: 'Invalid username or password',
            data: null,
            meta: {},
          }),
          {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
          },
        )
      }),
    )

    const error = await apiGet('/auth/me').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({
      code: 110101,
      message: 'Invalid username or password',
    })
  })
})
