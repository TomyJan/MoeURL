import { afterEach, expect, it, vi } from 'vitest'
import { batchChangeUserGroup, type BatchChangeUserGroupInput } from './batch-group'
import { ApiClientError } from '@/shared/api/client'

const input: BatchChangeUserGroupInput = { items: [{ id: '22222222-2222-4222-8222-222222222222', expectedUpdatedAt: '2026-10-28T01:02:03.123456Z' }, { id: '33333333-3333-4333-8333-333333333333', expectedUpdatedAt: '2026-10-28T01:02:04.654321Z' }], groupKey: 'admin' }
afterEach(() => vi.unstubAllGlobals())

it('posts the original two-account snapshot and returns only verified committed counts', async () => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('/api/v1/admin/user/batch-change-group')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body as string)).toEqual(input)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: 1, unchangedCount: 1 }, meta: {} }))
  })
  await expect(batchChangeUserGroup(input)).resolves.toEqual({ changedCount: 1, unchangedCount: 1 })
})

it.each([
  null, {}, { changedCount: 2 }, { changedCount: -1, unchangedCount: 3 }, { changedCount: 0.5, unchangedCount: 1.5 },
  { changedCount: '2', unchangedCount: 0 }, { changedCount: 1, unchangedCount: 0 }, { changedCount: 3, unchangedCount: 0 },
  { changedCount: 2, unchangedCount: 0, user: 'private-response-data' },
])('rejects malformed or mismatched batch result %j without leaking response data', async (data) => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} })))
  await expect(batchChangeUserGroup(input)).rejects.toMatchObject({ code: 100001, message: 'Invalid batch membership response' })
})

it('preserves the business failure category and does not retry the write', async () => {
  let calls = 0
  vi.stubGlobal('fetch', async () => { calls++; return new Response(JSON.stringify({ code: 300105, message: 'User changed', data: null, meta: {} })) })
  await expect(batchChangeUserGroup(input)).rejects.toBeInstanceOf(ApiClientError)
  expect(calls).toBe(1)
})
