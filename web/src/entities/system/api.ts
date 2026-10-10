import { apiGet, apiPost } from '@/shared/api/client'
import { z } from 'zod'

export const InitStatusSchema = z.object({
  initialized: z.boolean(),
  setupTokenRequired: z.boolean(),
}).strict()

export type InitStatus = z.infer<typeof InitStatusSchema>

const SetupResultSchema = z.object({
  initialized: z.boolean(),
}).strict()

export type SetupResult = z.infer<typeof SetupResultSchema>

const SiteNameSchema = z.string().trim().min(1).max(64)
const DefaultLanguageSchema = z.enum(['zh-CN', 'en'])
const DefaultThemeSchema = z.enum(['system', 'light', 'dark'])

export const PublicConfigSchema = z.object({
  siteName: SiteNameSchema,
  defaultLanguage: DefaultLanguageSchema,
  defaultTheme: DefaultThemeSchema,
  footerText: z.string().max(200),
  showPoweredBy: z.boolean(),
}).strict()

export type PublicConfig = z.infer<typeof PublicConfigSchema>

export const SettingsSchema = PublicConfigSchema.extend({
  localLoginEnabled: z.boolean(),
  updatedAt: z.iso.datetime({ offset: true }),
}).strict()
export type Settings = z.infer<typeof SettingsSchema>
export const UpdateSettingsInputSchema = PublicConfigSchema.extend({
  localLoginEnabled: z.boolean(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
}).strict()
export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInputSchema>

export const SetupInputSchema = z.object({
  adminUsername: z.string().trim().min(1),
  adminPassword: z.string().min(8),
  adminNickname: z.string().trim().min(1),
  siteName: SiteNameSchema,
  systemDomain: z.string().trim().min(1),
  shortLinkDomain: z.string().trim().min(1),
  defaultLanguage: DefaultLanguageSchema,
  defaultTheme: DefaultThemeSchema,
  setupToken: z.string().optional(),
}).strict()

export type SetupInput = z.infer<typeof SetupInputSchema>

/** Loads whether the initial system setup has completed. */
export async function getInitStatus(): Promise<InitStatus> {
  const response = await apiGet<unknown>('/init/status')
  return InitStatusSchema.parse(response.data)
}

/** Validates and submits the one-time system setup payload. */
export async function setupSystem(input: SetupInput): Promise<SetupResult> {
  const response = await apiPost<unknown>('/init/setup', SetupInputSchema.parse(input))
  return SetupResultSchema.parse(response.data)
}

/** Loads the public site configuration used before authentication. */
export async function getPublicConfig(): Promise<PublicConfig> {
  const response = await apiGet<unknown>('/system/public-config')
  return PublicConfigSchema.parse(response.data)
}

/** Loads the complete settings document for authorized administrators. */
export async function getAdminSettings(): Promise<Settings> {
  const response = await apiGet<unknown>('/admin/system/settings')
  return SettingsSchema.parse(response.data)
}

/** Replaces editable settings using optimistic concurrency. */
export async function updateAdminSettings(input: UpdateSettingsInput): Promise<Settings> {
  const response = await apiPost<unknown>('/admin/system/settings/update', UpdateSettingsInputSchema.parse(input))
  return SettingsSchema.parse(response.data)
}
