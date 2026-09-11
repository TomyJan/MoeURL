import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { createServer } from 'node:http'
import process from 'node:process'
import { URLSearchParams } from 'node:url'

const port = Number.parseInt(process.env.OIDC_PORT ?? '19000', 10)
const issuer = `http://127.0.0.1:${port}`
const clientSecret = 'e2e-client-secret'
const keyID = 'moeurl-e2e-key'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const publicJWK = publicKey.export({ format: 'jwk' })
const codes = new Map()

const identities = {
  'moeurl-allowed': { sub: 'allowed-subject', email: 'person@example.com', email_verified: true, name: 'OIDC Person' },
  'moeurl-denied': { sub: 'denied-subject', email: 'person@outside.test', email_verified: true, name: 'Denied Person' },
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', issuer)
  if (request.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
    return json(response, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    })
  }
  if (request.method === 'GET' && url.pathname === '/jwks') {
    return json(response, 200, { keys: [{ ...publicJWK, alg: 'RS256', kid: keyID, use: 'sig' }] })
  }
  if (request.method === 'GET' && url.pathname === '/authorize') {
    const clientID = url.searchParams.get('client_id') ?? ''
    const redirectURI = url.searchParams.get('redirect_uri') ?? ''
    const state = url.searchParams.get('state') ?? ''
    const nonce = url.searchParams.get('nonce') ?? ''
    const codeChallenge = url.searchParams.get('code_challenge') ?? ''
    if (!identities[clientID] || !redirectURI || !state || !nonce || !codeChallenge || url.searchParams.get('code_challenge_method') !== 'S256') {
      return json(response, 400, { error: 'invalid_request' })
    }
    const code = randomBytes(24).toString('base64url')
    codes.set(code, { clientID, codeChallenge, nonce, redirectURI, expiresAt: Date.now() + 60_000 })
    const callback = new URL(redirectURI)
    callback.searchParams.set('code', code)
    callback.searchParams.set('state', state)
    response.writeHead(302, { location: callback.toString(), 'cache-control': 'no-store' })
    return response.end()
  }
  if (request.method === 'POST' && url.pathname === '/token') {
    const body = new URLSearchParams(await readBody(request))
    const code = body.get('code') ?? ''
    const attempt = codes.get(code)
    const credentials = clientCredentials(request, body)
    const verifier = body.get('code_verifier') ?? ''
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    if (!attempt || attempt.expiresAt <= Date.now() || credentials.secret !== clientSecret || credentials.id !== attempt.clientID || body.get('redirect_uri') !== attempt.redirectURI || challenge !== attempt.codeChallenge) {
      return json(response, 400, { error: 'invalid_grant' })
    }
    codes.delete(code)
    const now = Math.floor(Date.now() / 1000)
    const idToken = jwt({
      iss: issuer,
      aud: attempt.clientID,
      exp: now + 300,
      iat: now,
      nonce: attempt.nonce,
      ...identities[attempt.clientID],
    })
    return json(response, 200, { access_token: 'opaque-e2e-token', token_type: 'Bearer', expires_in: 300, id_token: idToken })
  }
  return json(response, 404, { error: 'not_found' })
}).listen(port, '0.0.0.0')

function jwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: keyID, typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signingInput = `${header}.${claims}`
  const signature = sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')
  return `${signingInput}.${signature}`
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function clientCredentials(request, body) {
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
  return { id: body.get('client_id') ?? '', secret: body.get('client_secret') ?? '' }
}
