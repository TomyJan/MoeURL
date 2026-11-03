import { afterEach, describe, expect, it, vi } from 'vitest'
import { searchOwnNotes, searchAdminNotes, type NoteSearchInput } from './note-search'
import { exportShortLinkList } from './list-export'
import { noteQuerySchema } from '@/shared/validation/noteSearch'

const actor = '00000000-0000-0000-0000-000000000001'
const input: NoteSearchInput = { page: 1, pageSize: 20, status: '', q: '', tag: '', noteStatus: '', noteQuery: 'private' }
const csv = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
/** Replaces only HTTP, preserving the actual strict client and JSON serialization. */
function respond(data: unknown = { items: [] }, meta: unknown = { page: 1, pageSize: 20, total: 0 }, code = 0) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code, message: 'private', data, meta })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())

describe('note search protocol', () => {
  // Widening normalization to trim before rejecting controls changes which private words are submitted.
  it.each([
    [' \u2003词\u00a0 ', '词'], ['😀'.repeat(100), '😀'.repeat(100)], ['\uFEFF词\uFEFF', '\uFEFF词\uFEFF'], ['', ''], ['\u3000', ''], ['e\u0301', 'e\u0301'],
  ])('normalizes valid scalar text %#', (raw, expected) => { expect(noteQuerySchema.parse(raw)).toBe(expected) })
  it.each(['\tterm', '\nterm', 'term\r', '\u0085term', 'term\u0000', '\u007f', '\u009f', '\uD800', '\uDFFF', '😀'.repeat(101)])('rejects invalid private text %#', value => {
    expect(noteQuerySchema.safeParse(value).success).toBe(false)
  })

  it.each([searchOwnNotes, searchAdminNotes])('submits all seven fields to a fixed URL %#', async search => {
    const fetcher = respond()
    await expect(search({ ...input, q: ' q ', tag: ' tag ', noteQuery: ' \u2003词 ' }, actor)).resolves.toEqual({ items: [], meta: { page: 1, pageSize: 20, total: 0 } })
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(search === searchOwnNotes ? '/api/v1/short-link/note/search' : '/api/v1/admin/short-link/note/search')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'X-MoeURL-Expected-User-ID': actor } })
    expect(JSON.parse(init!.body as string)).toEqual({ page: 1, pageSize: 20, status: '', q: 'q', tag: 'tag', noteStatus: '', noteQuery: '词' })
  })
  it.each([
    { page: 0 }, { page: 1.5 }, { page: 2147483648 }, { page: 2147483647 }, { pageSize: 0 }, { pageSize: 101 },
    { page: '1' }, { status: 'other' }, { noteStatus: 'unknown' }, { noteQuery: null }, { noteQuery: 'x'.repeat(101) },
    { noteQuery: '\tterm' }, { q: 'x'.repeat(201) }, { tag: 'x'.repeat(33) }, { extra: true },
  ])('rejects invalid requests before HTTP %#', async patch => {
    const fetcher = respond()
    await expect(searchOwnNotes({ ...input, ...patch } as NoteSearchInput, actor)).rejects.toMatchObject({ code: 100001, message: 'Invalid note search request' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('accepts the old positive int32 page with a separately bounded offset', async () => {
    respond({ items: [] }, { page: 2147483647, pageSize: 1, total: 0 })
    await expect(searchOwnNotes({ ...input, page: 2147483647, pageSize: 1 }, actor)).resolves.toMatchObject({ meta: { page: 2147483647 } })
  })
  it.each(['', 'A', '00000000-0000-0000-0000-000000000000'])('rejects invalid captured actor %s', async actor => {
    const fetcher = respond()
    await expect(searchOwnNotes(input, actor)).rejects.toMatchObject({ code: 100001, message: 'Invalid note search actor' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    [null, { page: 1, pageSize: 20, total: 0 }], [{ items: [], note: 'private' }, { page: 1, pageSize: 20, total: 0 }],
    [{ items: [{ note: 'private' }] }, { page: 1, pageSize: 20, total: 0 }], [{ items: [] }, {}],
    [{ items: [] }, { page: '1', pageSize: 20, total: 0 }], [{ items: [] }, { page: 2, pageSize: 20, total: 0 }],
    [{ items: [] }, { page: 1, pageSize: 1, total: 0 }], [{ items: [] }, { page: 1, pageSize: 20, total: -1 }],
    [{ items: [] }, { page: 1, pageSize: 20, total: 1.5 }], [{ items: [] }, { page: 1, pageSize: 20, total: 0, noteQuery: 'private' }],
  ])('rejects malformed items or independent pagination metadata %#', async (data, meta) => {
    respond(data, meta)
    await expect(searchOwnNotes(input, actor)).rejects.toMatchObject({ code: 100001, message: 'Invalid note search response' })
  })
  it.each([120001, 100001, 900000])('preserves business failure %s without retrying', async code => {
    const fetcher = respond(null, {}, code)
    await expect(searchOwnNotes(input, actor)).rejects.toMatchObject({ code })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['own', 'admin'] as const)('exports five normalized filters without pagination in %s', async context => {
    const file = { fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: csv }
    const fetcher = respond(file, {})
    await expect(exportShortLinkList({ noteQuery: ' \u2003词 ' }, context, actor)).resolves.toEqual(file)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note/search/export`)
    expect(init).toMatchObject({ method: 'POST', headers: { 'X-MoeURL-Expected-User-ID': actor } })
    expect(JSON.parse(init!.body as string)).toEqual({ status: '', q: '', tag: '', noteStatus: '', noteQuery: '词' })
  })
  it('uses old GET when a provided private draft normalizes empty', async () => {
    const fetcher = respond({ fileName: 'moeurl-links-own.csv', contentType: 'text/csv;charset=utf-8', content: csv }, {})
    await exportShortLinkList({ noteQuery: ' \u2003 ', q: 'metadata' }, 'own')
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/short-link/export?q=metadata')
  })
  it('rejects an invalid private export draft or missing actor before HTTP', async () => {
    const fetcher = respond()
    await expect(exportShortLinkList({ noteQuery: '\tterm' }, 'own', actor)).rejects.toMatchObject({ code: 100001 })
    await expect(exportShortLinkList({ noteQuery: 'term' }, 'own')).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
