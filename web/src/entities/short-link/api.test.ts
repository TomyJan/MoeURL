import { describe, expect, it, vi } from 'vitest'

import {
  createShortLink,
  deleteAdminShortLink,
  deleteShortLink,
  getAdminShortLinkStatistics,
  getPublicShortLinkPreview,
  unlockShortLink,
  getShortLinkOverview,
  getShortLinkStatistics,
  listAdminShortLinks,
  listShortLinks,
  updateAdminShortLink,
  updateShortLink,
} from './api'

const accessAndQuota = {
  title: '', tags: [],
  redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
  expired: false, passwordEnabled: false, createdAt: '2026-10-13T00:00:00Z',
  maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
}

describe('short link api', () => {
  it.each([
    ['owner', listShortLinks],
    ['administrator', listAdminShortLinks],
  ] as const)('preserves every %s list item when a stored target URL is rejected by the browser URL parser', async (role, load) => {
    const items = ['https://example.com', 'https://example.com:65536'].map((targetUrl, index) => ({
      ...accessAndQuota,
      id: `link-${index}`, url: `https://go.example.com/abc12${index}`, slug: `abc12${index}`,
      targetUrl, status: 'active',
      ...(role === 'administrator' ? { owner: { id: 'owner-id', username: 'alice', nickname: 'Alice' } } : {}),
    }))
    const meta = { page: 1, pageSize: 20, total: items.length }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 0, message: 'OK', data: { items }, meta,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(load()).resolves.toEqual({ items, meta })
  })

  it('loads the current user overview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        data: { totalLinkCount: 12, activeLinkCount: 9, visitCount: 840, todayVisitCount: 31 },
        meta: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(getShortLinkOverview()).resolves.toEqual({
      totalLinkCount: 12,
      activeLinkCount: 9,
      visitCount: 840,
      todayVisitCount: 31,
    })
    expect(fetch).toHaveBeenCalledWith('/api/v1/short-link/overview', expect.objectContaining({ method: 'GET' }))
  })

  it('loads owner and administrator analytics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        data: {
          shortLink: { ...accessAndQuota, id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' },
          range: { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' },
          stats: { rangeVisitCount: 2, visitCount: 2, todayVisitCount: 1, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] },
        },
        meta: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(getShortLinkStatistics('link id')).resolves.toMatchObject({ stats: { visitCount: 2 } })
    await expect(getAdminShortLinkStatistics('link id')).resolves.toMatchObject({ shortLink: { slug: 'abc123' } })

    expect(fetch).toHaveBeenCalledWith('/api/v1/short-link/statistics?id=link%20id', expect.objectContaining({ method: 'GET' }))
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/short-link/statistics?id=link%20id', expect.objectContaining({ method: 'GET' }))
  })

  it.each([getShortLinkStatistics, getAdminShortLinkStatistics])('encodes preset and custom statistics ranges', async (load) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', meta: {}, data: {
      shortLink: { ...accessAndQuota, id: 'id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' },
      range: { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' },
      stats: { rangeVisitCount: 0, visitCount: 2, todayVisitCount: 0, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] },
    } }))))
    await load('a &b', { days: 30 })
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toMatch(/statistics\?id=a%20%26b&days=30$/)
    await load('id', { startDate: '2026-08-01', endDate: '2026-08-30' })
    expect(String(vi.mocked(fetch).mock.calls[1]![0])).toMatch(/statistics\?id=id&startDate=2026-08-01&endDate=2026-08-30$/)
  })

  it.each([
    undefined,
    { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'Asia/Shanghai' },
    { startDate: '2026-02-30', endDate: '2026-03-01', timeZone: 'UTC' },
    { startDate: '2026-10-15', endDate: '2026-10-09', timeZone: 'UTC' },
    { startDate: '2026-01-01', endDate: '2026-10-15', timeZone: 'UTC' },
    { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC', unexpected: true },
  ])('rejects invalid server statistics ranges: %j', async (range) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', meta: {}, data: {
      shortLink: { ...accessAndQuota, id: 'id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' },
      range, stats: { rangeVisitCount: 0, visitCount: 0, todayVisitCount: 0, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] },
    } }))))
    await expect(getShortLinkStatistics('id')).rejects.toMatchObject({ code: 100001 })
  })

  it.each([undefined, -1, 0.5, '2'])('rejects missing or invalid range visit count: %j', async (rangeVisitCount) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', meta: {}, data: {
      shortLink: { ...accessAndQuota, id: 'id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' },
      range: { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' },
      stats: { rangeVisitCount, visitCount: 0, todayVisitCount: 0, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] },
    } }))))
    await expect(getShortLinkStatistics('id')).rejects.toMatchObject({ code: 100001 })
  })

  it('posts create request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              shortLink: {
                ...accessAndQuota,
                id: 'link-id',
                url: 'https://go.example.com/abc123',
                slug: 'abc123',
                targetUrl: 'https://example.com',
                status: 'active',
              },
            },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await createShortLink({ targetUrl: 'https://example.com' })

    expect(result.shortLink.slug).toBe('abc123')
    expect(fetch).toHaveBeenCalledWith('/api/v1/short-link/create', expect.objectContaining({ method: 'POST' }))
  })

  it('posts access configuration and loads the minimal public preview', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = String(request)
        return new Response(JSON.stringify({
          code: 0,
          message: 'OK',
          data: url.includes('/preview')
            ? { slug: 'abc123', targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: 5, expiresAt: null }
            : { shortLink: { ...accessAndQuota, id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com', status: 'active' } },
          meta: {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )

    await createShortLink({
      targetUrl: 'https://example.com/docs',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiration: { mode: 'never' },
    })
    await expect(getPublicShortLinkPreview('a b')).resolves.toEqual({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })

    const createCall = vi.mocked(fetch).mock.calls.find(([input]) => input === '/api/v1/short-link/create')
    expect(createCall).toBeDefined()
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      targetUrl: 'https://example.com/docs',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiration: { mode: 'never' },
    })
    expect(fetch).toHaveBeenCalledWith(
      '/go/a%20b/preview',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('loads protected public preview metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        data: {
          slug: 'abc123',
          targetHost: 'example.com',
          redirectMode: 'direct',
          intermediateDelaySeconds: null,
          expiresAt: '2026-08-06T09:00:00Z',
        },
        meta: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(getPublicShortLinkPreview('abc123')).resolves.toEqual({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: '2026-08-06T09:00:00Z',
    })
  })

  it('loads confirmation-mode public preview metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        data: {
          slug: 'confirm2',
          targetHost: 'example.com',
          redirectMode: 'confirmation',
          intermediateDelaySeconds: null,
          expiresAt: null,
        },
        meta: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(getPublicShortLinkPreview('confirm2')).resolves.toEqual({
      slug: 'confirm2',
      targetHost: 'example.com',
      redirectMode: 'confirmation',
      intermediateDelaySeconds: null,
      expiresAt: null,
    })
  })

  it.each([
    ['missing data', undefined],
    ['null data', null],
    ['scalar data', 'invalid'],
    ['missing redirect mode', { slug: 'abc123', targetHost: 'example.com', intermediateDelaySeconds: 5, expiresAt: null }],
    ['unknown redirect mode', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'unknown', intermediateDelaySeconds: 5, expiresAt: null }],
    ['sensitive target url', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'confirmation', intermediateDelaySeconds: null, expiresAt: null, targetUrl: 'https://example.com/private' }],
    ['invalid slug', { slug: 1, targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: 5, expiresAt: null }],
    ['invalid target host', { slug: 'abc123', targetHost: null, redirectMode: 'intermediate', intermediateDelaySeconds: 5, expiresAt: null }],
    ['delay below minimum', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: 2, expiresAt: null }],
    ['delay above maximum', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: 11, expiresAt: null }],
    ['fractional delay', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: 5.5, expiresAt: null }],
    ['invalid delay', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: '5', expiresAt: null }],
    ['missing intermediate delay', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: null, expiresAt: null }],
    ['direct delay', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null }],
    ['confirmation delay', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'confirmation', intermediateDelaySeconds: 5, expiresAt: null }],
    ['invalid expiration', { slug: 'abc123', targetHost: 'example.com', redirectMode: 'intermediate', intermediateDelaySeconds: 5, expiresAt: 1 }],
  ])('rejects public preview with %s', async (_name, data) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        code: 0,
        message: 'OK',
        data,
        meta: {},
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    )

    await expect(getPublicShortLinkPreview('abc123')).rejects.toMatchObject({ code: 100001 })
  })

  it('posts a scoped short-link unlock request without repeating the slug in the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { unlocked: true }, meta: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    )

    await expect(unlockShortLink({ slug: 'abc123', password: 'correct horse' })).resolves.toEqual({ unlocked: true })
    const [input, init] = vi.mocked(fetch).mock.calls[0] ?? []
    expect(input).toBe('/go/abc123/unlock')
    expect(JSON.parse(String(init?.body))).toEqual({ password: 'correct horse' })
  })

  it('rejects an invalid public short-link unlock response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { unlocked: 'yes' }, meta: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    )

    await expect(unlockShortLink({ slug: 'abc123', password: 'correct horse' })).rejects.toMatchObject({ code: 100001 })
  })

  it('rejects an unsuccessful public short-link unlock response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { unlocked: false }, meta: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    )

    await expect(unlockShortLink({ slug: 'abc123', password: 'correct horse' })).rejects.toMatchObject({ code: 100001 })
  })

  it('rejects public short-link unlock responses with unknown fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { unlocked: true, extra: 'unexpected' }, meta: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    )

    await expect(unlockShortLink({ slug: 'abc123', password: 'correct horse' })).rejects.toMatchObject({ code: 100001 })
  })

  it('loads my short links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { items: [] },
            meta: { page: 1, pageSize: 20, total: 0 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await listShortLinks()

    expect(result.items).toHaveLength(0)
    expect(result.meta.total).toBe(0)
    expect(fetch).toHaveBeenCalledWith('/api/v1/short-link/list?page=1&pageSize=20', expect.objectContaining({ method: 'GET' }))
  })

  it('loads my short links with basic statistics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              items: [
                {
                  ...accessAndQuota,
                  id: 'link-id',
                  url: 'https://go.example.com/abc123',
                  slug: 'abc123',
                  targetUrl: 'https://example.com',
                  status: 'active',
                  createdAt: '2026-07-01T00:00:00Z',
                  stats: {
                    visitCount: 2,
                    todayVisitCount: 1,
                    lastVisitedAt: '2026-07-16T05:00:00Z',
                  },
                },
              ],
            },
            meta: { page: 1, pageSize: 20, total: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await listShortLinks()

    const [item] = result.items
    if (!item?.stats) {
      throw new Error('expected short link statistics')
    }
    expect(item.stats.visitCount).toBe(2)
    expect(item.stats.todayVisitCount).toBe(1)
    expect(item.stats.lastVisitedAt).toBe('2026-07-16T05:00:00Z')
    expect(item.createdAt).toBe('2026-07-01T00:00:00Z')
  })

  it('loads my short links with status filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [] }, meta: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    await listShortLinks({ page: 2, pageSize: 10, status: 'disabled' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/short-link/list?page=2&pageSize=10&status=disabled',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('uses requested pagination defaults when list meta is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: { items: [] },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await listShortLinks({ page: 3, pageSize: 15 })

    expect(result.meta).toEqual({ page: 3, pageSize: 15, total: 0 })
  })

  it('posts update and delete requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              shortLink: {
                ...accessAndQuota,
                id: 'link-id',
                url: 'https://go.example.com/abc123',
                slug: 'abc123',
                targetUrl: 'https://example.org',
                status: 'disabled',
              },
            },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    await updateShortLink({ id: 'link-id', status: 'disabled' })
    await deleteShortLink('link-id')

    expect(fetch).toHaveBeenCalledWith('/api/v1/short-link/update', expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenCalledWith('/api/v1/short-link/delete', expect.objectContaining({ method: 'POST' }))
  })

  it('loads admin short links with owner summaries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              items: [
                {
                  ...accessAndQuota,
                  id: 'link-id',
                  url: 'https://go.example.com/abc123',
                  slug: 'abc123',
                  targetUrl: 'https://example.com',
                  status: 'active',
                  createdAt: '2026-07-02T00:00:00Z',
                  stats: { visitCount: 3, todayVisitCount: 2, lastVisitedAt: null },
                  owner: { id: 'owner-id', username: 'alice', nickname: 'Alice' },
                },
              ],
            },
            meta: { page: 2, pageSize: 10, total: 21 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    const result = await listAdminShortLinks({ page: 2, pageSize: 10 })

    const [item] = result.items
    if (!item?.stats) {
      throw new Error('expected admin short link statistics')
    }
    expect(item.owner.username).toBe('alice')
    expect(item.stats.visitCount).toBe(3)
    expect(item.createdAt).toBe('2026-07-02T00:00:00Z')
    expect(result.meta.total).toBe(21)
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/short-link/list?page=2&pageSize=10', expect.objectContaining({ method: 'GET' }))
  })

  it('loads admin short links with default pagination', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [] }, meta: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const result = await listAdminShortLinks()

    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 0 })
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/short-link/list?page=1&pageSize=20', expect.objectContaining({ method: 'GET' }))
  })

  it('loads admin short links with filters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [] }, meta: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    await listAdminShortLinks({ page: 3, pageSize: 15, status: 'active', q: 'alice link' })

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/admin/short-link/list?page=3&pageSize=15&status=active&q=alice+link',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('posts admin update and delete requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            message: 'OK',
            data: {
              shortLink: {
                ...accessAndQuota,
                id: 'link-id',
                url: 'https://go.example.com/abc123',
                slug: 'abc123',
                targetUrl: 'https://example.org',
                status: 'disabled',
              },
            },
            meta: {},
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }),
    )

    await updateAdminShortLink({ id: 'link-id', status: 'disabled' })
    await deleteAdminShortLink('link-id')

    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/short-link/update', expect.objectContaining({ method: 'POST' }))
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/short-link/delete', expect.objectContaining({ method: 'POST' }))
  })
})
