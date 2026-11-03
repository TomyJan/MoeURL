import { z } from 'zod'
import { trimGoSpace } from './shortLinkMetadata'

/** Rejects controls and malformed scalar text before Go-compatible trimming. */
export const noteQuerySchema = z.string()
  .refine(value => !/[\uD800-\uDFFF]/u.test(value) && !/\p{Cc}/u.test(value), 'linkMetadata.noteQueryInvalid')
  .transform(trimGoSpace)
  .refine(value => [...value].length <= 100, 'linkMetadata.noteQueryInvalid')
