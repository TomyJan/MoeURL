import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinksWithCustomSlugs } from './bulk-create'

const input = { requestId: '11111111-1111-4111-8111-111111111111', items: [
  { targetUrl: 'https://example.com', title: ' raw ', tags: [' tools ', 'a,b'], customSlug: 'Team56' },
  { targetUrl: 'https://example.org', title: '', tags: [], customSlug: '' },
] }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('custom-code batch client', () => {
  it('sends original ordered items to the fourth endpoint with the expected identity', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0, message: '', data: { requestId: input.requestId, createdCount: 2 }, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithCustomSlugs(input, 'actor56')).resolves.toEqual({ requestId: input.requestId, createdCount: 2 })
    expect(fetcher.mock.calls).toEqual([['/api/v1/short-link/batch-create-with-custom-slugs', expect.objectContaining({
      method: 'POST', body: JSON.stringify(input), headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': 'actor56' }),
    })]])
  })

  it.each([
    { ...input, items: [] },
    { ...input, items: [input.items[0]!, { ...input.items[1]!, customSlug: 'team56' }] },
    { ...input, items: [{ ...input.items[0]!, customSlug: ' Team56' }] },
    { ...input, items: [{ ...input.items[0]!, tags: ['\uD800'] }] },
    { ...input, items: [{ ...input.items[0]!, title: '\uD800' }] },
  ])('rejects invalid local input without a write %j', async value => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithCustomSlugs(value)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([200101, 200102])('keeps conflict or reserved-name refusal %i definite', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code, message: 'refused', data: null, meta: {} }))))
    await expect(batchCreateShortLinksWithCustomSlugs(input)).rejects.toMatchObject({ code })
  })
})
