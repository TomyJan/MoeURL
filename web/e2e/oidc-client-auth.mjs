import { Buffer } from 'node:buffer'

// The E2E provider advertises only client_secret_basic.
export function clientCredentials(request) {
  const authorization = request.headers.authorization ?? ''
  if (authorization.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice('Basic '.length), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator >= 0) {
      return {
        id: decodeURIComponent(decoded.slice(0, separator)),
        secret: decodeURIComponent(decoded.slice(separator + 1)),
      }
    }
  }
  return { id: '', secret: '' }
}
