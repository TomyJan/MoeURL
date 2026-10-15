import { z } from 'zod'

/** Validates the raw ASCII address before normalizing case; whitespace is never trimmed. */
export const customSlugSchema = z.string().refine(
  (value) => value.length >= 3 && value.length <= 32 && !/[^A-Za-z0-9]/.test(value),
).transform((value) => value.toLowerCase())
