export interface ShortLink {
  id: string
  url: string
  slug: string
  targetUrl: string
  status: 'active' | 'disabled'
  stats?: ShortLinkStats
}

export interface ShortLinkStats {
  visitCount: number
  todayVisitCount: number
  lastVisitedAt: string | null
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
}

export interface UpdateShortLinkInput {
  id: string
  targetUrl?: string
  status?: ShortLink['status']
}
