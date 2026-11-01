import { z } from 'zod'
import { apiPost, ApiClientError } from '@/shared/api/client'
import { targetUrlSchema } from '@/shared/validation/shortLinkAccess'

const requestId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000')
const target = z.string().min(1).max(2048).regex(/^[!-~]+$/).refine(value => targetUrlSchema.safeParse(value).success)
export const bulkCreateTargetsSchema = z.array(target).min(1).max(20).refine(values => new Set(values).size === values.length)
const inputSchema = z.strictObject({ requestId, targetUrls: bulkCreateTargetsSchema })
const resultSchema = z.strictObject({ requestId, createdCount: z.number().int().min(1).max(20) })
export type BulkCreateInput = Readonly<{ requestId: string; targetUrls: readonly string[] }>

export class BulkCreateUnknownError extends Error {
  constructor() { super('Batch result is unknown'); this.name = 'BulkCreateUnknownError' }
}

/** Trims only ASCII padding and CRLF separators, preserving ordered literal URLs. */
export function parseBulkCreateLines(text: string) {
  return bulkCreateTargetsSchema.safeParse(text.split(/\r?\n/).map(line => line.replace(/^[ \t]+|[ \t]+$/g, '')).filter(line => line !== ''))
}

/** Treats transport, infrastructure and malformed success as unknown, never as permission to change the key. */
export async function batchCreateShortLinks(input: BulkCreateInput) {
  const request = inputSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid batch creation request')
  const controller = new AbortController()
  // Includes response-body decoding: an unacknowledged write must become recoverable.
  const deadline = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await apiPost<unknown>('/short-link/batch-create', request.data, controller.signal)
    const result = resultSchema.safeParse(response.data)
    if (!result.success || result.data.requestId !== request.data.requestId || result.data.createdCount !== request.data.targetUrls.length) throw new BulkCreateUnknownError()
    return result.data
  } catch (error) {
    if (error instanceof ApiClientError && ([401, 403].includes(error.code)
      || (!('status' in error.meta) && [100001, 120001, 200101, 200103, 200114, 200120].includes(error.code)))) throw error
    throw new BulkCreateUnknownError()
  } finally { clearTimeout(deadline) }
}
