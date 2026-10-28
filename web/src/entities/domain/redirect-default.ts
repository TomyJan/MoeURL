import { z } from 'zod'
import { ApiClientError, apiGet, apiPost } from '@/shared/api/client'
import type { RedirectMode } from '@/entities/short-link/model'

export interface DomainRedirectDefaultSetting { domainId: string; redirectMode: RedirectMode; updatedAt: string }
export interface EffectiveDomainRedirectDefault { domainId: string; redirectMode: RedirectMode }
export interface SetDomainRedirectDefaultInput { id: string; redirectMode: RedirectMode; expectedUpdatedAt: string }
export const domainRedirectDefaultsQueryKey = ['domain-redirect-defaults'] as const
export const adminDomainRedirectDefaultQueryKey = ['admin-domain-redirect-default'] as const
const idSchema = z.uuid().refine((value) => value === value.toLowerCase() && value !== '00000000-0000-0000-0000-000000000000')
const modeSchema = z.enum(['direct', 'intermediate', 'confirmation'])
const revisionSchema = z.iso.datetime({ offset: true }).refine((value) => !/[.][0-9]{10}/.test(value) && Date.parse(value) !== Date.parse('0001-01-01T00:00:00Z'))
const managementSchema = z.strictObject({ setting: z.strictObject({ domainId: idSchema, redirectMode: modeSchema, updatedAt: revisionSchema }) })
const effectiveSchema = z.strictObject({ items: z.array(z.strictObject({ domainId: idSchema, redirectMode: modeSchema })) })
  .refine(({ items }) => new Set(items.map(({ domainId }) => domainId)).size === items.length)

/** Reads the independent setting without changing the legacy managed projection. */
export async function getDomainRedirectDefault(id: string): Promise<{ setting: DomainRedirectDefaultSetting }> {
  return parseManagement((await apiGet<unknown>('/admin/domain/redirect-default?id=' + encodeURIComponent(id))).data, id)
}
/** Saves exactly one policy against the full shared domain revision. */
export async function setDomainRedirectDefault(input: SetDomainRedirectDefaultInput): Promise<{ setting: DomainRedirectDefaultSetting }> {
  return parseManagement((await apiPost<unknown>('/admin/domain/set-redirect-default', input)).data, input.id)
}
/** Reads the Cookie owner's independent effective domain-mode projection. */
export async function listDomainRedirectDefaults(): Promise<{ items: EffectiveDomainRedirectDefault[] }> {
  const parsed = effectiveSchema.safeParse((await apiGet<unknown>('/domain/redirect-defaults')).data)
  if (!parsed.success) throw invalidResponse()
  return parsed.data
}

/** Rejects cross-target replies before they can publish a draft or shared version. */
function parseManagement(data: unknown, id: string): { setting: DomainRedirectDefaultSetting } {
  const parsed = managementSchema.safeParse(data)
  if (!parsed.success || parsed.data.setting.domainId !== id) throw invalidResponse()
  return parsed.data
}

/** Never interpolates private response data into diagnostics. */
function invalidResponse() { return new ApiClientError(100001, 'Invalid domain redirect default response') }
