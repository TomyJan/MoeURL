export type RedirectMode = 'direct' | 'intermediate'

export type ExpirationInput =
  | { mode: 'never' }
  | { mode: 'at'; expiresAt: string }

export type PasswordInput =
  | { mode: 'never' }
  | { mode: 'set'; value: string }

export interface ShortLink {
  id: string
  url: string
  slug: string
  targetUrl: string
  status: 'active' | 'disabled'
  redirectMode: RedirectMode
  intermediateDelaySeconds: number
  expiresAt: string | null
  expired: boolean
  passwordEnabled: boolean
  createdAt: string
  stats?: ShortLinkStats
}

export interface ShortLinkStats {
  visitCount: number
  todayVisitCount: number
  lastVisitedAt: string | null
}

export interface ShortLinkOverview {
  totalLinkCount: number
  activeLinkCount: number
  visitCount: number
  todayVisitCount: number
}

export interface AnalyticsTrendPoint {
  date: string
  visitCount: number
}

export interface AnalyticsDimension {
  value: string
  visitCount: number
}

export interface AnalyticsStats extends ShortLinkStats {
  trend: AnalyticsTrendPoint[]
  referrers: AnalyticsDimension[]
  devices: AnalyticsDimension[]
  countries: AnalyticsDimension[]
}

export interface ShortLinkStatisticsResponse {
  shortLink: ShortLink
  stats: AnalyticsStats
}

export interface OwnerSummary {
  id: string
  username: string
  nickname: string
}

export interface AdminShortLink extends ShortLink {
  owner: OwnerSummary
}

export interface CreateShortLinkInput {
  targetUrl: string
  redirectMode?: RedirectMode
  intermediateDelaySeconds?: number
  expiration?: ExpirationInput
  password?: PasswordInput
}

export interface UpdateShortLinkInput {
  id: string
  targetUrl?: string
  status?: ShortLink['status']
  redirectMode?: RedirectMode
  intermediateDelaySeconds?: number
  expiration?: ExpirationInput
  password?: PasswordInput
}

export interface PublicShortLinkPreview {
  slug: string
  targetHost: string
  intermediateDelaySeconds: number | null
  expiresAt: string | null
}

export interface UnlockShortLinkInput {
  slug: string
  password: string
}

export interface UnlockShortLinkResponse {
  unlocked: true
}
