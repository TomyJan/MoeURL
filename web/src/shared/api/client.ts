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

export async function apiGet<T>(path: string): Promise<ApiResponse<T>> {
  const response = await fetch(`${API_BASE}${path}`, {
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
