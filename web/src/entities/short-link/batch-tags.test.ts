import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchTagShortLinks } from './batch-tags'

const item = { id: '00000000-0000-0000-0000-000000000020', expectedUpdatedAt: '2026-10-26T00:00:00.123456789Z' }
const input = { items: [item], operation: 'add' as const, tags: [' 项目 A '] }
afterEach(() => vi.unstubAllGlobals())
describe('atomic tag API', () => {
  it.each(['own', 'admin'] as const)('sends normalized tags and full precision to %s endpoint', async context => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: 1, unchangedCount: 0 }, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    expect(await batchTagShortLinks(input, context)).toEqual({ changedCount: 1, unchangedCount: 0 })
    expect(fetcher.mock.calls[0]?.[0]).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/batch-tags`)
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ items: [item], operation: 'add', tags: ['项目 A'] })
  })
  it.each(['add', 'remove', 'replace'] as const)('accepts %s and distinguishes empty replacement', async operation => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: 0, unchangedCount: 1 }, meta: {} }))))
    expect(await batchTagShortLinks({ ...input, operation, tags: operation === 'replace' ? [] : ['A'] }, 'own')).toEqual({ changedCount: 0, unchangedCount: 1 })
  })
  it('accepts exactly 100 distinct versions and rejects 101 without issuing a write', async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ ...item, id: `00000000-0000-0000-0000-${(index + 1).toString().padStart(12, '0')}` }))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: 100, unchangedCount: 0 }, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    expect(await batchTagShortLinks({ ...input, items }, 'own')).toEqual({ changedCount: 100, unchangedCount: 0 })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).items).toHaveLength(100)
    await expect(batchTagShortLinks({ ...input, items: [...items, { ...item, id: '00000000-0000-0000-0000-000000000101' }] }, 'own')).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([
    { tags: [] }, { tags: null }, { tags: undefined }, { tags: [' A', 'A '] }, { tags: [''] }, { tags: ['x'.repeat(33)] }, { tags: ['a\u0000b'] }, { tags: ['\ud800'] },
    { items: [] }, { items: [item, item] }, { items: [{ ...item, expectedUpdatedAt: '0001-01-01T00:00:00Z' }] }, { items: [{ ...item, id: '00000000-0000-0000-0000-000000000000' }] },
    { operation: 'invalid' }, { extra: true },
  ])('rejects invalid request %j before fetching', async invalid => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(batchTagShortLinks({ ...input, ...invalid } as never, 'own')).rejects.toMatchObject({ code: 100001 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{ changedCount: -1, unchangedCount: 2 }, { changedCount: 0.5, unchangedCount: 0.5 }, { changedCount: 1, unchangedCount: 1 }, { changedCount: 1 }, { changedCount: 1, unchangedCount: 0, extra: true }])('rejects invalid counts %j', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))))
    await expect(batchTagShortLinks(input, 'own')).rejects.toMatchObject({ code: 100001 })
  })
})
