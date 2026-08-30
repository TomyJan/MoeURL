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

export const SetupInputSchema = z.object({
  adminUsername: z.string().trim().min(1),
  adminPassword: z.string().min(8),
  adminNickname: z.string().trim().min(1),
  siteName: z.string().trim().min(1),
  systemDomain: z.string().trim().min(1),
  shortLinkDomain: z.string().trim().min(1),
  defaultLanguage: z.string().trim().min(1),
  defaultTheme: z.string().trim().min(1),
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
