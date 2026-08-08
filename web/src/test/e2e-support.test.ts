import { describe, expect, it, vi } from 'vitest'

import { findShortLink } from '../../e2e/support'

vi.mock('@playwright/test', () => ({
  expect: (actual: unknown) => ({
    toBe: (expected: unknown) => {
      if (actual !== expected) {
        throw new Error(`expected ${String(actual)} to be ${String(expected)}`)
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
})
