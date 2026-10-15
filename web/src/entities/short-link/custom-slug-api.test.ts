import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiClientError } from '@/shared/api/client'
import { createShortLink } from './api'

const shortLink = {
  id: 'link-id', url: 'https://go.example.com/teamdocs', slug: 'teamdocs', targetUrl: 'https://example.com',
  title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5,
  expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0,
  visitsRemaining: null, exhausted: false, createdAt: '2026-10-15T00:00:00Z',
}

describe('custom slug creation request contract', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { shortLink }, meta: {} }))))
  })

  it.each(['AbC', 'TeamDocs', 'A'.repeat(32)])('posts normalized ASCII custom slug %s while retaining other settings', async (customSlug) => {
    await createShortLink({ targetUrl: shortLink.targetUrl, customSlug, domainId: 'domain-id', metadata: { title: 'Docs', tags: ['Team'] } })
    expect(fetch).toHaveBeenCalledWith('/api/v1/short-link/create', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ targetUrl: shortLink.targetUrl, customSlug: customSlug.toLowerCase(), domainId: 'domain-id', metadata: { title: 'Docs', tags: ['Team'] } }),
    }))
  })

  it.each([{}, { customSlug: null }])('preserves random mode %j', async (custom) => {
    await createShortLink({ targetUrl: shortLink.targetUrl, ...custom })
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({ targetUrl: shortLink.targetUrl, ...custom })
  })

  it.each(['', 'ab', 'a'.repeat(33), ' abc', 'abc ', 'abc\n', 'a\tb', 'a\u0000b', 'ＡBC', 'abK', 'abİ', 'abſ', 'abé', 'ab-c', 'ab_c', 'ab/c', 'ab%20', 123, false, {}])('rejects invalid raw value %j before network and exposes a standard error', async (customSlug) => {
    await expect(createShortLink({ targetUrl: shortLink.targetUrl, customSlug } as never)).rejects.toMatchObject({ name: 'ApiClientError', code: 100001, message: 'Invalid short-link creation request' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([200101, 200102, 120001, 200114])('preserves backend business code %s for localized feedback', async (code) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code, message: 'Server details', data: null, meta: {} })))
    await expect(createShortLink({ targetUrl: shortLink.targetUrl, customSlug: 'Docs' })).rejects.toEqual(new ApiClientError(code, 'Server details'))
  })
})
