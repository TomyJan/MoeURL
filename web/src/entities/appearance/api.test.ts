import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppearanceSchema, AppearanceSettingsSchema, getAppearance, getPublicAppearance, updateAppearance } from './api'

const version = '2026-10-30T01:02:03.123456789+08:00'
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), { status: 200 })
describe('independent appearance protocol', () => {
  afterEach(() => vi.unstubAllGlobals())
  it.each(['iris', 'ocean', 'forest'] as const)('uses the three independent routes and preserves %s with its complete revision', async (accentPreset) => {
    const fetcher = vi.fn(async () => envelope({ accentPreset }))
    vi.stubGlobal('fetch', fetcher)
    await expect(getPublicAppearance()).resolves.toEqual({ accentPreset })
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/system/appearance', expect.objectContaining({ method: 'GET' }))
    fetcher.mockImplementation(async () => envelope({ accentPreset, updatedAt: version }))
    await expect(getAppearance()).resolves.toEqual({ accentPreset, updatedAt: version })
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/admin/system/appearance', expect.objectContaining({ method: 'GET' }))
    await expect(updateAppearance({ accentPreset, expectedUpdatedAt: version })).resolves.toEqual({ accentPreset, updatedAt: version })
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/admin/system/appearance/update', expect.objectContaining({ method: 'POST', body: JSON.stringify({ accentPreset, expectedUpdatedAt: version }) }))
  })
  it.each([{}, null, { accentPreset: null }, { accentPreset: 'blue' }, { accentPreset: 'IRIS' }, { accentPreset: 'iris', css: 'red' }, { accentPreset: 'iris', updatedAt: version }])('rejects malformed or private public projections %#', async (data) => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope(data)))
    expect(AppearanceSchema.safeParse(data).success).toBe(false)
    await expect(getPublicAppearance()).rejects.toThrow()
  })
  it.each([{}, { accentPreset: 'iris' }, { accentPreset: 'iris', updatedAt: null }, { accentPreset: 'iris', updatedAt: 'broken' }, { accentPreset: 'iris', updatedAt: version, other: true }])('rejects invalid management documents %#', async (data) => {
    vi.stubGlobal('fetch', vi.fn(async () => envelope(data)))
    expect(AppearanceSettingsSchema.safeParse(data).success).toBe(false)
    await expect(getAppearance()).rejects.toThrow()
  })
  it.each([
    {}, { accentPreset: null, expectedUpdatedAt: version }, { accentPreset: 'blue', expectedUpdatedAt: version },
    { accentPreset: 'iris', expectedUpdatedAt: null }, { accentPreset: 'iris', expectedUpdatedAt: 'broken' },
    { accentPreset: 'iris', expectedUpdatedAt: '0001-01-01T00:00:00Z' },
    { accentPreset: 'iris', expectedUpdatedAt: '0000-01-01T00:00:00Z' },
    { accentPreset: 'iris', expectedUpdatedAt: '0001-01-01T01:00:00+01:00' },
    { accentPreset: 'iris', expectedUpdatedAt: version, other: true },
  ])('rejects invalid complete commands before transport %#', async (data) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(updateAppearance(data as never)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('retains nonzero nanoseconds even at the zero-time boundary', async () => {
    const exact = '0001-01-01T00:00:00.000000001Z'
    vi.stubGlobal('fetch', vi.fn(async () => envelope({ accentPreset: 'iris', updatedAt: exact })))
    await expect(updateAppearance({ accentPreset: 'iris', expectedUpdatedAt: exact })).resolves.toEqual({ accentPreset: 'iris', updatedAt: exact })
  })
})
