import { bulkCreateVisitLimitsInputSchema, type BulkCreateVisitLimitItem, bulkCreateExpirationsInputSchema, type BulkCreateExpirationItem, bulkCreateRedirectModesInputSchema, type BulkCreateRedirectModeItem, bulkCreateTitlesInputSchema, bulkCreateMetadataInputSchema, bulkCreateCustomSlugsInputSchema, bulkCreateTargetsSchema, type BulkCreateItem, type BulkCreateMetadataItem, type BulkCreateCustomSlugItem } from './bulk-create'

import { bulkCreateCountdownsInputSchema, type BulkCreateCountdownItem } from './bulk-create'
import { scanBulkCreateCsv, type BulkCreateCsvIssue } from './bulk-create-csv-scan'

export { BULK_CSV_MAX_BYTES, type BulkCreateCsvIssue } from './bulk-create-csv-scan'
type CsvResult = { success: true; data: string[] } | { success: false }
type ImportResult = { success: true; mode: 'targets'; data: string[] } | { success: true; mode: 'titles'; data: BulkCreateItem[] } | { success: true; mode: 'metadata'; data: BulkCreateMetadataItem[] } | { success: true; mode: 'custom-slugs'; data: BulkCreateCustomSlugItem[] } | { success: true; mode: 'redirect-modes'; data: BulkCreateRedirectModeItem[] } | { success: true; mode: 'expirations'; data: BulkCreateExpirationItem[] } | { success: true; mode: 'visit-limits'; data: BulkCreateVisitLimitItem[] } | { success: true; mode: 'countdowns'; data: BulkCreateCountdownItem[] } | { success: false }

/** Preserves the legacy one-column consumer contract. */
export function parseBulkCreateCsv(text: string): CsvResult {
  const result = parseBulkCreateImportCsv(text)
  return result.success && result.mode === 'targets' ? { success: true, data: result.data } : { success: false }
}

export type DetailedImportResult = Exclude<ImportResult, { success: false }> | { success: false; issue?: BulkCreateCsvIssue }

/** Keeps the original exact result shape for existing import consumers. */
export function parseBulkCreateImportCsv(text: string): ImportResult {
  const result = parseBulkCreateImportCsvDetailed(text)
  return result.success ? result : { success: false }
}

/** Reads strict CSV and reports bounded structure issues without exposing raw input. */
export function parseBulkCreateImportCsvDetailed(text: string): DetailedImportResult {
  const invalid: DetailedImportResult = { success: false }
  const scanned = scanBulkCreateCsv(text)
  if (!scanned.success) return scanned
  let rows = scanned.records
  const structural = (kind: BulkCreateCsvIssue['kind'], record = rows.length + 1): DetailedImportResult => record <= 21 ? { success: false, issue: { kind, record } } : invalid
  const header = rows.shift()!
  const standard = ['target_url', 'title', 'tags', 'custom_slug', 'redirect_mode', 'expires_at', 'max_visits', 'intermediate_delay_seconds']
  if (!header.includes('target_url') || new Set(header).size !== header.length || header.some(name => !standard.includes(name))) return structural('header', 1)
  const invalidWidth = rows.findIndex(row => row.length !== header.length)
  if (invalidWidth !== -1) return structural('width', invalidWidth + 2)
  const width = Math.max(...header.map(name => standard.indexOf(name))) + 1
  const positions = standard.slice(0, width).map(name => header.indexOf(name))
  // Read the original row once: in-place swaps would overwrite values still needed by other columns.
  // Only absent predecessor columns get defaults; present invalid cells still reach the original schema.
  rows = rows.map(row => positions.map((index, column) => index === -1 ? (column === 2 ? '[]' : '') : row[index]!))
  if (width === 8) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]!, expiresAt: row[5]!, maxVisits: row[6]!, intermediateDelaySeconds: row[7]! }))
      const parsed = bulkCreateCountdownsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'countdowns', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (width === 7) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]!, expiresAt: row[5]!, maxVisits: row[6]! }))
      const parsed = bulkCreateVisitLimitsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'visit-limits', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (width === 6) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]!, expiresAt: row[5]! }))
      const parsed = bulkCreateExpirationsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'expirations', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (width === 5) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]! }))
      const parsed = bulkCreateRedirectModesInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'redirect-modes', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (width === 4) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]! }))
      const parsed = bulkCreateCustomSlugsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'custom-slugs', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (width === 1) {
    const parsed = bulkCreateTargetsSchema.safeParse(rows.map(row => row[0]!))
    return parsed.success ? { success: true, mode: 'targets', data: parsed.data } : invalid
  }
  if (width === 3) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown }))
      const parsed = bulkCreateMetadataInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'metadata', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  // UUIDs always occupy 36 ASCII bytes; validate the complete future wire body before replacing a draft.
  const parsed = bulkCreateTitlesInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items: rows.map(row => ({ targetUrl: row[0]!, title: row[1]! })) })
  return parsed.success ? { success: true, mode: 'titles', data: parsed.data.items } : invalid
}
