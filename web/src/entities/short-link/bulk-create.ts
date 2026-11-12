import { z } from 'zod'
import { apiPost, ApiClientError } from '@/shared/api/client'
import { targetUrlSchema } from '@/shared/validation/shortLinkAccess'
import { shortLinkMetadataSchema } from '@/shared/validation/shortLinkMetadata'

const requestId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000')
const target = z.string().min(1).max(2048).regex(/^[!-~]+$/).refine(value => targetUrlSchema.safeParse(value).success)
export const bulkCreateTargetsSchema = z.array(target).min(1).max(20).refine(values => new Set(values).size === values.length)
const inputSchema = z.strictObject({ requestId, targetUrls: bulkCreateTargetsSchema })
const resultSchema = z.strictObject({ requestId, createdCount: z.number().int().min(1).max(20) })
export type BulkCreateInput = Readonly<{ requestId: string; targetUrls: readonly string[] }>
export type BulkCreateItem = Readonly<{ targetUrl: string; title: string }>
export type BulkCreateTitlesInput = Readonly<{ requestId: string; items: readonly BulkCreateItem[] }>
export type BulkCreateMetadataItem = Readonly<{ targetUrl: string; title: string; tags: readonly string[] }>
export type BulkCreateMetadataInput = Readonly<{ requestId: string; items: readonly BulkCreateMetadataItem[] }>
export type BulkCreateCustomSlugItem = Readonly<{ targetUrl: string; title: string; tags: readonly string[]; customSlug: string }>
export type BulkCreateCustomSlugsInput = Readonly<{ requestId: string; items: readonly BulkCreateCustomSlugItem[] }>
const rawTitle = z.string().refine(value => !/[\uD800-\uDFFF]/u.test(value) && shortLinkMetadataSchema.safeParse({ title: value, tags: [] }).success)
export const bulkCreateItemsSchema = z.array(z.strictObject({ targetUrl: target, title: rawTitle })).min(1).max(20)
  .refine(items => new Set(items.map(item => item.targetUrl)).size === items.length)
export const bulkCreateTitlesInputSchema = z.strictObject({ requestId, items: bulkCreateItemsSchema })
  .refine(input => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 65536)
export const bulkCreateMetadataItemsSchema = z.array(z.strictObject({
  targetUrl: target,
  title: rawTitle,
  tags: z.array(z.string().refine(value => !/[\uD800-\uDFFF]/u.test(value))).max(10),
}).refine(item => shortLinkMetadataSchema.safeParse({ title: item.title, tags: item.tags }).success)).min(1).max(20)
  .refine(items => new Set(items.map(item => item.targetUrl)).size === items.length)
export const bulkCreateMetadataInputSchema = z.strictObject({ requestId, items: bulkCreateMetadataItemsSchema })
  .refine(input => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 65536)
const customSlugItemSchema = z.strictObject({
  targetUrl: target,
  title: rawTitle,
  tags: z.array(z.string().refine(value => !/[\uD800-\uDFFF]/u.test(value))).max(10),
  customSlug: z.string().refine(value => value === '' || /^[A-Za-z0-9]{3,32}$/.test(value)),
}).refine(item => shortLinkMetadataSchema.safeParse({ title: item.title, tags: item.tags }).success)
export const bulkCreateCustomSlugsInputSchema = z.strictObject({ requestId, items: z.array(customSlugItemSchema).min(1).max(20)
  .refine(items => new Set(items.map(item => item.targetUrl)).size === items.length)
  .refine(items => { const slugs = items.filter(item => item.customSlug !== '').map(item => item.customSlug.toLowerCase()); return new Set(slugs).size === slugs.length }) })
  .refine(input => new TextEncoder().encode(JSON.stringify(input)).byteLength <= 65536)

export class BulkCreateUnknownError extends Error {
  constructor() { super('Batch result is unknown'); this.name = 'BulkCreateUnknownError' }
}

/** Trims only ASCII padding and CRLF separators, preserving ordered literal URLs. */
export function parseBulkCreateLines(text: string) {
  return bulkCreateTargetsSchema.safeParse(text.split(/\r?\n/).map(line => line.replace(/^[ \t]+|[ \t]+$/g, '')).filter(line => line !== ''))
}

/** Treats transport, infrastructure and malformed success as unknown, never as permission to change the key. */
export async function batchCreateShortLinks(input: BulkCreateInput, expectedUserId?: string) {
  const request = inputSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid batch creation request')
  return sendBatch('/short-link/batch-create', request.data, request.data.targetUrls.length, expectedUserId)
}

/** Validates titles without transforming the raw payload used for idempotent retries. */
export async function batchCreateShortLinksWithTitles(input: BulkCreateTitlesInput, expectedUserId?: string) {
  const request = bulkCreateTitlesInputSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid titled batch creation request')
  return sendBatch('/short-link/batch-create-with-titles', request.data, request.data.items.length, expectedUserId)
}

/** Validates raw tag arrays without changing the payload used for idempotent retries. */
export async function batchCreateShortLinksWithMetadata(input: BulkCreateMetadataInput, expectedUserId?: string) {
  const request = bulkCreateMetadataInputSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid metadata batch creation request')
  return sendBatch('/short-link/batch-create-with-metadata', request.data, request.data.items.length, expectedUserId)
}

/** Preserves raw requested codes and metadata for explicit retries through the fourth protocol. */
export async function batchCreateShortLinksWithCustomSlugs(input: BulkCreateCustomSlugsInput, expectedUserId?: string) {
  const request = bulkCreateCustomSlugsInputSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid custom-code batch creation request')
  return sendBatch('/short-link/batch-create-with-custom-slugs', request.data, request.data.items.length, expectedUserId)
}

/** Shares bounded transport and exact receipt validation across independent protocols. */
async function sendBatch(path: string, input: BulkCreateInput | BulkCreateTitlesInput | BulkCreateMetadataInput | BulkCreateCustomSlugsInput, count: number, expectedUserId?: string) {
  const controller = new AbortController()
  // Includes response-body decoding: an unacknowledged write must become recoverable.
  const deadline = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await apiPost<unknown>(path, input, controller.signal,
      expectedUserId === undefined ? undefined : { 'X-MoeURL-Expected-User-ID': expectedUserId })
    const result = resultSchema.safeParse(response.data)
    if (!result.success || result.data.requestId !== input.requestId || result.data.createdCount !== count) throw new BulkCreateUnknownError()
    return result.data
  } catch (error) {
    if (error instanceof ApiClientError && ([401, 403].includes(error.code)
      || (!('status' in error.meta) && [100001, 120001, 200101, 200102, 200103, 200114, 200120, 200121, 200122].includes(error.code)))) throw error
    throw new BulkCreateUnknownError()
  } finally { clearTimeout(deadline) }
}
