import { afterEach, describe, expect, it, vi } from 'vitest'
import { renameOwnTags, renameAdminTags, renameTagSchema } from './batch-tag-rename'

const id = '00000000-0000-0000-0000-000000000020', actor = '00000000-0000-0000-0000-000000000001'
const item = { id, expectedUpdatedAt: '2026-11-05T00:00:00.123456789Z' }
const input = { items: [item], fromTag: 'old', toTag: 'new' }
const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'sensitive-canary', data, meta: { private: 'sensitive-canary' } }), { status })
afterEach(() => vi.unstubAllGlobals())

describe('strict batch tag rename client', () => {
  it.each([['own', renameOwnTags], ['admin', renameAdminTags]] as const)('pins one %s request to its complete version and captured actor', async (context, rename) => {
    const fetcher = vi.fn(async () => response({ changedCount: 1, unchangedCount: 0 })); vi.stubGlobal('fetch', fetcher)
    expect(await rename({ ...input, fromTag: '　old ', toTag: ' new ' }, actor)).toEqual({ changedCount: 1, unchangedCount: 0 })
    expect(fetcher.mock.calls).toHaveLength(1)
    const [url, options] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/batch-tag-rename`)
    expect(JSON.parse(options!.body as string)).toEqual(input)
    expect(options!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor })
  })
  it.each(['', ' ', '\told', 'old\n', '\u0085old', '\0', '\ud800', '\udfff', '😀'.repeat(33)])('rejects raw invalid label %j before dispatch', async tag => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    for (const field of ['fromTag', 'toTag']) await expect(renameOwnTags({ ...input, [field]: tag }, actor)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('preserves BOM, case, combining sequences and exactly 32 scalar values', () => {
    for (const value of ['\ufeffold\ufeff', 'OLD', 'e\u0301', '😀'.repeat(32)]) expect(renameTagSchema.parse(value)).toBe(value)
  })
  it.each([
    { ...input, extra: true }, { ...input, fromTag: ' new ' }, { ...input, items: [] }, { ...input, items: [item, item] },
    { ...input, items: [{ ...item, id: 'bad' }] }, { ...input, items: [{ ...item, id: '00000000-0000-0000-0000-000000000000' }] },
    ...['bad', '0001-01-01T00:00:00Z', '2026-11-05T00:00:00.1234567890Z', '0000-01-01T00:00:00Z'].map(expectedUpdatedAt => ({ ...input, items: [{ ...item, expectedUpdatedAt }] })),
    { ...input, items: [{ ...item, extra: true }] },
    { ...input, items: Array.from({ length: 101 }, (_, i) => ({ ...item, id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}` })) },
  ])('rejects invalid request without network: %#', async value => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(renameOwnTags(value, actor)).rejects.toMatchObject({ code: 100001 }); expect(fetcher).not.toHaveBeenCalled()
  })
  it('accepts 100 distinct targets and a nonzero subsecond year-one token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ changedCount: 0, unchangedCount: 100 })))
    await expect(renameOwnTags({ ...input, items: Array.from({ length: 100 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, expectedUpdatedAt: '0001-01-01T00:00:00.000000001Z' })) }, actor)).resolves.toEqual({ changedCount: 0, unchangedCount: 100 })
  })
  it.each([{}, null, { changedCount: -1, unchangedCount: 2 }, { changedCount: 0.5, unchangedCount: 0.5 }, { changedCount: 2, unchangedCount: 0 }, { changedCount: 1, unchangedCount: 0, extra: true }])('marks malformed success as uncertain without exposing its data: %#', async data => {
    const fetcher = vi.fn(async () => response(data)); vi.stubGlobal('fetch', fetcher)
    await expect(renameOwnTags(input, actor)).rejects.toMatchObject({ meta: { invalidBatchTagRenameResponse: true } })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['transport', 'business', 'http', 'envelope'] as const)('sanitizes %s errors and never retries', async kind => {
    const fetcher = vi.fn(async () => { if (kind === 'transport') throw new Error('sensitive-canary'); return kind === 'envelope' ? new Response('sensitive-canary') : response(null, 200116, kind === 'http' ? 503 : 200) }); vi.stubGlobal('fetch', fetcher)
    const error = await renameOwnTags(input, actor).catch(cause => cause)
    expect(JSON.stringify(error) + error.message).not.toContain('sensitive-canary'); expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects an invalid captured actor before dispatch', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(renameOwnTags(input, '')).rejects.toMatchObject({ code: 100001 }); expect(fetcher).not.toHaveBeenCalled()
  })
})
