export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  meta: Record<string, unknown>
}

export class ApiClientError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

const API_BASE = '/api/v1'

/** Performs an authenticated GET request under the versioned API prefix. */
export async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  return getJson<T>(`${API_BASE}${path}`)
}

/** Performs a GET request to a validated same-origin absolute path. */
export async function apiGetPath<T>(path: string): Promise<ApiResponse<T>> {
  const currentOrigin = window.location.origin
  let resolvedURL: URL
  try {
    resolvedURL = new URL(path, currentOrigin)
  } catch {
    throw new Error('API path must be a same-origin absolute path')
  }
  if (!path.startsWith('/') || path.startsWith('//') || resolvedURL.origin !== currentOrigin) {
    throw new Error('API path must be a same-origin absolute path')
  }
  return getJson<T>(resolvedURL.pathname + resolvedURL.search)
}

/** Fetches and decodes a JSON response without changing the supplied path. */
async function getJson<T>(path: string): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
    },
    method: 'GET',
  })

  return decodeResponse<T>(response)
}

export async function apiPost<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    method: 'POST',
  })

  return decodeResponse<T>(response)
}

async function decodeResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const text = await response.text()
  const payload = parsePayload<T>(text)
  if (!response.ok) {
    throw new ApiClientError(response.status, payload?.message || `HTTP ${response.status}`, { status: response.status })
  }
  if (!payload) {
    throw new ApiClientError(100001, 'Invalid JSON response', { status: response.status })
  }
  if (payload.code !== 0) {
    throw new ApiClientError(payload.code, payload.message, payload.meta ?? {})
  }
  return payload
}

function parsePayload<T>(text: string): ApiResponse<T> | null {
  try {
    return JSON.parse(text) as ApiResponse<T>
  } catch {
    return null
  }
}
