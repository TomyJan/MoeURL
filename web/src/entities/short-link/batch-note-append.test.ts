import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { previewOwnNoteAppend, previewAdminNoteAppend, appendOwnNotes, appendAdminNotes, type BatchNoteAppendPreviewInput, type BatchNoteAppendInput } from './batch-note-append'

const actor = '00000000-0000-0000-0000-000000000001', key = '00000000-0000-0000-0000-000000000099'
const items = [20, 21].map(id => ({ id: '00000000-0000-0000-0000-' + String(id).padStart(12, '0'), expectedUpdatedAt: '2026-11-09T00:00:00.123456789Z' }))
const input = () => ({ items: items.map(item => ({ ...item })), note: 'new' })
const preview = () => ({ items: items.map(item => ({ ...item, expectedNoteUpdatedAt: '2026-11-09T01:00:00.987654321Z' })), appendableCount: 2, overflowCount: 0 })
const writeInput = () => ({ requestId: key, items: preview().items, note: 'new' })
const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'private-canary', data, meta: { private: 'private-canary' } }), { status })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('strict batch note append client', () => {
  it.each(['fetch', 'body'] as const)('bounds an unacknowledged ' + '%s' + ' operation including response decoding without retry', async phase => {
    vi.useFakeTimers()
    const fetcher = vi.fn<typeof fetch>((_path, init) => {
      if (phase === 'fetch') return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('private-timeout')), { once: true }))
      const value = new Response('{}')
      value.text = () => new Promise<string>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('private-body-timeout')), { once: true }))
      return Promise.resolve(value)
    })
    vi.stubGlobal('fetch', fetcher)
    const result = appendOwnNotes(writeInput(), actor).catch((cause: unknown) => cause)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await result).toMatchObject({ code: 900000 }); expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true)
  })
  it.each(['own', 'admin'] as const)('pins normalized ordered targets, full versions and identity across both %s endpoints', async scope => {
    const read = scope === 'own' ? previewOwnNoteAppend : previewAdminNoteAppend, write = scope === 'own' ? appendOwnNotes : appendAdminNotes
    const value = preview(); value.items[0]!.expectedUpdatedAt = '2026-11-09T08:00:00.123456789+08:00'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(value)).mockResolvedValueOnce(response({ requestId: key, appendedCount: 2 }))
    vi.stubGlobal('fetch', fetcher)
    expect(await read({ ...input(), note: ' \r\nnew\t ' }, actor)).toEqual(value)
    expect(await write(writeInput(), actor)).toEqual({ requestId: key, appendedCount: 2 })
    const prefix = '/api/v1/' + (scope === 'admin' ? 'admin/' : '') + 'short-link/note/batch-append'
    expect(fetcher.mock.calls.map(([path]) => String(path))).toEqual([prefix + '/preview', prefix])
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(input())
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual(writeInput())
    for (const [, request] of fetcher.mock.calls) {
      expect(request!.method).toBe('POST'); expect(request!.credentials).toBe('include')
      expect(new Headers(request!.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor)
    }
  })
  it('rejects invalid input before dispatch, including missing or noncanonical request keys', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    for (const value of [{ ...input(), items: [] }, { ...input(), items: [items[0], items[0]] }, { ...input(), items: Array(101).fill(items[0]) }, { ...input(), note: '' }, { ...input(), note: ' \n\t' }, { ...input(), note: '\u0085new' }, { ...input(), note: '\rnew' }, { ...input(), note: '\ud800' }, { ...input(), note: '😀'.repeat(1001) }, { ...input(), extra: true }, { ...input(), items: [{ ...items[0], id: 'bad' }] }, { ...input(), items: [{ ...items[0], expectedUpdatedAt: 'bad' }] }]) {
      await expect(previewOwnNoteAppend(value as BatchNoteAppendPreviewInput, actor)).rejects.toBeInstanceOf(ApiClientError)
      await expect(appendAdminNotes(value as unknown as BatchNoteAppendInput, actor)).rejects.toBeInstanceOf(ApiClientError)
    }
    for (const requestId of ['', 'bad', '00000000-0000-0000-0000-000000000000', key.toUpperCase().replace('99', 'AA')]) await expect(appendOwnNotes({ ...writeInput(), requestId }, actor)).rejects.toBeInstanceOf(ApiClientError)
    await expect(appendOwnNotes({ ...writeInput(), items: [{ ...preview().items[0]!, expectedNoteUpdatedAt: 'bad' }] }, actor)).rejects.toBeInstanceOf(ApiClientError)
    await expect(previewAdminNoteAppend(input(), 'bad')).rejects.toBeInstanceOf(ApiClientError)
    await expect(appendOwnNotes(writeInput(), 'bad')).rejects.toBeInstanceOf(ApiClientError)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['\ufeff', '😀'.repeat(1000)])('preserves Unicode scalar text at the exact limit without UTF-16 truncation', async note => {
    const fetcher = vi.fn<typeof fetch>(async () => response(preview())); vi.stubGlobal('fetch', fetcher)
    await previewOwnNoteAppend({ ...input(), note }, actor)
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).note).toBe(note)
  })
  it('accepts exactly 100 unique items and an aggregate overflow without leaking old note lengths', async () => {
    const targets = Array.from({ length: 100 }, (_, i) => ({ ...items[0]!, id: '00000000-0000-0000-0000-' + String(i + 100).padStart(12, '0') }))
    vi.stubGlobal('fetch', vi.fn(async () => response({ items: targets.map(item => ({ ...item, expectedNoteUpdatedAt: preview().items[0]!.expectedNoteUpdatedAt })), appendableCount: 99, overflowCount: 1 })))
    expect((await previewOwnNoteAppend({ items: targets, note: 'new' }, actor)).overflowCount).toBe(1)
  })
  it('rejects partial targets, 1ns drift, private fields and inconsistent aggregate counts', async () => {
    const p = preview()
    for (const value of [null, { ...p, note: 'private-canary' }, { ...p, items: [] }, { ...p, items: [p.items[0], p.items[0]] }, { ...p, items: [...p.items].reverse() }, { ...p, items: [{ ...p.items[0], oldLength: 1 }, p.items[1]] }, { ...p, items: [{ ...p.items[0], id: actor }, p.items[1]] }, { ...p, items: [{ ...p.items[0], expectedUpdatedAt: '2026-11-09T00:00:00.123456788Z' }, p.items[1]] }, { ...p, items: [{ ...p.items[0], expectedNoteUpdatedAt: 'bad' }, p.items[1]] }, { ...p, appendableCount: 1 }, { ...p, overflowCount: -1 }, { ...p, appendableCount: 1.5 }, { ...p, appendableCount: 101 }]) {
      vi.stubGlobal('fetch', vi.fn(async () => response(value)))
      const cause: unknown = await previewOwnNoteAppend(input(), actor).catch((error: unknown) => error)
      expect(cause).toMatchObject({ code: 100001, meta: { invalidBatchNoteResponse: true } })
      expect(String(cause)).not.toContain('private-canary'); expect(JSON.stringify(cause)).not.toContain('private-canary')
    }
  })
  it('requires the original request key and all items in a successful acknowledgment', async () => {
    for (const data of [null, {}, { requestId: actor, appendedCount: 2 }, { requestId: key, appendedCount: 1 }, { requestId: key, appendedCount: -1 }, { requestId: key, appendedCount: 2.5 }, { requestId: key, appendedCount: 101 }, { requestId: key, appendedCount: 2, note: 'private-canary' }]) {
      vi.stubGlobal('fetch', vi.fn(async () => response(data)))
      await expect(appendAdminNotes(writeInput(), actor)).rejects.toMatchObject({ code: 100001, meta: { invalidBatchNoteResponse: true } })
    }
  })
  it.each(['business', 'http500', 'transport'] as const)('strips private %s errors and never retries automatically', async kind => {
    const fetcher = vi.fn(async () => { if (kind === 'transport') throw new Error('private-canary'); return response(null, kind === 'business' ? 200120 : 0, kind === 'http500' ? 500 : 200) })
    vi.stubGlobal('fetch', fetcher)
    const cause: unknown = await appendOwnNotes(writeInput(), actor).catch((error: unknown) => error)
    expect(cause).toMatchObject({ code: kind === 'business' ? 200120 : kind === 'http500' ? 500 : 900000 })
    expect(JSON.stringify(cause)).not.toContain('private-canary'); expect(String(cause)).not.toContain('private-canary'); expect(fetcher).toHaveBeenCalledOnce()
  })
})
