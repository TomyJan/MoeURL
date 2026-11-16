import { parseBulkCreateRecordsDetailed } from './bulk-create-csv'
import { scanBulkCreateCsv, type CsvScanFailure } from './bulk-create-csv-scan'

type MappingTable = { success: true; headers: string[]; rows: string[][] } | CsvScanFailure
type MappingInspection = { success: true; headers: readonly string[] } | CsvScanFailure
type MappingField = 'target' | 'title' | 'tags' | 'customSlug' | 'redirectMode' | 'expiresAt' | 'maxVisits' | 'intermediateDelaySeconds'
type ColumnSelection = Partial<Record<Exclude<MappingField, 'target'>, number | null>> & { target: number | null }
export type MappedImport = Exclude<ReturnType<typeof parseBulkCreateRecordsDetailed>, { success: false }> | { success: false }
const fieldHeaders: Record<MappingField, string> = {
  target: 'target_url', title: 'title', tags: 'tags', customSlug: 'custom_slug', redirectMode: 'redirect_mode',
  expiresAt: 'expires_at', maxVisits: 'max_visits', intermediateDelaySeconds: 'intermediate_delay_seconds',
}
const orderedFields: readonly MappingField[] = ['target', 'title', 'tags', 'customSlug', 'redirectMode', 'expiresAt', 'maxVisits', 'intermediateDelaySeconds']

/** Requires a complete rectangular data table without interpreting arbitrary header names. */
function readMappingTable(text: string): MappingTable {
  if (text.startsWith('\uFEFF\uFEFF')) return { success: false }
  const scanned = scanBulkCreateCsv(text)
  if (!scanned.success) return scanned
  const [headers, ...rows] = scanned.records
  if (rows.length < 1 || rows.length > 20) return { success: false }
  const invalidWidth = rows.findIndex(row => row.length !== headers!.length)
  if (invalidWidth !== -1) return { success: false, issue: { kind: 'width', record: invalidWidth + 2 } }
  return { success: true, headers: headers!, rows }
}

/** Exposes only local column labels; data cells stay private until an explicit projection. */
export function inspectBulkCreateCsvMapping(text: string): MappingInspection {
  const table = readMappingTable(text)
  return table.success ? { success: true, headers: Object.freeze([...table.headers]) } : table
}

/** Projects only the explicitly selected columns through the existing bounded write schemas. */
export function parseBulkCreateMappedCsv(text: string, columns: ColumnSelection): MappedImport {
  const invalid: MappedImport = { success: false }
  const table = readMappingTable(text)
  if (!table.success) return invalid
  const valid = (value: number | null): value is number => value !== null && Number.isInteger(value) && value >= 0 && value < table.headers.length
  const indexes = orderedFields.map(field => ({ field, index: columns[field] ?? null }))
  if (!valid(indexes[0]!.index) || indexes.slice(1).some(({ index }) => index !== null && !valid(index))) return invalid
  const selectedIndexes = indexes.flatMap(({ index }) => index === null ? [] : [index])
  if (new Set(selectedIndexes).size !== selectedIndexes.length) return invalid

  const lastSelected = indexes.reduce((last, { index }, position) => index === null ? last : position, 0)
  const projectedHeaders = orderedFields.slice(0, lastSelected + 1).map(field => fieldHeaders[field])
  const projectedRows = table.rows.map(row => indexes.slice(0, lastSelected + 1).map(({ field, index }) => {
    if (index !== null) return row[index]!
    return field === 'tags' ? '[]' : ''
  }))
  const parsed = parseBulkCreateRecordsDetailed([projectedHeaders, ...projectedRows])
  return parsed.success ? parsed : invalid
}
