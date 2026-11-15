export const BULK_CSV_MAX_BYTES = 65536
export type BulkCreateCsvIssue = { kind: 'header' | 'syntax' | 'width'; record: number }
export type CsvScanFailure = { success: false; issue?: BulkCreateCsvIssue }
type CsvScanResult = { success: true; records: string[][] } | CsvScanFailure

/** Scans the bounded CSV grammar shared by standard imports and explicit column mapping. */
export function scanBulkCreateCsv(text: string): CsvScanResult {
  const invalid: CsvScanFailure = { success: false }
  if (/[\uD800-\uDFFF]/u.test(text) || new TextEncoder().encode(text).byteLength > BULK_CSV_MAX_BYTES) return invalid
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text
  const rows: string[][] = []
  const structural = (kind: BulkCreateCsvIssue['kind'], record = rows.length + 1): CsvScanFailure => record <= 21 ? { success: false, issue: { kind, record } } : invalid
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
      else return structural('syntax')
    } else if (character === ',') {
      fields.push(field); field = ''; state = 'start'
      if (fields.length > 7) return structural(rows.length === 0 ? 'header' : 'width')
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[++i] !== '\n') return structural('syntax')
      rows.push([...fields, field])
      if (rows.length > 21) return invalid
      fields = []; field = ''; state = 'start'; endedRecord = true
    } else {
      if (state === 'closed') return structural('syntax')
      field += character; state = 'plain'
    }
  }
  if (state === 'quoted') return structural('syntax')
  if (!endedRecord) rows.push([...fields, field])
  return { success: true, records: rows }
}
