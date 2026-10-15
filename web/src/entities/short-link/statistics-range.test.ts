import { describe, expect, it } from 'vitest'
import { statisticsDateRangeSchema } from './schema'

describe('statistics date range schema', () => {
  it.each([
    ['2026-10-15', '2026-10-15'],
    ['2026-07-18', '2026-10-15'],
    ['2024-02-29', '2024-03-01'],
    ['2025-12-31', '2026-01-01'],
  ])('accepts calendar boundaries and inclusive 1–90 day ranges: %s to %s', (startDate, endDate) => {
    expect(statisticsDateRangeSchema.safeParse({ startDate, endDate }).success).toBe(true)
  })
  it.each([
    ['2026-07-17', '2026-10-15'],
    ['2026-10-15', '2026-10-14'],
    ['2026-02-29', '2026-03-01'],
    ['2026-2-01', '2026-02-02'],
    ['2026-01-01T00:00:00Z', '2026-01-02'],
    ['', ''],
  ])('rejects invalid calendar dates and out-of-bounds ranges: %s to %s', (startDate, endDate) => {
    expect(statisticsDateRangeSchema.safeParse({ startDate, endDate }).success).toBe(false)
  })
})
