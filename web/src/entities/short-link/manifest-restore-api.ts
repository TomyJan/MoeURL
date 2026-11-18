import { z } from 'zod'
import { apiPost, ApiClientError } from '@/shared/api/client'
import type { ManifestRestoreCsvItem } from './manifest-restore-csv'

const maxRequestBytes = 1 << 20
const requestIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== '00000000-0000-0000-0000-000000000000')
const itemSchema = z.strictObject({
  domainOrigin: z.string(),
  slug: z.string(),
  targetUrl: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  status: z.enum(['active', 'disabled']),
  redirectMode: z.enum(['direct', 'intermediate', 'confirmation']),
  intermediateDelaySeconds: z.string(),
  expiresAt: z.string(),
  maxVisits: z.string(),
})
const inputSchema = z.strictObject({
  requestId: requestIdSchema,
  items: z.array(itemSchema).min(1).max(100)
    .refine(items => new Set(items.map(item => item.slug)).size === items.length),
}).refine(input => new TextEncoder().encode(JSON.stringify(input)).byteLength <= maxRequestBytes)
const actorSchema = requestIdSchema
const resultSchema = z.strictObject({
  requestId: requestIdSchema,
  createdCount: z.number().int().min(1).max(100),
})

export type ManifestRestoreInput = Readonly<{
  requestId: string
  items: readonly ManifestRestoreCsvItem[]
}>

/** Keeps uncertain writes retryable only with the same request key and body. */
export class ManifestRestoreUnknownError extends Error {
  constructor() { super('Manifest restore result is unknown'); this.name = 'ManifestRestoreUnknownError' }
}

/** Sends one bounded atomic restore request and accepts only its exact count receipt. */
export async function manifestRestoreShortLinks(input: ManifestRestoreInput, expectedUserId?: string) {
  const parsed = inputSchema.safeParse(input)
  const expectedActor = expectedUserId === undefined ? undefined : actorSchema.safeParse(expectedUserId)
  if (!parsed.success || (expectedActor && !expectedActor.success)) {
    throw new ApiClientError(100001, 'Invalid manifest restore request')
  }

  const count = parsed.data.items.length
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await apiPost<unknown>('/short-link/manifest/restore', parsed.data, controller.signal,
      expectedActor?.success ? { 'X-MoeURL-Expected-User-ID': expectedActor.data } : undefined)
    const result = resultSchema.safeParse(response.data)
    if (!result.success || result.data.requestId !== parsed.data.requestId || result.data.createdCount !== count) {
      throw new ManifestRestoreUnknownError()
    }
    return result.data
  } catch (error) {
    if (error instanceof ApiClientError && ([401, 403].includes(error.code)
      || (!('status' in error.meta) && [100001, 120001, 200101, 200102, 200103, 200108, 200114, 200120, 200121, 200122].includes(error.code)))) throw error
    throw new ManifestRestoreUnknownError()
  } finally {
    clearTimeout(deadline)
  }
}
