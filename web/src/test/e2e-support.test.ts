import { describe, expect, it, vi } from 'vitest'

import { findShortLink } from '../../e2e/support'

vi.mock('@playwright/test', () => ({
  expect: (actual: unknown) => ({
    toBe: (expected: unknown) => {
      if (actual !== expected) {
        throw new Error(`expected ${String(actual)} to be ${String(expected)}`)
      }
    },
    toBeNull: () => {
      if (actual !== null) {
        throw new Error(`expected ${String(actual)} to be null`)
      }
    },
    toBeGreaterThanOrEqual: (expected: number) => {
      if (typeof actual !== 'number' || !(actual >= expected)) {
        throw new Error(`expected ${String(actual)} to be greater than or equal to ${expected}`)
      }
    },
    toBeLessThanOrEqual: (expected: number) => {
      if (typeof actual !== 'number' || !(actual <= expected)) {
        throw new Error(`expected ${String(actual)} to be less than or equal to ${expected}`)
      }
    },
    toBeOK: vi.fn(),
  }),
}))

describe('E2E support', () => {
  it('stops pagination when the API returns an empty page', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          code: 0,
          data: { items: [] },
          meta: { page: 1, pageSize: 100, total: 1_000 },
        }),
      })
      .mockRejectedValueOnce(new Error('unexpected second page request'))

    const result = await findShortLink({ request: { get } } as never, 'missing')

    expect(result).toBeUndefined()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('stops pagination when the non-empty page reaches the reported total', async () => {
    const get = vi.fn().mockResolvedValueOnce({
      json: vi.fn().mockResolvedValue({
        code: 0,
        data: { items: [{ id: 'link-1', passwordEnabled: false, slug: 'other' }] },
        meta: { page: 1, pageSize: 100, total: 1 },
      }),
    })

    const result = await findShortLink({ request: { get } } as never, 'missing')

    expect(result).toBeUndefined()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('finds a short link on a later page', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          code: 0,
          data: { items: [{ id: 'link-1', passwordEnabled: false, slug: 'other' }] },
          meta: { page: 1, pageSize: 100, total: 200 },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          code: 0,
          data: { items: [{ id: 'link-2', passwordEnabled: true, slug: 'target' }] },
          meta: { page: 2, pageSize: 100, total: 200 },
        }),
      })

    const result = await findShortLink({ request: { get } } as never, 'target')

    expect(result).toEqual({ id: 'link-2', passwordEnabled: true, slug: 'target' })
    expect(get).toHaveBeenCalledTimes(2)
  })
})
