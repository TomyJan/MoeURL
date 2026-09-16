import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet, apiPost } from '@/shared/api/client'
import { INVALID_REQUEST_CODE } from '@/shared/api/error-codes'
import { availableDomainQueryKey, createDomain, deleteDomain, listAvailableDomains, listDomains, setDefaultDomain, updateDomain } from './api'
import type { DomainDraftInput } from './api'

vi.mock('@/shared/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/api/client')>()
  return { ...actual, apiGet: vi.fn(), apiPost: vi.fn() }
})

const domain = {
  id: '00000000-0000-4000-8000-000000000801', host: 'https://go.example.com', displayName: 'Primary',
  purpose: 'short_link', enabled: true, isDefault: true, allowedGroups: ['user', 'admin'],
  referenced: false, updatedAt: '2026-09-14T00:00:00Z',
}

describe('domain API', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset()
    vi.mocked(apiPost).mockReset()
  })

  it('parses a strict management list and uses the versioned endpoint', async () => {
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { items: [domain] } })
    await expect(listDomains()).resolves.toEqual({ items: [domain] })
    expect(apiGet).toHaveBeenCalledWith('/admin/domain/list')
  })

  it.each([
    [{ ...domain, clientSecret: 'unexpected' }],
    [domain, { ...domain, id: '00000000-0000-4000-8000-000000000802', host: 'https://GO.example.com:443' }],
    [domain, { ...domain, host: 'https://other.example.com' }],
    [{ ...domain, allowedGroups: ['user', 'user'] }],
  ])('rejects malformed, duplicate or ambiguous managed domains', async (...items) => {
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { items } })
    await expect(listDomains()).rejects.toEqual(expect.objectContaining({ code: INVALID_REQUEST_CODE }))
  })

  it('parses the available domain projection and rejects duplicated choices', async () => {
    const available = { id: domain.id, host: domain.host, displayName: domain.displayName, isDefault: true }
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { items: [available] } })
    await expect(listAvailableDomains()).resolves.toEqual({ items: [available] })
    expect(apiGet).toHaveBeenCalledWith('/domain/available')
    expect(availableDomainQueryKey).toEqual(['domain', 'available'])
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { items: [available, available] } })
    await expect(listAvailableDomains()).rejects.toEqual(expect.objectContaining({ code: INVALID_REQUEST_CODE }))
  })

  it('preserves legacy stored hosts and detects ambiguous invalid legacy authorities', async () => {
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { items: [{ ...domain, host: 'go.example.com' }] } })
    await expect(listDomains()).resolves.toMatchObject({ items: [{ host: 'go.example.com' }] })
    vi.mocked(apiGet).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { items: [
      { ...domain, host: '%invalid' },
      { ...domain, id: '00000000-0000-4000-8000-000000000802', host: '%INVALID' },
    ] } })
    await expect(listDomains()).rejects.toEqual(expect.objectContaining({ code: INVALID_REQUEST_CODE }))
  })

  it('sends optimistic mutations and validates their responses', async () => {
    vi.mocked(apiPost).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { domain } })
    const create: DomainDraftInput = { host: domain.host, displayName: domain.displayName, allowedGroups: ['user'], enabled: true }
    await expect(createDomain(create)).resolves.toEqual({ domain })
    expect(apiPost).toHaveBeenLastCalledWith('/admin/domain/create', create)
    const update = { ...create, id: domain.id, expectedUpdatedAt: domain.updatedAt }
    await expect(updateDomain(update)).resolves.toEqual({ domain })
    expect(apiPost).toHaveBeenLastCalledWith('/admin/domain/update', update)
    const change = { id: domain.id, expectedUpdatedAt: domain.updatedAt }
    await expect(setDefaultDomain(change)).resolves.toEqual({ domain })
    expect(apiPost).toHaveBeenLastCalledWith('/admin/domain/set-default', change)
    vi.mocked(apiPost).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { deleted: true } })
    await expect(deleteDomain(change)).resolves.toBeUndefined()
    expect(apiPost).toHaveBeenLastCalledWith('/admin/domain/delete', change)
    vi.mocked(apiPost).mockResolvedValue({ code: 0, message: 'OK', meta: {}, data: { deleted: false } })
    await expect(deleteDomain(change)).rejects.toEqual(expect.objectContaining({ code: INVALID_REQUEST_CODE }))
  })
})
