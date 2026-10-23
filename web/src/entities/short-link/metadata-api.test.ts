import { describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { createShortLink, updateShortLink, updateAdminShortLink, listShortLinks, listAdminShortLinks, getShortLinkStatistics, getAdminShortLinkStatistics } from './api'

const baseLink = {
  id: 'link-id', url: 'https://go.example.com/abc123', slug: 'abc123', targetUrl: 'https://example.com',
  status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
  expired: false, passwordEnabled: false, createdAt: '2026-10-13T00:00:00Z',
  maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
  title: '文档', tags: ['Release 计划'],
}
const stats = { rangeVisitCount: 0, visitCount: 0, todayVisitCount: 0, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] }
const range = { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' }
const consumers = [
  { name: 'create', call: () => createShortLink({ targetUrl: baseLink.targetUrl }), data: (link: unknown) => ({ shortLink: link }) },
  { name: 'update', call: () => updateShortLink({ id: baseLink.id }), data: (link: unknown) => ({ shortLink: link }) },
  { name: 'admin update', call: () => updateAdminShortLink({ id: baseLink.id }), data: (link: unknown) => ({ shortLink: link }) },
  { name: 'list', call: () => listShortLinks(), data: (link: unknown) => ({ items: [link] }) },
  { name: 'admin list', call: () => listAdminShortLinks(), data: (link: unknown) => ({ items: [{ ...(link as object), updatedAt: '2026-10-23T00:00:00.123456Z', owner: { id: 'owner-id', username: 'alice', nickname: 'Alice' } }] }) },
  { name: 'statistics', call: () => getShortLinkStatistics(baseLink.id), data: (link: unknown) => ({ shortLink: link, stats, range }) },
  { name: 'admin statistics', call: () => getAdminShortLinkStatistics(baseLink.id), data: (link: unknown) => ({ shortLink: link, stats, range }) },
]

/** Supplies an untrusted business response to each managed API consumer. */
function respond(data: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), { headers: { 'Content-Type': 'application/json' } })))
}

describe.each(consumers)('$name metadata response contract', (consumer) => {
  it.each([{ title: '', tags: [] }, { title: '文档', tags: ['Release 计划'] }])('accepts required string and array metadata %j', async (metadata) => {
    respond(consumer.data({ ...baseLink, ...metadata }))
    await expect(consumer.call()).resolves.toBeDefined()
  })
  it.each([{ title: undefined }, { tags: undefined }, { title: null }, { tags: null }, { title: 5 }, { tags: [5] }, { tags: 'Release' }])('rejects malformed metadata %j', async (metadata) => {
    respond(consumer.data({ ...baseLink, ...metadata }))
    await expect(consumer.call()).rejects.toBeInstanceOf(ApiClientError)
  })
})

it.each([listShortLinks, listAdminShortLinks])('forwards q and exact tag with status and pagination without LIKE escaping', async (load) => {
  respond({ items: [] })
  await load({ page: 3, pageSize: 5, status: 'disabled', q: '%_文档\\', tag: 'Release 计划' })
  const url = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]), 'https://local.test')
  expect(Object.fromEntries(url.searchParams)).toEqual({ page: '3', pageSize: '5', status: 'disabled', q: '%_文档\\', tag: 'Release 计划' })
})

it('preserves omitted or null metadata and forwards full replacements including clear', async () => {
  respond({ shortLink: baseLink })
  const metadata = { title: '文档入口', tags: ['团队资料', 'Release 计划'] }
  await createShortLink({ targetUrl: baseLink.targetUrl, metadata })
  await updateShortLink({ id: baseLink.id, status: 'disabled' })
  await updateAdminShortLink({ id: baseLink.id, metadata: { title: '', tags: [] } })
  await updateShortLink({ id: baseLink.id, metadata: null })
  expect(vi.mocked(fetch).mock.calls.map((call) => JSON.parse(String(call[1]?.body)))).toEqual([
    { targetUrl: baseLink.targetUrl, metadata }, { id: baseLink.id, status: 'disabled' },
    { id: baseLink.id, metadata: { title: '', tags: [] } }, { id: baseLink.id, metadata: null },
  ])
})
