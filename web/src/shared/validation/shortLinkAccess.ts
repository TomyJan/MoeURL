import { z } from 'zod'

// Check literal IP spelling before URL parsing can normalize aliases; retain URL bytes.
export const targetUrlSchema = z.string().trim().pipe(z.union([
  z.httpUrl(),
  z.string()
    .regex(/^https?:\/\/(?:[^/?#@\\]*@)?(?:(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}|\[[\da-f:.]+\])(?::\d+)?(?:[/?#]|$)/i)
    .pipe(z.url({ protocol: /^https?$/, hostname: /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[\da-f:]+\])$/i })),
]))

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
