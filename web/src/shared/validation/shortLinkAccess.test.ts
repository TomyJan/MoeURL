import { afterEach, describe, expect, it, vi } from 'vitest'

import { futureDateTimeErrorKey, futureDateTimeSchema, targetUrlSchema } from './shortLinkAccess'

describe('short-link access validation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('trims valid target URLs and rejects invalid targets', () => {
    expect(targetUrlSchema.parse(' https://example.com/docs ')).toBe('https://example.com/docs')
    expect(targetUrlSchema.safeParse('not a URL').success).toBe(false)
    expect(targetUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })

  it('accepts only non-empty date-times in the future', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-03T00:00:00Z'))

    expect(futureDateTimeSchema.safeParse('2026-08-03T01:00:00Z').success).toBe(true)
    const pastResult = futureDateTimeSchema.safeParse('2026-08-02T23:00:00Z')
    expect(pastResult.success).toBe(false)
    if (!pastResult.success) {
      expect(pastResult.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ message: futureDateTimeErrorKey })]),
      )
    }
    expect(futureDateTimeSchema.safeParse('not-a-date').success).toBe(false)
    expect(futureDateTimeSchema.safeParse('').success).toBe(false)
  })
})
