import { bulkCreateTitlesInputSchema, bulkCreateMetadataInputSchema, bulkCreateTargetsSchema, type BulkCreateItem, type BulkCreateMetadataItem } from './bulk-create'

export const BULK_CSV_MAX_BYTES = 65536
type CsvResult = { success: true; data: string[] } | { success: false }
type ImportResult = { success: true; mode: 'targets'; data: string[] } | { success: true; mode: 'titles'; data: BulkCreateItem[] } | { success: true; mode: 'metadata'; data: BulkCreateMetadataItem[] } | { success: false }

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
  const rows: string[][] = []
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
      if (fields.length > 2) return invalid
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
  if (header.length === 1 && header[0] === 'target_url' && rows.every(row => row.length === 1)) {
    const parsed = bulkCreateTargetsSchema.safeParse(rows.map(row => row[0]!))
    return parsed.success ? { success: true, mode: 'targets', data: parsed.data } : invalid
  }
  if (header.length === 3 && header[0] === 'target_url' && header[1] === 'title' && header[2] === 'tags' && rows.every(row => row.length === 3)) {
    try {
      const items = rows.map(row => ({ targetUrl: row[0]!, title: row[1]!, tags: JSON.parse(row[2]!) as unknown }))
      const parsed = bulkCreateMetadataInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items })
      return parsed.success ? { success: true, mode: 'metadata', data: parsed.data.items } : invalid
    } catch { return invalid }
  }
  if (header.length !== 2 || header[0] !== 'target_url' || header[1] !== 'title' || rows.some(row => row.length !== 2)) return invalid
  // UUIDs always occupy 36 ASCII bytes; validate the complete future wire body before replacing a draft.
  const parsed = bulkCreateTitlesInputSchema.safeParse({ requestId: '11111111-1111-4111-8111-111111111111', items: rows.map(row => ({ targetUrl: row[0]!, title: row[1]! })) })
  return parsed.success ? { success: true, mode: 'titles', data: parsed.data.items } : invalid
}
