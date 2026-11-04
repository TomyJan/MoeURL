import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { previewOwnNoteReplace, previewAdminNoteReplace, replaceOwnNotes, replaceAdminNotes, type BatchNoteReplacePreviewInput, type BatchNoteReplaceInput } from './batch-note-replace'

const actor = '00000000-0000-0000-0000-000000000001'
const items = [20, 21].map(id => ({ id: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`, expectedUpdatedAt: '2026-11-05T00:00:00.123456789Z' }))
const input = () => ({ items: items.map(item => ({ ...item })), note: 'new' })
const preview = () => ({ items: items.map((item, index) => ({ ...item, expectedNoteUpdatedAt: '2026-11-05T01:00:00.987654321Z', willChange: index === 0 })), changedCount: 1, unchangedCount: 1 })
const writeInput = () => ({ items: preview().items.map(item => ({ id: item.id, expectedUpdatedAt: item.expectedUpdatedAt, expectedNoteUpdatedAt: item.expectedNoteUpdatedAt })), note: 'new' })
const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'private-response-canary', data, meta: { private: 'private-response-canary' } }), { status })
afterEach(() => vi.unstubAllGlobals())

describe('strict batch note replacement client', () => {
  it.each(['own', 'admin'] as const)('normalizes text, retains complete versions and binds the actor on all %s requests', async scope => {
    const read = scope === 'own' ? previewOwnNoteReplace : previewAdminNoteReplace
    const write = scope === 'own' ? replaceOwnNotes : replaceAdminNotes
    const value = preview(); value.items[0]!.expectedUpdatedAt = '2026-11-05T08:00:00.123456789+08:00'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(value)).mockResolvedValueOnce(response({ changedCount: 1, unchangedCount: 1 }))
    vi.stubGlobal('fetch', fetcher)
    expect(await read({ ...input(), note: ' \r\nnew\t ' }, actor)).toEqual(value)
    expect(await write(writeInput(), actor)).toEqual({ changedCount: 1, unchangedCount: 1 })
    const prefix = `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/note/batch-replace`
    expect(fetcher.mock.calls.map(([path]) => String(path))).toEqual([prefix + '/preview', prefix])
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(input())
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string)).toEqual(writeInput())
    for (const [, request] of fetcher.mock.calls) {
      expect(request!.method).toBe('POST'); expect(request!.credentials).toBe('include')
      expect(new Headers(request!.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor)
    }
  })
  it('rejects invalid collections and text before either network path', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const invalid: unknown[] = [
      { ...input(), items: [] }, { ...input(), items: [items[0], items[0]] }, { ...input(), items: Array.from({ length: 101 }, () => items[0]) },
      { ...input(), note: '' }, { ...input(), note: ' \n\t' }, { ...input(), note: '\u0085new' }, { ...input(), note: '\rnew' },
      { ...input(), note: '\ud800' }, { ...input(), note: '😀'.repeat(1001) }, { ...input(), extra: true },
      { ...input(), items: [{ ...items[0], id: 'bad' }] }, { ...input(), items: [{ ...items[0], expectedUpdatedAt: '2026-11-05T00:00:00.1234567891Z' }] },
    ]
    for (const value of invalid) {
      await expect(previewOwnNoteReplace(value as BatchNoteReplacePreviewInput, actor)).rejects.toBeInstanceOf(ApiClientError)
      await expect(replaceAdminNotes(value as BatchNoteReplaceInput, actor)).rejects.toBeInstanceOf(ApiClientError)
    }
    await expect(replaceOwnNotes({ ...writeInput(), items: [{ ...writeInput().items[0]!, expectedNoteUpdatedAt: 'bad' }] }, actor)).rejects.toBeInstanceOf(ApiClientError)
    await expect(previewAdminNoteReplace(input(), 'bad')).rejects.toMatchObject({ code: 100001 })
    await expect(replaceOwnNotes(writeInput(), 'bad')).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['\ufeff', '😀'.repeat(1000)])('accepts non-empty Unicode text without UTF-16 truncation', async note => {
    const fetcher = vi.fn<typeof fetch>(async () => response(preview())); vi.stubGlobal('fetch', fetcher)
    await previewOwnNoteReplace({ ...input(), note }, actor)
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).note).toBe(note)
  })
  it('accepts exactly 100 distinct targets and rejects 101', async () => {
    const targets = Array.from({ length: 100 }, (_, i) => ({ ...items[0]!, id: `00000000-0000-0000-0000-${String(i + 100).padStart(12, '0')}` }))
    const fetcher = vi.fn<typeof fetch>(async () => response({ items: targets.map(item => ({ ...item, expectedNoteUpdatedAt: preview().items[0]!.expectedNoteUpdatedAt, willChange: true })), changedCount: 100, unchangedCount: 0 }))
    vi.stubGlobal('fetch', fetcher)
    expect((await previewOwnNoteReplace({ items: targets, note: 'new' }, actor)).changedCount).toBe(100)
    await expect(previewOwnNoteReplace({ items: [...targets, { ...targets[0]!, id: actor }], note: 'new' }, actor)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects leaked text, mismatched targets, lossy revisions and inconsistent preview counts', async () => {
    const p = preview()
    const invalid: unknown[] = [
      null, { ...p, note: 'private-response-canary' }, { ...p, items: [] }, { ...p, items: [p.items[0], p.items[0]] }, { ...p, items: [...p.items].reverse() },
      { ...p, items: [{ ...p.items[0], note: 'private-response-canary' }, p.items[1]] },
      { ...p, items: [{ ...p.items[0], id: actor }, p.items[1]] },
      { ...p, items: [{ ...p.items[0], expectedUpdatedAt: '2026-11-05T00:00:00.123456788Z' }, p.items[1]] },
      { ...p, items: [{ ...p.items[0], expectedNoteUpdatedAt: 'bad' }, p.items[1]] },
      { ...p, items: [{ ...p.items[0], willChange: 1 }, p.items[1]] },
      { ...p, changedCount: 0, unchangedCount: 2 }, { ...p, changedCount: -1 }, { ...p, changedCount: 1.5 }, { ...p, unchangedCount: 0 },
    ]
    for (const value of invalid) {
      vi.stubGlobal('fetch', vi.fn(async () => response(value)))
      const cause: unknown = await previewOwnNoteReplace(input(), actor).catch((error: unknown) => error)
      expect(cause).toMatchObject({ code: 100001, meta: { invalidBatchNoteResponse: true } })
      expect(JSON.stringify(cause)).not.toContain('private-response-canary'); expect(String(cause)).not.toContain('private-response-canary')
    }
  })
  it('rejects partial, unbounded and extra-field write results', async () => {
    for (const data of [null, {}, { changedCount: 1, unchangedCount: 0 }, { changedCount: -1, unchangedCount: 3 }, { changedCount: 0.5, unchangedCount: 1.5 }, { changedCount: 101, unchangedCount: 0 }, { changedCount: 1, unchangedCount: 1, note: 'private-response-canary' }]) {
      const fetcher = vi.fn(async () => response(data)); vi.stubGlobal('fetch', fetcher)
      await expect(replaceAdminNotes(writeInput(), actor)).rejects.toMatchObject({ code: 100001, meta: { invalidBatchNoteResponse: true } })
      expect(fetcher).toHaveBeenCalledOnce()
    }
  })
  it.each(['business', 'HTTP500', 'transport'] as const)('strips private %s errors and sends no retry', async kind => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (kind === 'transport') throw new Error('private-response-canary')
      return response(null, kind === 'business' ? 200116 : 0, kind === 'HTTP500' ? 500 : 200)
    }); vi.stubGlobal('fetch', fetcher)
    const cause: unknown = await replaceOwnNotes(writeInput(), actor).catch((error: unknown) => error)
    expect(cause).toBeInstanceOf(ApiClientError); expect(JSON.stringify(cause)).not.toContain('private-response-canary'); expect(String(cause)).not.toContain('private-response-canary')
    expect(cause).toMatchObject({ code: kind === 'business' ? 200116 : kind === 'HTTP500' ? 500 : 900000, meta: kind === 'HTTP500' ? { status: 500 } : {} })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
