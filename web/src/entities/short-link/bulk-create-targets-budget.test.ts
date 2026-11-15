import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinks, bulkCreateTargetsSchema, parseBulkCreateLines } from './bulk-create'
import { parseBulkCreateImportCsvDetailed } from './bulk-create-csv'
import { scanBulkCreateCsv } from './bulk-create-csv-scan'

const requestId = '11111111-1111-4111-8111-111111111111'
// 19 ordered quoted paths plus the last path give compact JSON sizes 65536 and 65537.
function targets(extra = '') {
  return [...Array.from({ length: 19 }, (_, index) => 'https://example.com/' + '"'.repeat(1604) + index), 'https://example.com/end' + '"'.repeat(2013) + extra]
}
function csv(values: readonly string[]) { return 'target_url\n' + values.map(value => '"' + value.replaceAll('"', '""') + '"').join('\n') }

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('complete targets request budget', () => {
  // Omitting the shared guard lets each consumer accept the one-byte oversized batch.
  it.each(['array', 'manual', 'standard'])('accepts exact full-wire targets and refuses one extra byte before parsing or sending (%s)', consumer => {
    const exact = targets(), oversized = targets('a')
    expect(new TextEncoder().encode(JSON.stringify({ requestId, targetUrls: exact })).byteLength).toBe(65536)
    expect(new TextEncoder().encode(JSON.stringify({ requestId, targetUrls: oversized })).byteLength).toBe(65537)
    if (consumer === 'array') {
      expect(bulkCreateTargetsSchema.safeParse(exact).success).toBe(true)
      expect(bulkCreateTargetsSchema.safeParse(oversized).success).toBe(false)
    } else if (consumer === 'manual') {
      expect(parseBulkCreateLines(exact.join('\n'))).toMatchObject({ success: true, data: exact })
      expect(parseBulkCreateLines(oversized.join('\n')).success).toBe(false)
    } else {
      expect(parseBulkCreateImportCsvDetailed(csv(exact))).toEqual({ success: true, mode: 'targets', data: exact })
      expect(parseBulkCreateImportCsvDetailed(csv(oversized))).toEqual({ success: false })
    }
  })

  // CSV does not escape backslashes, but the complete JSON body must escape each one.
  it('rejects backslash expansion within a valid file budget', () => {
    const values = Array.from({ length: 20 }, (_, index) => 'https://example.com/' + index + '\\'.repeat(1700))
    const text = csv(values)
    expect(new TextEncoder().encode(text).byteLength).toBe(34500)
    expect(new TextEncoder().encode(JSON.stringify({ requestId, targetUrls: values })).byteLength).toBe(68557)
    expect(scanBulkCreateCsv(text).success).toBe(true)
    expect(bulkCreateTargetsSchema.safeParse(values).success).toBe(false)
    expect(parseBulkCreateLines(values.join('\n')).success).toBe(false)
    expect(parseBulkCreateImportCsvDetailed(text)).toEqual({ success: false })
  })

  it('sends the exact-budget ordered body and accepts its real protocol receipt', async () => {
    const value = { requestId, targetUrls: targets() }
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: '', data: { requestId, createdCount: 20 }, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    expect(await batchCreateShortLinks(value)).toEqual({ requestId, createdCount: 20 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [path, init] = fetcher.mock.calls[0]!
    expect(path).toBe('/api/v1/short-link/batch-create')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(JSON.parse(init!.body as string)).toEqual(value)
    expect(new TextEncoder().encode(init!.body as string).byteLength).toBe(65536)
  })

  it('rejects an oversized API body with the original local error and zero HTTP requests', async () => {
    const fetcher = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinks({ requestId, targetUrls: targets('a') })).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
