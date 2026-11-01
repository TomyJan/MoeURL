import { z } from 'zod'

const instantSchema = z.iso.datetime({ offset: true })

/** A recognized saved choice can still be unavailable in the browser's Intl data. */
export function supportsTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return true
  } catch {
    return false
  }
}

/** Display only: never normalize or write the protocol value back to a caller. */
export function formatInstant(value: string, locale: string, timeZone: string | null, style: 'date' | 'dateTime'): string | null {
  if (!instantSchema.safeParse(value).success) return null
  const date = new Date(value)
  const options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }
  if (style === 'dateTime') Object.assign(options, { timeStyle: 'short', hourCycle: 'h23' })
  try {
    return new Intl.DateTimeFormat(locale, { ...options, ...(timeZone ? { timeZone } : {}) }).format(date)
  } catch {
    if (!timeZone) return null
    try {
      return new Intl.DateTimeFormat(locale, options).format(date)
    } catch {
      return null
    }
  }
}
