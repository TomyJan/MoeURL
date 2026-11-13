import { afterEach, describe, expect, it, vi } from 'vitest'

import { futureDateTimeErrorKey, futureDateTimeSchema, passwordSchema, targetUrlSchema } from './shortLinkAccess'

describe('short-link access validation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('trims valid target URLs and rejects invalid targets', () => {
    expect(targetUrlSchema.parse(' https://example.com/docs ')).toBe('https://example.com/docs')
    expect(targetUrlSchema.safeParse('not a URL').success).toBe(false)
    expect(targetUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })

  it.each([
    'https://192.0.2.1/historical',
    'http://203.0.113.20:8080/path?next=example.com#fragment',
    'https://[2001:0DB8:0:0::1]:443/path?x=1',
    'https://[::ffff:192.0.2.1]/path',
    'https://[::ffff:c000:201]/path',
  ])('accepts an HTTP IP target without rewriting its bytes: %s', (target) => {
    expect(targetUrlSchema.parse(' ' + target + ' ')).toBe(target)
  })

  it.each([
    'https://localhost/path',
    'https://single-label/path',
    'https://[2001:db8::gg]/path',
    'https://999.0.2.1/path',
    'ftp://192.0.2.1/path',
    'file:///tmp/example',
    'data:text/plain,example',
  ])('preserves existing hostname and protocol rejection: %s', (target) => {
    expect(targetUrlSchema.safeParse(target).success).toBe(false)
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

  it('validates protected short-link passwords by Unicode length', () => {
    expect(passwordSchema.safeParse('1234567').success).toBe(false)
    expect(passwordSchema.safeParse('12345678').success).toBe(true)
    expect(passwordSchema.safeParse('密码安全长度八位').success).toBe(true)
    expect(passwordSchema.safeParse('🔒'.repeat(7)).success).toBe(false)
    expect(passwordSchema.safeParse('🔒'.repeat(8)).success).toBe(true)
    expect(passwordSchema.safeParse('🔒'.repeat(128)).success).toBe(true)
    expect(passwordSchema.safeParse('🔒'.repeat(129)).success).toBe(false)
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false)
    expect(passwordSchema.safeParse('a'.repeat(513)).success).toBe(false)
	})
})
