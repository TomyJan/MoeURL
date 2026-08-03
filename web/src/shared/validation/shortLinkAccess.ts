import { z } from 'zod'

export const targetUrlSchema = z.string().trim().pipe(z.url())

export const futureDateTimeSchema = z.string().trim().min(1).refine((value) => {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
})
