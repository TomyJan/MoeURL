import { z } from 'zod'

export const targetUrlSchema = z.string().trim().pipe(z.httpUrl())

export const passwordSchema = z.string().refine(
  (value) => {
    if (value.length > 512) {
      return false
    }
    const length = Array.from(value).length
    return length >= 8 && length <= 128
  },
  { error: 'validation.passwordLength' },
)

export const futureDateTimeErrorKey = 'validation.futureDateTime'

export const futureDateTimeSchema = z.string().trim().min(1).refine(
  (value) => {
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) && timestamp > Date.now()
  },
  { error: futureDateTimeErrorKey },
)
