import { apiGet, apiPost } from '@/shared/api/client'

export interface InitStatus {
  initialized: boolean
}

export interface SetupInput {
  adminUsername: string
  adminPassword: string
  adminNickname: string
  siteName: string
  systemDomain: string
  shortLinkDomain: string
  defaultLanguage: string
  defaultTheme: string
}

export async function getInitStatus(): Promise<InitStatus> {
  const response = await apiGet<InitStatus>('/init/status')
  return response.data
}

export async function setupSystem(input: SetupInput): Promise<InitStatus> {
  const response = await apiPost<InitStatus>('/init/setup', input)
  return response.data
}
