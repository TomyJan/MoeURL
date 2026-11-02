import { bulkCreateTargetsSchema } from './bulk-create'

export const BULK_CSV_MAX_BYTES = 65536
type CsvResult = { success: true; data: string[] } | { success: false }

/** Reads one strict CSV column without discarding records or normalizing target strings. */
export function parseBulkCreateCsv(text: string): CsvResult {
  const invalid: CsvResult = { success: false }
  if (new TextEncoder().encode(text).byteLength > BULK_CSV_MAX_BYTES) return invalid
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text
  const rows: string[] = []
  let field = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start', endedRecord = false
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
    } else if (character === ',') return invalid
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[++i] !== '\n') return invalid
      rows.push(field)
      if (rows.length > 21) return invalid
      field = ''; state = 'start'; endedRecord = true
    } else {
      if (state === 'closed') return invalid
      field += character; state = 'plain'
    }
  }
  if (state === 'quoted') return invalid
  if (!endedRecord) rows.push(field)
  if (rows.shift() !== 'target_url') return invalid
  const parsed = bulkCreateTargetsSchema.safeParse(rows)
  return parsed.success ? { success: true, data: parsed.data } : invalid
}
