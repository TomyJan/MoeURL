export type RedirectMode = 'direct' | 'intermediate' | 'confirmation'

export type ExpirationInput =
  | { mode: 'never' }
  | { mode: 'at'; expiresAt: string }

export type PasswordInput =
  /** Removes password protection; on update this also invalidates existing access grants. */
  | { mode: 'never' }
  /** Sets or replaces password protection. */
  | { mode: 'set'; value: string }

export type VisitLimitInput =
  | { mode: 'limited'; maxVisits: number }
  | { mode: 'unlimited' }

export interface ShortLinkMetadata {
  title: string
  tags: string[]
}

export interface ShortLink {
  id: string
  url: string
  slug: string
  targetUrl: string
  title: string
  tags: string[]
  status: 'active' | 'disabled'
  redirectMode: RedirectMode
  intermediateDelaySeconds: number
  expiresAt: string | null
  expired: boolean
  passwordEnabled: boolean
  maxVisits: number | null
  visitsUsed: number
  visitsRemaining: number | null
  exhausted: boolean
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
  metadata?: ShortLinkMetadata | null
  domainId?: string
  redirectMode?: RedirectMode
  intermediateDelaySeconds?: number
  expiration?: ExpirationInput
  password?: PasswordInput
  maxVisits?: number
}

export interface UpdateShortLinkInput {
  id: string
  /** Omit or null to preserve metadata; a complete object replaces both fields. */
  metadata?: ShortLinkMetadata | null
  targetUrl?: string
  status?: ShortLink['status']
  redirectMode?: RedirectMode
  intermediateDelaySeconds?: number
  expiration?: ExpirationInput
  /** Omit to preserve the existing password; use `never` to clear it explicitly. */
  password?: PasswordInput
  /** Omit to preserve the current quota period; unlimited clears its usage. */
  visitLimit?: VisitLimitInput
}

interface PublicShortLinkPreviewBase {
  slug: string
  targetHost: string
  expiresAt: string | null
}

export type PublicShortLinkPreview = PublicShortLinkPreviewBase & (
  | { redirectMode: 'direct'; intermediateDelaySeconds: null }
  | { redirectMode: 'intermediate'; intermediateDelaySeconds: number }
  | { redirectMode: 'confirmation'; intermediateDelaySeconds: null }
)

export interface UnlockShortLinkInput {
  slug: string
  password: string
}

export interface UnlockShortLinkResponse {
  unlocked: true
}
