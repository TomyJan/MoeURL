import { z } from 'zod'

import { apiGet, apiPost } from '@/shared/api/client'

const providerKeySchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)
const loginProviderSchema = z.object({ key: providerKeySchema, displayName: z.string().min(1).max(100) }).strict()
const domainLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const emailDomainSchema = z.string().max(253).refine(isCanonicalEmailDomain)
const emailDomainsSchema = z.array(emailDomainSchema).min(1).max(100).refine((domains) => hasUniqueValues(domains))
const loginMethodsSchema = z.object({
  local: z.object({ enabled: z.boolean() }).strict(),
  oidc: z.array(loginProviderSchema).refine((providers) => hasUniqueValues(providers.map((provider) => provider.key))),
}).strict()
const providerSchema = z.object({
  id: z.uuid(),
  key: providerKeySchema,
  displayName: z.string().min(1).max(100),
  issuerUrl: z.url(),
  clientId: z.string().min(1).max(512),
  clientSecretConfigured: z.boolean(),
  allowedEmailDomains: emailDomainsSchema,
  enabled: z.boolean(),
  callbackUrl: z.url(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()
const providerListSchema = z.object({
  providers: z.array(providerSchema).refine((providers) => (
    hasUniqueValues(providers.map((provider) => provider.id))
    && hasUniqueValues(providers.map((provider) => provider.key))
  )),
}).strict()
const providerResultSchema = z.object({ provider: providerSchema }).strict()
const deleteProviderResultSchema = z.object({ deleted: z.literal(true) }).strict()

export type LoginMethods = z.infer<typeof loginMethodsSchema>
export type OIDCProvider = z.infer<typeof providerSchema>

export interface CreateOIDCProviderInput {
  key: string
  displayName: string
  issuerUrl: string
  clientId: string
  clientSecret: string
  allowedEmailDomains: string[]
  enabled: boolean
}

export interface UpdateOIDCProviderInput {
  id: string
  displayName: string
  issuerUrl: string
  clientId: string
  clientSecret: { mode: 'preserve' } | { mode: 'set'; value: string }
  allowedEmailDomains: string[]
  enabled: boolean
  expectedUpdatedAt: string
}

function hasUniqueValues(values: string[]): boolean {
  return new Set(values).size === values.length
}

function isCanonicalEmailDomain(value: string): boolean {
  const labels = value.split('.')
  if (!labels.every((label) => domainLabelPattern.test(label))) return false
  if (labels.length !== 4 || !labels.every((label) => /^\d+$/.test(label))) return true
  return labels.some((label) => Number(label) > 255)
}

/** Loads currently available authentication methods without caching secrets or configuration. */
export async function getLoginMethods(): Promise<LoginMethods> {
  const response = await apiGet<unknown>('/auth/methods')
  return loginMethodsSchema.parse(response.data)
}

/** Loads secret-free OIDC provider configuration for administrators. */
export async function listOIDCProviders(): Promise<{ providers: OIDCProvider[] }> {
  const response = await apiGet<unknown>('/admin/oidc/provider/list')
  return providerListSchema.parse(response.data)
}

/** Creates an OIDC provider without retaining its client secret in query data. */
export async function createOIDCProvider(input: CreateOIDCProviderInput): Promise<{ provider: OIDCProvider }> {
  const response = await apiPost<unknown>('/admin/oidc/provider/create', input)
  return providerResultSchema.parse(response.data)
}

/** Updates an OIDC provider and either preserves or replaces its secret. */
export async function updateOIDCProvider(input: UpdateOIDCProviderInput): Promise<{ provider: OIDCProvider }> {
  const response = await apiPost<unknown>('/admin/oidc/provider/update', input)
  return providerResultSchema.parse(response.data)
}

/** Soft deletes one OIDC provider using its optimistic version. */
export async function deleteOIDCProvider(input: { id: string; expectedUpdatedAt: string }): Promise<void> {
  const response = await apiPost<unknown>('/admin/oidc/provider/delete', input)
  deleteProviderResultSchema.parse(response.data)
}

/** Builds a same-origin start URL from a validated provider key and local return path. */
export function oidcStartURL(providerKey: string, returnTo: string): string {
  const key = providerKeySchema.parse(providerKey)
  const params = new URLSearchParams({ returnTo })
  return `/api/v1/auth/oidc/${encodeURIComponent(key)}/start?${params.toString()}`
}
