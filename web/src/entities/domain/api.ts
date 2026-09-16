import { z } from 'zod'

import { ApiClientError, apiGet, apiPost } from '@/shared/api/client'
import { INVALID_REQUEST_CODE } from '@/shared/api/error-codes'

export type DomainGroupKey = 'user' | 'admin'

export interface ManagedDomain {
  id: string
  host: string
  displayName: string
  purpose: 'short_link'
  enabled: boolean
  isDefault: boolean
  allowedGroups: DomainGroupKey[]
  referenced: boolean
  updatedAt: string
}

export interface AvailableDomain {
  id: string
  host: string
  displayName: string
  isDefault: boolean
}

export interface DomainDraftInput {
  host: string
  displayName: string
  allowedGroups: DomainGroupKey[]
  enabled: boolean
}

export interface UpdateDomainInput extends DomainDraftInput {
  id: string
  expectedUpdatedAt: string
}

export interface ChangeDomainInput {
  id: string
  expectedUpdatedAt: string
}

export const managedDomainQueryKey = ['admin', 'domains'] as const
export const availableDomainQueryKey = ['domain', 'available'] as const

const idSchema = z.uuid()
const hostSchema = z.string().min(1)
const availableSchema = z.strictObject({
  id: idSchema, host: hostSchema, displayName: z.string(), isDefault: z.boolean(),
})
const managedSchema: z.ZodType<ManagedDomain> = availableSchema.safeExtend({
  purpose: z.literal('short_link'), enabled: z.boolean(),
  allowedGroups: z.array(z.enum(['user', 'admin'])).refine(unique),
  referenced: z.boolean(), updatedAt: z.iso.datetime({ offset: true }),
})
const managedListSchema = z.strictObject({ items: z.array(managedSchema).refine(uniqueDomains) })
const availableListSchema = z.strictObject({ items: z.array(availableSchema).refine(uniqueDomains) })
const managedResponseSchema = z.strictObject({ domain: managedSchema })
const deleteResponseSchema = z.strictObject({ deleted: z.literal(true) })

/** Loads the strict administrator domain projection. */
export async function listDomains(): Promise<{ items: ManagedDomain[] }> {
  return parse(managedListSchema, (await apiGet<unknown>('/admin/domain/list')).data)
}

/** Loads only domains currently available to this authenticated user. */
export async function listAvailableDomains(): Promise<{ items: AvailableDomain[] }> {
  return parse(availableListSchema, (await apiGet<unknown>('/domain/available')).data)
}

/** Registers a short-link domain and its built-in group grants. */
export async function createDomain(input: DomainDraftInput): Promise<{ domain: ManagedDomain }> {
  return parse(managedResponseSchema, (await apiPost<unknown>('/admin/domain/create', input)).data)
}

/** Saves a domain only when its server revision still matches. */
export async function updateDomain(input: UpdateDomainInput): Promise<{ domain: ManagedDomain }> {
  return parse(managedResponseSchema, (await apiPost<unknown>('/admin/domain/update', input)).data)
}

/** Switches the global short-link default using the server revision. */
export async function setDefaultDomain(input: ChangeDomainInput): Promise<{ domain: ManagedDomain }> {
  return parse(managedResponseSchema, (await apiPost<unknown>('/admin/domain/set-default', input)).data)
}

/** Removes an unreferenced, non-default domain. */
export async function deleteDomain(input: ChangeDomainInput): Promise<void> {
  parse(deleteResponseSchema, (await apiPost<unknown>('/admin/domain/delete', input)).data)
}

/** Rejects malformed server responses without exposing their raw contents. */
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) throw new ApiClientError(INVALID_REQUEST_CODE, 'Invalid domain response')
  return result.data
}

/** Detects duplicate IDs or normalized authorities in a list. */
function uniqueDomains(items: readonly AvailableDomain[]): boolean {
  return unique(items.map(({ id }) => id)) && unique(items.map(({ host }) => authority(host)))
}

/** Reduces the supported legacy authority and root Origin forms to a comparison key. */
function authority(host: string): string {
  try {
    const url = new URL(host.includes('://') ? host : `https://${host}`)
    return url.host.toLowerCase()
  } catch {
    return host.toLowerCase()
  }
}

/** Reports whether a collection has no duplicate values. */
function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}
