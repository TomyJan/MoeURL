import { describe, expect, it, vi } from 'vitest'

import { ApiClientError } from '@/shared/api/client'

import { createShortLink, getAdminShortLinkStatistics, getShortLinkStatistics, listAdminShortLinks, listShortLinks, updateAdminShortLink, updateShortLink } from './api'

const baseLink = {
  title: '', tags: [],
  id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com',
  status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
  expired: false, passwordEnabled: false, createdAt: '2026-10-13T00:00:00Z',
  maxVisits: 5, visitsUsed: 2, visitsRemaining: 3, exhausted: false,
}
const stats = { rangeVisitCount: 0, visitCount: 0, todayVisitCount: 0, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] }
const range = { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' }
const consumers = [
  { name: 'create', call: () => createShortLink({ targetUrl: baseLink.targetUrl, maxVisits: 5 }), data: (link: unknown) => ({ shortLink: link }) },
  { name: 'update', call: () => updateShortLink({ id: baseLink.id, visitLimit: { mode: 'limited', maxVisits: 5 } }), data: (link: unknown) => ({ shortLink: link }) },
  { name: 'admin update', call: () => updateAdminShortLink({ id: baseLink.id, visitLimit: { mode: 'unlimited' } }), data: (link: unknown) => ({ shortLink: link }) },
  { name: 'list', call: () => listShortLinks(), data: (link: unknown) => ({ items: [link] }) },
  { name: 'admin list', call: () => listAdminShortLinks(), data: (link: unknown) => ({ items: [{ ...(link as object), updatedAt: '2026-10-23T00:00:00.123456Z', owner: { id: 'owner-id', username: 'alice', nickname: 'Alice' } }] }) },
  { name: 'statistics', call: () => getShortLinkStatistics(baseLink.id), data: (link: unknown) => ({ shortLink: link, stats, range }) },
  { name: 'admin statistics', call: () => getAdminShortLinkStatistics(baseLink.id), data: (link: unknown) => ({ shortLink: link, stats, range }) },
]

/** Supplies a successful API envelope while leaving its business data untrusted. */
function respond(data: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), { headers: { 'Content-Type': 'application/json' } })))
}

describe.each(consumers)('$name visit quota contract', (consumer) => {
  it.each([
    { maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false },
    { maxVisits: 5, visitsUsed: 2, visitsRemaining: 3, exhausted: false },
    { maxVisits: 1, visitsUsed: 2, visitsRemaining: 0, exhausted: true },
  ])('accepts a consistent quota period %j', async (quota) => {
    respond(consumer.data({ ...baseLink, ...quota }))
    await expect(consumer.call()).resolves.toBeDefined()
  })

  it.each([
    { maxVisits: undefined }, { visitsUsed: undefined }, { visitsRemaining: undefined }, { exhausted: undefined },
    { maxVisits: 0 }, { maxVisits: 2147483648 }, { maxVisits: 1.5 }, { maxVisits: '5' },
    { visitsUsed: -1 }, { visitsUsed: 0.5 }, { visitsUsed: 2147483648 },
    { visitsRemaining: -1 }, { visitsRemaining: 0.5 }, { visitsRemaining: 4 },
    { exhausted: true }, { maxVisits: null },
    { maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: true },
    { maxVisits: null, visitsUsed: 1, visitsRemaining: null, exhausted: false },
  ])('rejects malformed or contradictory quota fields %j', async (invalid) => {
    respond(consumer.data({ ...baseLink, ...invalid }))
    await expect(consumer.call()).rejects.toBeInstanceOf(ApiClientError)
  })
})

it('forwards explicit quota changes without manufacturing a reset on omitted updates', async () => {
  respond({ shortLink: baseLink })
  await createShortLink({ targetUrl: baseLink.targetUrl, maxVisits: 5 })
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ targetUrl: baseLink.targetUrl, maxVisits: 5 })
  await updateShortLink({ id: baseLink.id, status: 'disabled' })
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body))).toEqual({ id: baseLink.id, status: 'disabled' })
  await updateAdminShortLink({ id: baseLink.id, visitLimit: { mode: 'unlimited' } })
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[2]?.[1]?.body))).toEqual({ id: baseLink.id, visitLimit: { mode: 'unlimited' } })
})
