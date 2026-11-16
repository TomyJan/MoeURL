import { bulkCreateMetadataInputSchema, bulkCreateTargetsSchema, bulkCreateTitlesInputSchema, type BulkCreateItem, type BulkCreateMetadataItem } from './bulk-create'
import { scanBulkCreateCsv, type CsvScanFailure } from './bulk-create-csv-scan'

type MappingTable = { success: true; headers: string[]; rows: string[][] } | CsvScanFailure
type MappingInspection = { success: true; headers: readonly string[] } | CsvScanFailure
type ColumnSelection = { target: number | null; title: number | null; tags?: number | null }
export type MappedImport = { success: true; mode: 'targets'; data: string[] } | { success: true; mode: 'titles'; data: BulkCreateItem[] } | { success: true; mode: 'metadata'; data: BulkCreateMetadataItem[] } | { success: false }

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
  const tags = columns.tags ?? null
  if (!valid(columns.target)
    || (columns.title !== null && (!valid(columns.title) || columns.title === columns.target))
    || (tags !== null && (!valid(tags) || tags === columns.target || tags === columns.title))) return invalid
  const target = columns.target, title = columns.title
  if (tags !== null) {
    const items = [] as { targetUrl: string; title: string; tags: unknown }[]
    for (const row of table.rows) {
      let parsedTags: unknown
      try { parsedTags = JSON.parse(row[tags]!) as unknown } catch { return invalid }
      items.push({ targetUrl: row[target]!, title: title === null ? '' : row[title]!, tags: parsedTags })
    }
    const parsed = bulkCreateMetadataInputSchema.safeParse({
      requestId: '11111111-1111-4111-8111-111111111111',
      items,
    })
    return parsed.success ? { success: true, mode: 'metadata', data: parsed.data.items } : invalid
  }
  if (title === null) {
    const parsed = bulkCreateTargetsSchema.safeParse(table.rows.map(row => row[target]!))
    if (!parsed.success || new TextEncoder().encode(JSON.stringify({
      requestId: '11111111-1111-4111-8111-111111111111', targetUrls: parsed.data,
    })).byteLength > 65536) return invalid
    return { success: true, mode: 'targets', data: parsed.data }
  }
  const parsed = bulkCreateTitlesInputSchema.safeParse({
    requestId: '11111111-1111-4111-8111-111111111111',
    items: table.rows.map(row => ({ targetUrl: row[target]!, title: row[title]! })),
  })
  return parsed.success ? { success: true, mode: 'titles', data: parsed.data.items } : invalid
}
