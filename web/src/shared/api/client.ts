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
  const payload = (await response.json()) as ApiResponse<T>
  if (payload.code !== 0) {
    throw new ApiClientError(payload.code, payload.message, payload.meta)
  }
  return payload
}
