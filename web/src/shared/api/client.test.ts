import { describe, expect, it, vi } from 'vitest'

import { ApiClientError, apiGet, apiPost } from './client'

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

  it('uses empty metadata for business failure without meta field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 110101,
            message: 'Invalid username or password',
            data: null,
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
      meta: {},
    })
  })


  it('throws api error for non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ message: 'Unauthorized' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 401,
        })
      }),
    )

    const error = await apiGet('/auth/me').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({
      code: 401,
      message: 'Unauthorized',
      meta: { status: 401 },
    })
  })

  it('uses HTTP status text when non-2xx response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('unauthorized', {
          status: 403,
        })
      }),
    )

    const error = await apiGet('/auth/me').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({
      code: 403,
      message: 'HTTP 403',
      meta: { status: 403 },
    })
  })

  it('throws api error for invalid JSON response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response('not json', {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        })
      }),
    )

    const error = await apiGet('/health').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiClientError)
    expect(error).toMatchObject({
      code: 100001,
      message: 'Invalid JSON response',
    })
  })

  it('posts requests without a body when no input is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
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

    await apiPost('/auth/logout')

    expect(fetch).toHaveBeenCalledWith('/api/v1/auth/logout', {
      body: undefined,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    })
  })
})
