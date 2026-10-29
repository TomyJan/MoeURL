import { afterEach, describe, expect, it, vi } from 'vitest'
import { getHomeContent, getPublicHomeContent, HomeContentSchema, HomeContentSettingsSchema, UpdateHomeContentSchema, updateHomeContent } from './api'

const version = '2026-10-29T07:00:00.123456Z'
function mockResponse(data: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}
describe('independent homepage copy API', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('uses three independent endpoints and preserves the complete revision verbatim', async () => {
    const content = { title: 'Title', summary: 'Summary' }
    const fetch = mockResponse(content)
    await expect(getPublicHomeContent()).resolves.toEqual(content)
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/system/home-content', expect.objectContaining({ method: 'GET' }))
    fetch.mockImplementation(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { ...content, updatedAt: version }, meta: {} }), { status: 200 }))
    await expect(getHomeContent()).resolves.toEqual({ ...content, updatedAt: version })
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/admin/system/home-content', expect.objectContaining({ method: 'GET' }))
    await expect(updateHomeContent({ title: ' Title ', summary: ' Summary ', expectedUpdatedAt: version })).resolves.toEqual({ ...content, updatedAt: version })
    expect(fetch).toHaveBeenLastCalledWith('/api/v1/admin/system/home-content/update', expect.objectContaining({ method: 'POST', body: JSON.stringify({ ...content, expectedUpdatedAt: version }) }))
  })
  it('accepts 80 and 200 Unicode codepoints, preserving literal and BOM content', () => {
    expect(UpdateHomeContentSchema.parse({ title: '🌲'.repeat(80), summary: '中'.repeat(200), expectedUpdatedAt: version }).title).toHaveLength(160)
    expect(UpdateHomeContentSchema.parse({ title: '\u00a0Text\u3000', summary: '\uFEFF', expectedUpdatedAt: version })).toMatchObject({ title: 'Text', summary: '\uFEFF' })
    expect(HomeContentSchema.parse({ title: '<b>{name}</b>', summary: '' })).toEqual({ title: '<b>{name}</b>', summary: '' })
  })
  it.each([
    { title: 'x'.repeat(81), summary: '' }, { title: '', summary: '🌲'.repeat(201) },
    { title: '\tTitle', summary: '' }, { title: '', summary: 'Summary\n' }, { title: '\u0085', summary: '' },
    { title: null, summary: '' }, { summary: '' }, { title: '', summary: '' , unknown: true },
  ])('rejects invalid complete writes before transport %#', async (content) => {
    const fetch = mockResponse({})
    await expect(updateHomeContent({ ...content, expectedUpdatedAt: version } as never)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([{}, { title: '', summary: null }, { title: '', summary: '', updatedAt: version }, { title: ' padded ', summary: '' }])('rejects a malformed or private public projection %#', (data) => {
    expect(HomeContentSchema.safeParse(data).success).toBe(false)
  })
  it('rejects incomplete, unknown and invalid management revisions', async () => {
    for (const data of [{ title: '', summary: '' }, { title: '', summary: '', updatedAt: 'broken' }, { title: '', summary: '', updatedAt: version, secret: 'x' }]) {
      expect(HomeContentSettingsSchema.safeParse(data).success).toBe(false)
    }
    mockResponse({ title: '', summary: '', updatedAt: 'broken' })
    await expect(getHomeContent()).rejects.toThrow()
    mockResponse({ title: '', summary: '', updatedAt: version })
    await expect(getPublicHomeContent()).rejects.toThrow()
  })
})
