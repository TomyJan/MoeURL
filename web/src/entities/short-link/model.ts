export interface ShortLink {
  id: string
  url: string
  slug: string
  targetUrl: string
  status: 'active' | 'disabled'
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
