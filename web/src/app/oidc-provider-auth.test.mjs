import { Buffer } from 'node:buffer'
import { URLSearchParams } from 'node:url'
import { describe, expect, it } from 'vitest'

import { clientCredentials } from '../../e2e/oidc-client-auth.mjs'

describe('OIDC E2E provider client authentication', () => {
  it('accepts Basic credentials and rejects body credentials', () => {
    const body = new URLSearchParams({ client_id: 'body-client', client_secret: 'body-secret' })
    const basic = `Basic ${Buffer.from('basic-client:basic-secret').toString('base64')}`

    expect(clientCredentials({ headers: { authorization: basic } })).toEqual({ id: 'basic-client', secret: 'basic-secret' })
    expect(clientCredentials({ headers: {} }, body)).toEqual({ id: '', secret: '' })
  })
})
