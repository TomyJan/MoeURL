import { afterEach, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { batchCreateShortLinks, batchCreateShortLinksWithTitles, batchCreateShortLinksWithMetadata, batchCreateShortLinksWithCustomSlugs, BulkCreateUnknownError } from './bulk-create'

const requestId = '00000000-0000-0000-0000-000000006110'
afterEach(() => vi.unstubAllGlobals())
it.each([
  { name: 'targets', run: () => batchCreateShortLinks({ requestId, targetUrls: ['https://blocked.example'] }) },
  { name: 'titles', run: () => batchCreateShortLinksWithTitles({ requestId, items: [{ targetUrl: 'https://blocked.example', title: '' }] }) },
  { name: 'metadata', run: () => batchCreateShortLinksWithMetadata({ requestId, items: [{ targetUrl: 'https://blocked.example', title: '', tags: [] }] }) },
  { name: 'custom slugs', run: () => batchCreateShortLinksWithCustomSlugs({ requestId, items: [{ targetUrl: 'https://blocked.example', title: '', tags: [], customSlug: '' }] }) },
])('recognizes a $name policy refusal as definite without claiming an unknown write', async ({ run }) => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 200121, message: 'private detail', data: null, meta: {} })))
  const result = await run().catch(error => error)
  expect(result).toBeInstanceOf(ApiClientError)
  expect(result).not.toBeInstanceOf(BulkCreateUnknownError)
  expect(result.code).toBe(200121)
})
