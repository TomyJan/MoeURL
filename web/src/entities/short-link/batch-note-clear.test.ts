import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearAdminNotes, clearOwnNotes, previewAdminNoteClear, previewOwnNoteClear, sameNoteInstant } from './batch-note-clear'
import { ApiClientError } from '@/shared/api/client'

const actor = '00000000-0000-0000-0000-000000000001'
const id = '00000000-0000-0000-0000-000000000020'
const other = '00000000-0000-0000-0000-000000000021'
const version = '2026-11-04T06:00:00.123456Z', noteVersion = '2026-11-04T07:00:00.123456789Z'
const item = { id, expectedUpdatedAt: version }, clearItem = { ...item, expectedNoteUpdatedAt: noteVersion }
const preview = { items: [{ ...clearItem, hasNote: true }], nonemptyCount: 1, emptyCount: 0 }
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('strict batch note clear API', () => {
  it.each([
    [previewOwnNoteClear, '/short-link/note/batch-clear/preview', { items: [item] }, preview],
    [previewAdminNoteClear, '/admin/short-link/note/batch-clear/preview', { items: [item] }, preview],
    [clearOwnNotes, '/short-link/note/batch-clear', { items: [clearItem] }, { changedCount: 1, unchangedCount: 0 }],
    [clearAdminNotes, '/admin/short-link/note/batch-clear', { items: [clearItem] }, { changedCount: 1, unchangedCount: 0 }],
  ] as const)('pins a fixed endpoint and expected actor %s', async (run, path, input, output) => {
    const fetcher = vi.fn().mockResolvedValue(response(output)); vi.stubGlobal('fetch', fetcher)
    expect(await run(input as never, actor)).toEqual(output)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/v1' + path); expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(new Headers(init.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor)
    expect(JSON.parse(init.body)).toEqual(input)
  })
  it.each([
    [], Array.from({ length: 101 }, () => item), [item, item], [{ ...item, id: id.toUpperCase().replace('020', 'ABC') }],
    [{ ...item, id: '00000000-0000-0000-0000-000000000000' }], [{ ...item, expectedUpdatedAt: version.replace('123456', '1234567890') }],
    [{ ...item, expectedUpdatedAt: null }], [{ ...item, note: 'PRIVATE' }], [{ id }],
  ].map(items => ({ items })))('rejects invalid preview items before HTTP %#', async ({ items }) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(previewOwnNoteClear({ items } as never, actor)).rejects.toBeInstanceOf(ApiClientError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects invalid actors and extra top-level fields without dispatch', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(previewOwnNoteClear({ items: [item] }, 'guest')).rejects.toBeInstanceOf(ApiClientError)
    await expect(previewOwnNoteClear({ items: [item], note: 'PRIVATE' } as never, actor)).rejects.toBeInstanceOf(ApiClientError)
    await expect(clearOwnNotes({ items: [item] } as never, actor)).rejects.toBeInstanceOf(ApiClientError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('accepts 100 unique items and equivalent offset versions without losing the request strings', async () => {
    const items = Array.from({ length: 100 }, (_, index) => ({ id: `00000000-0000-0000-0000-${(index + 1).toString().padStart(12, '0')}`, expectedUpdatedAt: version }))
    const data = { items: items.map(value => ({ ...value, expectedUpdatedAt: '2026-11-04T14:00:00.123456000+08:00', expectedNoteUpdatedAt: noteVersion, hasNote: false })), nonemptyCount: 0, emptyCount: 100 }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
    expect(await previewAdminNoteClear({ items }, actor)).toEqual(data)
  })
  it.each([
    { ...preview, note: 'PRIVATE' }, { ...preview, items: [] }, { ...preview, items: [preview.items[0], preview.items[0]] },
    { ...preview, items: [{ ...preview.items[0], id: other }] },
    { ...preview, items: [{ ...preview.items[0], note: 'PRIVATE' }] },
    { ...preview, items: [{ ...preview.items[0], expectedUpdatedAt: '2026-11-04T06:00:00.123456001Z' }] },
    { ...preview, items: [{ ...preview.items[0], expectedNoteUpdatedAt: 'bad' }] },
    { ...preview, nonemptyCount: 0, emptyCount: 1 }, { ...preview, emptyCount: -1 }, { ...preview, nonemptyCount: 1.5 },
  ])('rejects malformed preview data without carrying its private body %#', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
    const error = await previewOwnNoteClear({ items: [item] }, actor).catch(error => error)
    expect(error).toBeInstanceOf(ApiClientError); expect(error.meta.invalidBatchNoteResponse).toBe(true)
    expect(JSON.stringify(error)).not.toContain('PRIVATE')
  })
  it('rejects reordered preview items even when every ID exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ items: [{ ...clearItem, id: other, hasNote: true }, { ...clearItem, hasNote: false }], nonemptyCount: 1, emptyCount: 1 })))
    await expect(previewOwnNoteClear({ items: [item, { ...item, id: other }] }, actor)).rejects.toBeInstanceOf(ApiClientError)
  })
  it.each([{ changedCount: 0, unchangedCount: 0 }, { changedCount: -1, unchangedCount: 2 }, { changedCount: 0.5, unchangedCount: 0.5 }, { changedCount: 1, unchangedCount: 0, note: 'PRIVATE' }, null])('rejects invalid clear counts %#', async data => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
    await expect(clearOwnNotes({ items: [clearItem] }, actor)).rejects.toMatchObject({ meta: { invalidBatchNoteResponse: true } })
  })
  it.each(['business', 'http', 'envelope', 'transport'] as const)('sanitizes %s failures without replaying them', async kind => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    if (kind === 'transport') fetcher.mockRejectedValue(new Error('PRIVATE'))
    else fetcher.mockResolvedValue(kind === 'envelope' ? new Response('PRIVATE') : new Response(JSON.stringify({ code: 200116, message: 'PRIVATE', data: null, meta: { note: 'PRIVATE' } }), { status: kind === 'http' ? 500 : 200 }))
    const error = await clearOwnNotes({ items: [clearItem] }, actor).catch(error => error)
    expect(error).toBeInstanceOf(ApiClientError)
    expect(JSON.stringify(error)).not.toContain('PRIVATE'); expect(error.message).not.toContain('PRIVATE')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('compares full instants, including one nanosecond and equivalent offsets', () => {
    expect(sameNoteInstant(version, '2026-11-04T14:00:00.123456000+08:00')).toBe(true)
    expect(sameNoteInstant(version, '2026-11-04T06:00:00.123456001Z')).toBe(false)
    expect(sameNoteInstant('bad', version)).toBe(false)
    expect(sameNoteInstant(version, 'bad')).toBe(false)
    expect(sameNoteInstant('2026-11-04T06:00:00Z', '2026-11-04T06:00:00.000000000Z')).toBe(true)
    expect(sameNoteInstant(version, '2026-11-04T06:00:01.123456Z')).toBe(false)
  })
})
