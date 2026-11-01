import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatInstant } from './date-time'

afterEach(() => vi.restoreAllMocks())
describe('display-only instant formatter', () => {
  it.each([
    ['2026-01-01T00:30:00Z', 'America/New_York', 'Dec 31, 2025, 19:30'],
    ['2026-01-15T12:00:00Z', 'Europe/London', 'Jan 15, 2026, 12:00'],
    ['2026-07-15T12:00:00Z', 'Europe/London', 'Jul 15, 2026, 13:00'],
    ['2026-01-15T12:00:00Z', 'America/New_York', 'Jan 15, 2026, 07:00'],
    ['2026-07-15T12:00:00Z', 'America/New_York', 'Jul 15, 2026, 08:00'],
    ['2026-01-15T12:00:00Z', 'Australia/Sydney', 'Jan 15, 2026, 23:00'],
    ['2026-07-15T12:00:00Z', 'Australia/Sydney', 'Jul 15, 2026, 22:00'],
  ])('formats %s in %s as a literal local date and time', (instant, zone, expected) => {
    expect(formatInstant(instant!, 'en-US', zone!, 'dateTime')).toBe(expected)
  })
  it('formats a local calendar date without changing the original instant', () => {
    const source = '2026-01-01T00:30:00.123456789Z'
    expect(formatInstant(source, 'en-US', 'America/New_York', 'date')).toBe('Dec 31, 2025')
    expect(source).toBe('2026-01-01T00:30:00.123456789Z')
    expect(formatInstant(source, 'zh-CN', 'America/New_York', 'dateTime')).toBe('2025年12月31日 19:30')
  })
  it.each(['', 'invalid', '2026-01-01', '2026-02-30T00:00:00Z', '2026-01-01T25:00:00Z', '2026-01-01T00:00:00'])('does not interpret invalid or date-only protocol data as an instant: %s', value => {
    expect(formatInstant(value, 'en-US', 'UTC', 'dateTime')).toBeNull()
  })
  it('uses the device timezone for null and safely falls back for an unsupported zone', () => {
    const instant = '2026-01-01T00:30:00Z'
    const device = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(instant))
    expect(formatInstant(instant, 'en-US', null, 'dateTime')).toBe(device)
    expect(formatInstant(instant, 'en-US', 'No/Such_Zone', 'dateTime')).toBe(device)
  })
  it('returns a safe null when even device formatting is unavailable', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () { throw new RangeError('unsupported Intl') })
    expect(formatInstant('2026-01-01T00:30:00Z', 'en-US', 'UTC', 'dateTime')).toBeNull()
    expect(formatInstant('2026-01-01T00:30:00Z', 'en-US', null, 'dateTime')).toBeNull()
  })
})
