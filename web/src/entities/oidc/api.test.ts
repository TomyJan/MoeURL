import { describe, expect, it, vi } from 'vitest'

import { apiGet, apiPost } from '@/shared/api/client'

import {
  createOIDCProvider,
  deleteOIDCProvider,
  getLoginMethods,
  listOIDCProviders,
  oidcStartURL,
  updateOIDCProvider,
} from './api'

vi.mock('@/shared/api/client', () => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

const provider = {
  id: '00000000-0000-4000-8000-000000000701',
  key: 'company',
  displayName: 'Company SSO',
  issuerUrl: 'https://id.example.com',
  clientId: 'moeurl',
  clientSecretConfigured: true,
  allowedEmailDomains: ['example.com'],
  enabled: true,
  callbackUrl: 'https://links.example.com/api/v1/auth/oidc/company/callback',
  updatedAt: '2026-09-11T00:00:00Z',
}

describe('OIDC API', () => {
  it('accepts only the public login-method projection', async () => {
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { local: { enabled: true }, oidc: [{ key: 'company', displayName: 'Company SSO' }] } })
    await expect(getLoginMethods()).resolves.toEqual({ local: { enabled: true }, oidc: [{ key: 'company', displayName: 'Company SSO' }] })
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { local: { enabled: true }, oidc: [{ key: 'company', displayName: 'Company', issuerUrl: 'https://secret.example' }] } })
    await expect(getLoginMethods()).rejects.toBeTruthy()
  })

  it('rejects duplicate public login providers', async () => {
    const duplicate = { key: 'company', displayName: 'Duplicate Company SSO' }
    vi.mocked(apiGet).mockResolvedValue({
      code: 0,
      message: 'OK',
      meta: {},
      data: { local: { enabled: true }, oidc: [{ key: 'company', displayName: 'Company SSO' }, duplicate] },
    })

    await expect(getLoginMethods()).rejects.toBeTruthy()
  })

  it('builds a same-origin start URL with an encoded return path', () => {
    expect(oidcStartURL('company', '/analytics?shortLinkId=abc')).toBe('/api/v1/auth/oidc/company/start?returnTo=%2Fanalytics%3FshortLinkId%3Dabc')
    expect(() => oidcStartURL('../callback', '/')).toThrow()
  })

  it('uses the versioned administrator endpoints and parses secret-free providers', async () => {
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { providers: [provider] } })
    await expect(listOIDCProviders()).resolves.toEqual({ providers: [provider] })
    expect(apiGet).toHaveBeenLastCalledWith('/admin/oidc/provider/list')

    const createInput = {
      key: 'company', displayName: 'Company SSO', issuerUrl: 'https://id.example.com', clientId: 'moeurl',
      clientSecret: 'secret', allowedEmailDomains: ['example.com'], enabled: true,
    }
    vi.mocked(apiPost).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { provider } })
    await expect(createOIDCProvider(createInput)).resolves.toEqual({ provider })
    expect(apiPost).toHaveBeenLastCalledWith('/admin/oidc/provider/create', createInput)

    const updateInput = {
      id: provider.id, displayName: provider.displayName, issuerUrl: provider.issuerUrl, clientId: provider.clientId,
      clientSecret: { mode: 'preserve' as const }, allowedEmailDomains: provider.allowedEmailDomains,
      enabled: false, expectedUpdatedAt: provider.updatedAt,
    }
    await expect(updateOIDCProvider(updateInput)).resolves.toEqual({ provider })
    expect(apiPost).toHaveBeenLastCalledWith('/admin/oidc/provider/update', updateInput)

    const deleteInput = { id: provider.id, expectedUpdatedAt: provider.updatedAt }
    vi.mocked(apiPost).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { deleted: true } })
    await expect(deleteOIDCProvider(deleteInput)).resolves.toBeUndefined()
    expect(apiPost).toHaveBeenLastCalledWith('/admin/oidc/provider/delete', deleteInput)
  })

  it('rejects malformed provider management responses', async () => {
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { providers: [{ key: 'incomplete' }] } })
    await expect(listOIDCProviders()).rejects.toBeTruthy()
    vi.mocked(apiPost).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { deleted: false } })
    await expect(deleteOIDCProvider({ id: '00000000-0000-4000-8000-000000000701', expectedUpdatedAt: '2026-09-11T00:00:00Z' })).rejects.toBeTruthy()
  })

  it.each([
    ['an invalid domain', [{ ...provider, allowedEmailDomains: ['bad_label.example'] }]],
    ['an IP address instead of a domain', [{ ...provider, allowedEmailDomains: ['127.0.0.1'] }]],
    ['duplicate domains', [{ ...provider, allowedEmailDomains: ['example.com', 'example.com'] }]],
    ['a duplicate provider ID', [provider, { ...provider, key: 'team', displayName: 'Team SSO' }]],
    ['a duplicate provider key', [provider, { ...provider, id: '00000000-0000-4000-8000-000000000702', displayName: 'Duplicate Company SSO' }]],
  ])('rejects provider lists containing %s', async (_name, providers) => {
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { providers } })

    await expect(listOIDCProviders()).rejects.toBeTruthy()
  })
})
