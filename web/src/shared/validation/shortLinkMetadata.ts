import { z } from 'zod'

// Go unicode.IsSpace deliberately includes NEL and excludes BOM, unlike String.trim().
const goSpaceEdges = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu

/** Trims the same Unicode whitespace as the server's strings.TrimSpace. */
export function trimGoSpace(value: string): string {
  return value.replace(goSpaceEdges, '')
}

/** Normalizes edge whitespace and bounds plain text by Unicode code points. */
function plainTextSchema(maximum: number, message: string) {
  return z.string().transform(trimGoSpace).refine((value) => [...value].length <= maximum && !/\p{Cc}/u.test(value), message)
}

const titleSchema = plainTextSchema(120, 'linkMetadata.titleInvalid')
const tagSchema = plainTextSchema(32, 'linkMetadata.tagsInvalid').refine((value) => value.length > 0, 'linkMetadata.tagsInvalid')

export const shortLinkMetadataSchema = z.strictObject({
  title: titleSchema,
  tags: z.array(tagSchema).max(10, 'linkMetadata.tagsInvalid')
    .refine((tags) => new Set(tags).size === tags.length, 'linkMetadata.tagsInvalid'),
})

export const metadataDraftSchema = z.object({ title: z.string(), tagsText: z.string() })
  .transform(({ title, tagsText }) => ({ title, tags: trimGoSpace(tagsText) === '' ? [] : tagsText.split(/\r?\n/) }))
  .pipe(shortLinkMetadataSchema)

export const shortLinkKeywordSchema = plainTextSchema(200, 'linkMetadata.keywordInvalid')
export const shortLinkTagFilterSchema = plainTextSchema(32, 'linkMetadata.tagFilterInvalid')
