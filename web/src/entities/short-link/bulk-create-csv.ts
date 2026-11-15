import { bulkCreateVisitLimitsInputSchema, type BulkCreateVisitLimitItem, bulkCreateExpirationsInputSchema, type BulkCreateExpirationItem, bulkCreateRedirectModesInputSchema, type BulkCreateRedirectModeItem, bulkCreateTitlesInputSchema, bulkCreateMetadataInputSchema, bulkCreateCustomSlugsInputSchema, bulkCreateTargetsSchema, type BulkCreateItem, type BulkCreateMetadataItem, type BulkCreateCustomSlugItem } from './bulk-create'

import { bulkCreateCountdownsInputSchema, type BulkCreateCountdownItem } from './bulk-create'

export const BULK_CSV_MAX_BYTES = 65536
type CsvResult = { success: true; data: string[] } | { success: false }
type ImportResult = { success: true; mode: 'targets'; data: string[] } | { success: true; mode: 'titles'; data: BulkCreateItem[] } | { success: true; mode: 'metadata'; data: BulkCreateMetadataItem[] } | { success: true; mode: 'custom-slugs'; data: BulkCreateCustomSlugItem[] } | { success: true; mode: 'redirect-modes'; data: BulkCreateRedirectModeItem[] } | { success: true; mode: 'expirations'; data: BulkCreateExpirationItem[] } | { success: true; mode: 'visit-limits'; data: BulkCreateVisitLimitItem[] } | { success: true; mode: 'countdowns'; data: BulkCreateCountdownItem[] } | { success: false }

/** Preserves the legacy one-column consumer contract. */
export function parseBulkCreateCsv(text: string): CsvResult {
  const result = parseBulkCreateImportCsv(text)
  return result.success && result.mode === 'targets' ? { success: true, data: result.data } : { success: false }
}

/** Reads strict CSV records without discarding or normalizing raw fields. */
export function parseBulkCreateImportCsv(text: string): ImportResult {
  const invalid: ImportResult = { success: false }
  if (/[\uD800-\uDFFF]/u.test(text) || new TextEncoder().encode(text).byteLength > BULK_CSV_MAX_BYTES) return invalid
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text
  let rows: string[][] = []
  let fields: string[] = [], field = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start', endedRecord = false
  for (let i = 0; i < input.length; i++) {
    const character = input[i]!
    endedRecord = false
    if (state === 'quoted') {
      if (character === '"') state = 'closed'
      else field += character
      continue
    }
    if (character === '"') {
      if (state === 'start') state = 'quoted'
      else if (state === 'closed') { field += '"'; state = 'quoted' }
      else return invalid
    } else if (character === ',') {
      fields.push(field); field = ''; state = 'start'
      if (fields.length > 7) return invalid
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[++i] !== '\n') return invalid
      rows.push([...fields, field])
      if (rows.length > 21) return invalid
      fields = []; field = ''; state = 'start'; endedRecord = true
    } else {
      if (state === 'closed') return invalid
      field += character; state = 'plain'
    }
  }
  if (state === 'quoted') return invalid
  if (!endedRecord) rows.push([...fields, field])
  const header = rows.shift()!
  const standard = ['target_url', 'title', 'tags', 'custom_slug', 'redirect_mode', 'expires_at', 'max_visits', 'intermediate_delay_seconds']
  const positions = standard.slice(0, header.length).map(name => header.indexOf(name))
  if (positions.includes(-1) || rows.some(row => row.length !== header.length)) return invalid
  // Read the original row once: in-place swaps would overwrite values still needed by other columns.
  rows = rows.map(row => positions.map(index => row[index]!))
  if (header.length === 8) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]!, expiresAt: row[5]!, maxVisits: row[6]!, intermediateDelaySeconds: row[7]! }))
      const parsed = bulkCreateCountdownsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'countdowns', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (header.length === 7) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]!, expiresAt: row[5]!, maxVisits: row[6]! }))
      const parsed = bulkCreateVisitLimitsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'visit-limits', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (header.length === 6) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]!, expiresAt: row[5]! }))
      const parsed = bulkCreateExpirationsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'expirations', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (header.length === 5) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]!, redirectMode: row[4]! }))
      const parsed = bulkCreateRedirectModesInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'redirect-modes', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (header.length === 4) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown, customSlug: row[3]! }))
      const parsed = bulkCreateCustomSlugsInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'custom-slugs', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (header.length === 1) {
    const parsed = bulkCreateTargetsSchema.safeParse(rows.map(row => row[0]!))
    return parsed.success ? { success: true, mode: 'targets', data: parsed.data } : invalid
  }
  if (header.length === 3) {
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
