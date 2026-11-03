import { z } from 'zod'
import { trimGoSpace } from './shortLinkMetadata'

/** Validates scalar text before trimming, preserving BOM and counting code points. */
export const shortLinkNoteSchema = z.string()
  .refine(value => !/[\uD800-\uDFFF]/u.test(value), 'linkNote.invalid')
  .transform(value => value.replace(/\r\n/g, '\n'))
  .refine(value => ![...value].some(char => /\p{Cc}/u.test(char) && char !== '\n' && char !== '\t'), 'linkNote.invalid')
  .transform(trimGoSpace)
  .refine(value => [...value].length <= 1000, 'linkNote.invalid')
