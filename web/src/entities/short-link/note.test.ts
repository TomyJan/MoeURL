import { afterEach, describe, expect, it, vi } from 'vitest'
import { readOwnNote, readAdminNote, updateOwnNote, updateAdminNote, noteVersionSchema } from './note'

const id = '00000000-0000-0000-0000-000000000020', user = '00000000-0000-0000-0000-000000000001'
const version = '2026-11-03T00:00:00.123456789Z'
const data = { id, note: 'private', updatedAt: version }
/** Controls the wire response while exercising the real API client and strict entity validation. */
function respond(value: unknown = data) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: value, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
describe('fixed note endpoint contracts', () => {
  it.each(['own', 'admin'] as const)('reads and writes exact %s endpoints, actor and full independent version', async context => {
    const fetcher = respond()
    const read = context === 'own' ? readOwnNote : readAdminNote, write = context === 'own' ? updateOwnNote : updateAdminNote
    expect(await read(id, user)).toEqual(data)
    expect(await write({ id, note: ' private\r\ntext ', expectedUpdatedAt: version }, user)).toEqual(data)
    const prefix = `/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note`
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([`${prefix}?id=${id}`, `${prefix}/update`])
    expect(fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-MoeURL-Expected-User-ID'))).toEqual([user, user])
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual({ id, note: 'private\ntext', expectedUpdatedAt: version })
  })
  it.each(['', '00000000-0000-0000-0000-000000000000', id.toUpperCase().replace('20', 'AF'), 'bad'])('rejects invalid actor or resource %j before HTTP', async invalid => {
    const fetcher = respond()
    await expect(readOwnNote(invalid, user)).rejects.toMatchObject({ code: 100001 })
    await expect(readOwnNote(id, invalid)).rejects.toMatchObject({ code: 100001 })
    await expect(updateOwnNote({ id: invalid, note: 'x', expectedUpdatedAt: version }, user)).rejects.toMatchObject({ code: 100001 })
    await expect(updateAdminNote({ id, note: 'x', expectedUpdatedAt: version }, invalid)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '0001-01-01T01:00:00+01:00', '2026-02-30T00:00:00Z', '2026-11-03T00:00:00.1234567891Z', 'invalid'])('rejects invalid or zero version %s', async expectedUpdatedAt => {
    const fetcher = respond()
    expect(noteVersionSchema.safeParse(expectedUpdatedAt).success).toBe(false)
    await expect(updateOwnNote({ id, note: 'x', expectedUpdatedAt }, user)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('retains the smallest nonzero note version instead of rounding it to milliseconds', async () => {
    const value = { ...data, updatedAt: '0001-01-01T00:00:00.000000001Z' }
    respond(value)
    expect(await readOwnNote(id, user)).toEqual(value)
  })
  it.each([null, { ...data, id: user }, { ...data, extra: 'x' }, { id, note: 'private' }, { ...data, note: ' bad ' }, { ...data, note: '\ud800' }, { ...data, updatedAt: 'bad' }])('rejects malformed read and write success as unconfirmed (%j)', async invalid => {
    respond(invalid)
    await expect(readOwnNote(id, user)).rejects.toMatchObject({ meta: { invalidNoteResponse: true } })
    await expect(updateOwnNote({ id, note: 'x', expectedUpdatedAt: version }, user)).rejects.toMatchObject({ meta: { invalidNoteResponse: true } })
  })
})
