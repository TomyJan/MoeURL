import { apiGet, apiPost } from '@/shared/api/client'
import { z } from 'zod'

export interface InitStatus {
  initialized: boolean
}

export const SetupInputSchema = z.object({
  adminUsername: z.string().trim().min(1),
  adminPassword: z.string().min(8),
  adminNickname: z.string().trim().min(1),
  siteName: z.string().trim().min(1),
  systemDomain: z.string().trim().min(1),
  shortLinkDomain: z.string().trim().min(1),
  defaultLanguage: z.string().trim().min(1),
  defaultTheme: z.string().trim().min(1),
})

export type SetupInput = z.infer<typeof SetupInputSchema>

export async function getInitStatus(): Promise<InitStatus> {
  const response = await apiGet<InitStatus>('/init/status')
  return response.data
}

export async function setupSystem(input: SetupInput): Promise<InitStatus> {
  const response = await apiPost<InitStatus>('/init/setup', SetupInputSchema.parse(input))
  return response.data
}
