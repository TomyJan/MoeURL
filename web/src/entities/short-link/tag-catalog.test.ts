import { afterEach, describe, expect, it, vi } from 'vitest'
import { listPersonalTags, listAdminTags, tagCatalogQuerySchema } from './tag-catalog'

/** Supplies a fresh HTTP body for every request rather than reusing consumed Responses. */
function response(data: unknown) { return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} })) }
afterEach(() => { vi.unstubAllGlobals() })

describe.each([
  ['own', listPersonalTags, '/api/v1/short-link/tags'],
  ['admin', listAdminTags, '/api/v1/admin/short-link/tags'],
] as const)('%s tag catalog HTTP contract', (_context, listTags, path) => {
  it('encodes literal Unicode and wildcard-like characters, retaining exact tag text', async () => {
    const data = { items: [{ tag: '<b>%_\\文</b>', linkCount: 2 }], hasMore: false }
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    expect(await listTags('\u3000%_\\文\u00a0')).toEqual(data)
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]), 'http://localhost').searchParams.get('q')).toBe('%_\\文')
    expect(new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]), 'http://localhost').pathname).toBe(path)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ method: 'GET', credentials: 'include' })
    expect(await listTags()).toEqual(data)
  })
  it.each(['\tA', 'A\n', '\u0085A', '\u0000', '\ud800', '😀'.repeat(33)])('rejects invalid raw search %j before HTTP', async query => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(listTags(query)).rejects.toMatchObject({ code: 100001 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('counts code points, trims Go space and preserves BOM and Unicode normalization', () => {
    for (const query of ['', '😀'.repeat(32), '\ufeffA', 'Cafe\u0301', '\u3000x\u00a0']) expect(tagCatalogQuerySchema.safeParse(query).success).toBe(true)
    expect(tagCatalogQuerySchema.parse('\u3000x\u00a0')).toBe('x')
  })
  it.each([
    null, {}, { items: [], hasMore: false, ownerId: 'other' }, { items: [], hasMore: 0 },
    { items: [{ tag: 'A', linkCount: 0 }], hasMore: false },
    { items: [{ tag: 'A', linkCount: 1.1 }], hasMore: false },
    { items: [{ tag: 'A', linkCount: Number.MAX_SAFE_INTEGER + 1 }], hasMore: false },
    { items: [{ tag: 'A', linkCount: 1, owner: 'other' }], hasMore: false },
    ...['', ' A ', 'x'.repeat(33), 'bad\u0000', '\ud800'].map(tag => ({ items: [{ tag, linkCount: 1 }], hasMore: false })),
    { items: [{ tag: 'A', linkCount: 1 }, { tag: 'A', linkCount: 2 }], hasMore: false },
    { items: Array.from({ length: 51 }, (_, i) => ({ tag: 'tag'+i, linkCount: 1 })), hasMore: true },
    { items: [], hasMore: true },
  ])('rejects incomplete or invalid response %j', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(listTags('')).rejects.toMatchObject({ code: 100001 })
  })
  it('accepts explicit empty and a complete bounded page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: [], hasMore: false })))
    expect(await listTags('')).toEqual({ items: [], hasMore: false })
    const data = { items: Array.from({ length: 50 }, (_, i) => ({ tag: 'tag'+i, linkCount: 1 })), hasMore: true }
    vi.mocked(fetch).mockImplementation(async () => response(data))
    expect(await listTags('')).toEqual(data)
  })
})
