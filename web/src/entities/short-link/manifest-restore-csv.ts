export const MANIFEST_RESTORE_CSV_MAX_BYTES = 8 * 1024 * 1024

const manifestColumns = [
  'id', 'short_url', 'slug', 'target_url', 'title', 'tags', 'status', 'redirect_mode',
  'intermediate_delay_seconds', 'expires_at', 'password_enabled', 'max_visits', 'visits_used',
  'created_at', 'updated_at', 'owner_id', 'owner_username',
] as const

const reservedSlugs = new Set(['api', 'assets', 'icons', 'setup', 'login', 'profile', 'console', 'link', 'links', 'analytics', 'admin', 'go'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/

export type ManifestRestoreCsvItem = {
  domainOrigin: string
  slug: string
  targetUrl: string
  title: string
  tags: readonly string[]
  status: 'active' | 'disabled'
  redirectMode: 'direct' | 'intermediate' | 'confirmation'
  intermediateDelaySeconds: string
  expiresAt: string
  maxVisits: string
}

export type ManifestRestoreCsvIssue = {
  kind: 'size' | 'header' | 'syntax' | 'width' | 'field' | 'duplicate'
  record: number
  field?: string
}

export type ManifestRestoreParseResult =
  | { success: true; data: ManifestRestoreCsvItem[] }
  | { success: false; issue?: ManifestRestoreCsvIssue }

type ScanResult = { success: true; records: string[][] } | { success: false; record: number; kind: 'syntax' | 'width' }

/** Parses only the exact fixed management export and returns reconstructible values. */
export function parseManifestRestoreCsv(text: string): ManifestRestoreParseResult {
  const invalid: ManifestRestoreParseResult = { success: false }
  if (typeof text !== 'string' || hasUnpairedSurrogate(text)) return invalid
  if (new TextEncoder().encode(text).byteLength > MANIFEST_RESTORE_CSV_MAX_BYTES) {
    return { success: false, issue: { kind: 'size', record: 1 } }
  }

  const scanned = scanManifestCsv(text)
  if (!scanned.success) return { success: false, issue: { kind: scanned.kind, record: scanned.record } }
  const records = scanned.records
  if (records.length < 2 || records.length > 101) return invalid
  if (records[0]!.length !== manifestColumns.length || records[0]!.some((value, index) => value !== manifestColumns[index])) {
    return { success: false, issue: { kind: 'header', record: 1 } }
  }

  const result: ManifestRestoreCsvItem[] = []
  const seenSlugs = new Set<string>()
  for (let index = 1; index < records.length; index++) {
    const row = records[index]!
    const record = index + 1
    const parsed = parseManifestRow(row)
    if (!parsed.success) return { success: false, issue: { kind: 'field', record, field: parsed.field } }
    if (seenSlugs.has(parsed.item.slug)) return { success: false, issue: { kind: 'duplicate', record, field: 'slug' } }
    seenSlugs.add(parsed.item.slug)
    result.push(parsed.item)
  }
  return { success: true, data: result }
}

/** Scans RFC-style quoted fields, LF/CRLF records, and a single leading BOM. */
function scanManifestCsv(text: string): ScanResult {
  const input = text.startsWith('\uFEFF') ? text.slice(1) : text
  const records: string[][] = []
  let fields: string[] = []
  let field = ''
  let state: 'start' | 'plain' | 'quoted' | 'closed' = 'start'
  let endedRecord = false
  const record = () => records.length + 1
  const pushField = () => {
    fields.push(field)
    field = ''
    state = 'start'
  }

  for (let index = 0; index < input.length; index++) {
    const character = input[index]!
    endedRecord = false
    if (state === 'quoted') {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index++
        } else state = 'closed'
      } else field += character
      continue
    }
    if (character === '"') {
      if (state !== 'start') return { success: false, record: record(), kind: 'syntax' }
      state = 'quoted'
    } else if (character === ',') {
      if (state === 'closed' || state === 'plain') pushField()
      else pushField()
      if (fields.length > manifestColumns.length) return { success: false, record: record(), kind: 'width' }
    } else if (character === '\n' || character === '\r') {
      if (character === '\r') {
        if (input[index + 1] !== '\n') return { success: false, record: record(), kind: 'syntax' }
        index++
      }
      fields.push(field)
      records.push(fields)
      if (fields.length !== manifestColumns.length) return { success: false, record: records.length, kind: 'width' }
      if (records.length > 101) return { success: false, record: records.length, kind: 'width' }
      fields = []
      field = ''
      state = 'start'
      endedRecord = true
    } else {
      if (state === 'closed') return { success: false, record: record(), kind: 'syntax' }
      field += character
      state = 'plain'
    }
  }
  if (state === 'quoted') return { success: false, record: record(), kind: 'syntax' }
  if (!endedRecord) {
    fields.push(field)
    records.push(fields)
    if (fields.length !== manifestColumns.length) return { success: false, record: records.length, kind: 'width' }
  }
  return { success: true, records }
}

function parseManifestRow(row: string[]): { success: true; item: ManifestRestoreCsvItem } | { success: false; field: string } {
  const [id, shortUrl, slug, targetUrl, title, tagsText, status, redirectMode, delay, expiresAt, passwordEnabled, maxVisits, visitsUsed, createdAt, updatedAt, ownerId] = row
  if (!uuidPattern.test(id!) || !uuidPattern.test(ownerId!)) return { success: false, field: 'id' }
  if (!slugPattern.test(slug!) || reservedSlugs.has(slug!)) return { success: false, field: 'slug' }
  const link = safeUrl(shortUrl!)
  if (!link || link.search || link.hash || link.username || link.password || link.pathname !== `/${slug}` || !link.origin) {
    return { success: false, field: 'short_url' }
  }
  const target = safeUrl(targetUrl!)
  if (!target || hasControlCharacters(targetUrl!)) return { success: false, field: 'target_url' }
  if ([...title!.trim()].length > 120 || hasControlCharacters(title!)) return { success: false, field: 'title' }
  let tags: unknown
  try { tags = JSON.parse(tagsText!) } catch { return { success: false, field: 'tags' } }
  if (!Array.isArray(tags) || tags.length > 10 || tags.some(tag => typeof tag !== 'string' || tag.trim() === '' || [...tag.trim()].length > 32 || hasControlCharacters(tag.trim()))) {
    return { success: false, field: 'tags' }
  }
  const stringTags = tags as string[]
  if (new Set(stringTags.map(tag => tag.trim())).size !== stringTags.length) return { success: false, field: 'tags' }
  if (status !== 'active' && status !== 'disabled') return { success: false, field: 'status' }
  if (redirectMode !== 'direct' && redirectMode !== 'intermediate' && redirectMode !== 'confirmation') return { success: false, field: 'redirect_mode' }
  const delayNumber = parseCanonicalNonnegative(delay!)
  if (delayNumber === null || (redirectMode === 'intermediate' ? delayNumber < 3 || delayNumber > 10 : delayNumber !== 5)) return { success: false, field: 'intermediate_delay_seconds' }
  if (expiresAt !== '' && !isCanonicalUTC(expiresAt!)) return { success: false, field: 'expires_at' }
  if (passwordEnabled !== 'false') return { success: false, field: 'password_enabled' }
  if (maxVisits !== '' && !isPositiveInt32(maxVisits!)) return { success: false, field: 'max_visits' }
  if (!isCanonicalNonnegativeInteger(visitsUsed!) || !isCanonicalUTC(createdAt!) || !isCanonicalUTC(updatedAt!)) return { success: false, field: 'snapshot' }
  if (!row[16] || hasControlCharacters(row[16]!)) return { success: false, field: 'owner_username' }

  return {
    success: true,
    item: {
      domainOrigin: link.origin,
      slug: slug!,
      targetUrl: targetUrl!,
      title: title!,
      tags: tags as string[],
      status,
      redirectMode,
      intermediateDelaySeconds: delay!,
      expiresAt: expiresAt!,
      maxVisits: maxVisits!,
    },
  }
}

const slugPattern = /^[a-z0-9]{3,32}$/

function safeUrl(value: string): URL | null {
  try {
    const parsed = new URL(value)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) return null
    return parsed
  } catch {
    return null
  }
}

function parseCanonicalNonnegative(value: string): number | null {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isCanonicalNonnegativeInteger(value: string): boolean {
  return parseCanonicalNonnegative(value) !== null
}

function isPositiveInt32(value: string): boolean {
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 10) return false
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= 2_147_483_647
}

function isCanonicalUTC(value: string): boolean {
  if (!utcTimestampPattern.test(value)) return false
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value.slice(0, 19))
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true
  }
  return false
}
