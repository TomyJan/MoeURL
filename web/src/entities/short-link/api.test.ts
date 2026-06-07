import { describe, expect, it, vi } from 'vitest'

import {
  createShortLink,
  deleteAdminShortLink,
  deleteShortLink,
  listAdminShortLinks,
  listShortLinks,
  updateAdminShortLink,
  updateShortLink,
} from './api'

describe('short link api', () => {
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

    const result = await listShortLinks(3, 15)

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
                  id: 'link-id',
                  url: 'https://go.example.com/abc123',
                  slug: 'abc123',
                  targetUrl: 'https://example.com',
                  status: 'active',
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

    const result = await listAdminShortLinks(2, 10)

    expect(result.items[0].owner.username).toBe('alice')
    expect(result.meta.total).toBe(21)
    expect(fetch).toHaveBeenCalledWith('/api/v1/admin/short-link/list?page=2&pageSize=10', expect.objectContaining({ method: 'GET' }))
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
