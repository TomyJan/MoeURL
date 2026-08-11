import { describe, expect, it, vi } from 'vitest'

import { ApiClientError, apiGet, apiGetPath, apiPost, apiPostPath } from './client'

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

  it.each(['health', '//evil.example/health', '/\\evil.example/health', '/\\'])('rejects non-same-origin API path %s', async (path) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGetPath(path)).rejects.toThrow('API path must be a same-origin absolute path')
    await expect(apiPostPath(path, {})).rejects.toThrow('API path must be a same-origin absolute path')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects backslashes before URL normalization', async () => {
    const NativeURL = globalThis.URL
    let constructorCalls = 0
    class TrackedURL extends NativeURL {
      constructor(url: string | URL, base?: string | URL) {
        constructorCalls += 1
        super(url, base)
      }
    }
    vi.stubGlobal('URL', TrackedURL)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiGetPath('/\\')).rejects.toThrow('API path must be a same-origin absolute path')
    await expect(apiPostPath('/\\', {})).rejects.toThrow('API path must be a same-origin absolute path')
    expect(constructorCalls).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects URL parsing failures and cross-origin resolutions', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    class ThrowingURL {
      constructor() {
        throw new TypeError('invalid URL')
      }
    }
    vi.stubGlobal('URL', ThrowingURL)
    await expect(apiGetPath('/health')).rejects.toThrow('API path must be a same-origin absolute path')

    class CrossOriginURL {
      origin = 'https://evil.example'
      pathname = '/health'
      search = ''
    }
    vi.stubGlobal('URL', CrossOriginURL)
    await expect(apiPostPath('/health', {})).rejects.toThrow('API path must be a same-origin absolute path')

    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('requests the normalized path and query that passed same-origin validation', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: null, message: 'OK', meta: {} })))
    vi.stubGlobal('fetch', fetchMock)

    await apiGetPath('/go/abc/../def/preview?foo=1#ignored')

    expect(fetchMock).toHaveBeenCalledWith('/go/def/preview?foo=1', {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
      },
      method: 'GET',
    })
  })

  it('posts to the normalized path and query that passed same-origin validation', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: 0, data: null, message: 'OK', meta: {} })))
    vi.stubGlobal('fetch', fetchMock)

    await apiPostPath('/go/abc/../def/unlock?foo=1#ignored', { password: 'correct horse' })

    expect(fetchMock).toHaveBeenCalledWith('/go/def/unlock?foo=1', {
      body: JSON.stringify({ password: 'correct horse' }),
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      method: 'POST',
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
