import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { createDeferred } from '@/test/deferred'
import { manifestRestoreShortLinks, ManifestRestoreUnknownError, type ManifestRestoreInput } from './manifest-restore-api'

const actor = 'a1111111-1111-4111-8111-111111115602'
const input: ManifestRestoreInput = {
  requestId: 'a1111111-1111-4111-8111-111111115609',
  items: [{
    domainOrigin: 'https://go.example', slug: 'doc001', targetUrl: 'https://target.example/path',
    title: 'Saved title', tags: ['docs'], status: 'active', redirectMode: 'direct',
    intermediateDelaySeconds: '5', expiresAt: '', maxVisits: '',
  }],
}

function response(data: unknown = { requestId: input.requestId, createdCount: 1 }, code = 0, status = 200) {
  return new Response(JSON.stringify({ code, message: 'private server detail', data, meta: {} }), { status })
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('manifest restore API', () => {
  it('posts the exact frozen payload with the captured actor and validates its receipt', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response())
    vi.stubGlobal('fetch', fetcher)
    expect(await manifestRestoreShortLinks(input, actor)).toEqual({ requestId: input.requestId, createdCount: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toEqual(['/api/v1/short-link/manifest/restore', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify(input),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-MoeURL-Expected-User-ID': actor },
    })])
  })

  it('omits the actor binding header for cookie-scoped API callers', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response())
    vi.stubGlobal('fetch', fetcher)

    await expect(manifestRestoreShortLinks(input)).resolves.toEqual({ requestId: input.requestId, createdCount: 1 })
    expect(fetcher.mock.calls[0]?.[1]?.headers).toEqual({
      Accept: 'application/json', 'Content-Type': 'application/json',
    })
  })

  it.each([
    { ...input, extra: true },
    { ...input, requestId: 'A1111111-1111-4111-8111-111111115609' },
    { ...input, items: [] },
    { ...input, items: [input.items[0], input.items[0]] },
    { ...input, items: [{ ...input.items[0], ownerId: actor }] },
  ])('rejects malformed local payload without sending it', async invalid => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(manifestRestoreShortLinks(invalid as ManifestRestoreInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a body beyond one MiB before sending', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const oversized = { ...input, items: [{ ...input.items[0]!, title: 'x'.repeat(1 << 20) }] }
    await expect(manifestRestoreShortLinks(oversized)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([100001, 120001, 200101, 200103, 200114, 200120])('preserves definite business refusal %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(manifestRestoreShortLinks(input, actor)).rejects.toMatchObject({ code })
  })

  it.each([401, 403])('preserves HTTP authority refusal %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, 0, status)))
    await expect(manifestRestoreShortLinks(input, actor)).rejects.toBeInstanceOf(ApiClientError)
  })

  it.each([
    null,
    {},
    { requestId: input.requestId, createdCount: 0 },
    { requestId: 'a1111111-1111-4111-8111-111111115608', createdCount: 1 },
    { requestId: input.requestId, createdCount: 1, extra: true },
  ])('treats an invalid success receipt as an unknown result', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(manifestRestoreShortLinks(input, actor)).rejects.toBeInstanceOf(ManifestRestoreUnknownError)
  })

  it.each(['network', 'http500', 'bad-json', 'bad-envelope', 'system-business-error'])('keeps %s retryable with the same request snapshot', async kind => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (kind === 'network') throw new Error('private transport detail')
      if (kind === 'http500') return response(null, 0, 500)
      if (kind === 'bad-json') return new Response('{')
      if (kind === 'bad-envelope') return new Response('[]')
      return response(null, 900000)
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(manifestRestoreShortLinks(input, actor)).rejects.toBeInstanceOf(ManifestRestoreUnknownError)
    await expect(manifestRestoreShortLinks(input, actor)).rejects.toBeInstanceOf(ManifestRestoreUnknownError)
    expect(fetcher.mock.calls.map(([, init]) => init?.body)).toEqual([JSON.stringify(input), JSON.stringify(input)])
  })

  it.each(['headers', 'body'] as const)('bounds a stalled %s response and reports an unknown result', async stage => {
    vi.useFakeTimers()
    const waiting = createDeferred<Response>()
    let body!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      body = controller
      controller.enqueue(new TextEncoder().encode('{"code":0,'))
    } })
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal ?? undefined
      signal?.addEventListener('abort', () => {
        if (stage === 'headers') waiting.reject(signal?.reason)
        else body.error(signal?.reason)
      }, { once: true })
      return stage === 'headers' ? waiting.promise : Promise.resolve(new Response(stream))
    }))
    const pending = manifestRestoreShortLinks(input, actor)
    const observed = expect(pending).rejects.toBeInstanceOf(ManifestRestoreUnknownError)
    await vi.advanceTimersByTimeAsync(15_000)
    await observed
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
    waiting.resolve(response())
  })
})
