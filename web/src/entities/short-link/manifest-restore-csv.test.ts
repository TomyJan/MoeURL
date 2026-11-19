import { describe, expect, it } from 'vitest'
import { MANIFEST_RESTORE_CSV_MAX_BYTES, parseManifestRestoreCsv } from './manifest-restore-csv'

const header = 'id,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username'

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function row(index = 1, overrides: Record<string, string> = {}): string {
  const slug = overrides.slug ?? `doc${String(index).padStart(3, '0')}`
  const values: Record<string, string> = {
    id: 'a1111111-1111-4111-8111-111111115601',
    short_url: `https://go.example/${slug}`,
    slug,
    target_url: 'https://target.example/path',
    title: 'Saved title',
    tags: '["docs","saved"]',
    status: 'active',
    redirect_mode: 'direct',
    intermediate_delay_seconds: '5',
    expires_at: '',
    password_enabled: 'false',
    max_visits: '',
    visits_used: '8',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    owner_id: 'a1111111-1111-4111-8111-111111115602',
    owner_username: 'old-owner',
    ...overrides,
  }
  return Object.values(values).map(cell).join(',')
}

function manifest(rows: string[], ending = '\r\n'): string {
  return `${header}${ending}${rows.join(ending)}`
}

function parseIssue(text: string) {
  const result = parseManifestRestoreCsv(text)
  return result.success ? undefined : result.issue
}

describe('parseManifestRestoreCsv', () => {
  it('rejects bare CR inside a quoted JSON field while accepting CRLF whitespace', () => {
    expect(parseManifestRestoreCsv(manifest([row(1, { tags: '["docs",\r"saved"]' })]))).toMatchObject({ success: false, issue: { kind: 'syntax', record: 2 } })
    expect(parseManifestRestoreCsv(manifest([row(1, { tags: '["docs",\r\n"saved"]' })])).success).toBe(true)
  })

  it.each(['2099-01-01T00:00:00.0Z', '2099-01-01T00:00:00.120Z', '0000-01-01T00:00:00Z'])('rejects noncanonical UTC timestamps: %s', expires_at => {
    expect(parseIssue(manifest([row(1, { expires_at })]))?.field).toBe('expires_at')
  })

  it.each(['2099-01-01T00:00:00Z', '2099-01-01T00:00:00.1Z', '2099-01-01T00:00:00.000000001Z'])('accepts canonical UTC precision: %s', expires_at => {
    expect(parseManifestRestoreCsv(manifest([row(1, { expires_at })])).success).toBe(true)
  })

  it('accepts the exact export protocol and discards historical identity and usage', () => {
    const parsed = parseManifestRestoreCsv(`\uFEFF${manifest([row()])}`)
    expect(parsed).toEqual({ success: true, data: [{
      domainOrigin: 'https://go.example', slug: 'doc001', targetUrl: 'https://target.example/path',
      title: 'Saved title', tags: ['docs', 'saved'], status: 'active', redirectMode: 'direct',
      intermediateDelaySeconds: '5', expiresAt: '', maxVisits: '',
    }] })
  })

  it('supports standard quotes, commas, escaped quotes, and formula-prefix preservation', () => {
    const title = "'=SUM(1,1), quoted \"text\""
    const parsed = parseManifestRestoreCsv(manifest([row(1, { title, target_url: 'https://target.example/a,b' })], '\n'))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data[0]).toMatchObject({ title, targetUrl: 'https://target.example/a,b' })
  })

  it('scans quoted newlines as one record before rejecting the invalid exported field', () => {
    const parsed = parseManifestRestoreCsv(manifest([row(1, { owner_username: 'old\nowner' })]))
    expect(parsed).toMatchObject({ success: false, issue: { kind: 'field', record: 2, field: 'owner_username' } })
  })

  it('accepts one and one hundred rows but rejects zero and one hundred one', () => {
    expect(parseManifestRestoreCsv(manifest([row()])).success).toBe(true)
    expect(parseManifestRestoreCsv(manifest(Array.from({ length: 100 }, (_, index) => row(index)))).success).toBe(true)
    expect(parseManifestRestoreCsv(header)).toEqual({ success: false })
    expect(parseManifestRestoreCsv(manifest(Array.from({ length: 101 }, (_, index) => row(index)))).success).toBe(false)
  })

  it('rejects any header order or width that differs from the fixed export', () => {
    expect(parseManifestRestoreCsv(manifest([row()]).replace('short_url,slug', 'slug,short_url'))).toMatchObject({
      success: false, issue: { kind: 'header', record: 1 },
    })
    expect(parseManifestRestoreCsv(manifest([`${row()},extra`]))).toMatchObject({ success: false, issue: { kind: 'width' } })
    expect(parseManifestRestoreCsv(manifest([row().slice(0, row().lastIndexOf(','))]))).toMatchObject({
      success: false, issue: { kind: 'width', record: 2 },
    })
  })

  it('rejects password rows, malformed values, and duplicate slugs atomically', () => {
    expect(parseManifestRestoreCsv(manifest([row(1, { password_enabled: 'true' })]))).toMatchObject({
      success: false, issue: { kind: 'field', field: 'password_enabled' },
    })
    expect(parseManifestRestoreCsv(manifest([row(1, { tags: '["", "bad"]' })])).success).toBe(false)
    expect(parseManifestRestoreCsv(manifest([row(1, { status: 'enabled' })])).success).toBe(false)
    expect(parseManifestRestoreCsv(manifest([row(1), row(2, { slug: 'doc001', short_url: 'https://go.example/doc001' })]))).toMatchObject({
      success: false, issue: { kind: 'duplicate', record: 3, field: 'slug' },
    })
  })

  it('derives each origin from short_url without claiming live domain authorization', () => {
    const parsed = parseManifestRestoreCsv(manifest([row(1, { short_url: 'https://other.example/doc001' })]))
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data[0]?.domainOrigin).toBe('https://other.example')
  })

  it('rejects malformed framing, unpaired surrogates, and files over eight MiB', () => {
    expect(parseManifestRestoreCsv(`${header}\r${row()}`).success).toBe(false)
    expect(parseManifestRestoreCsv(manifest([row()]) + '\ud800').success).toBe(false)
    expect(parseManifestRestoreCsv(manifest([row()]) + 'x'.repeat(MANIFEST_RESTORE_CSV_MAX_BYTES))).toMatchObject({
      success: false, issue: { kind: 'size', record: 1 },
    })
  })

  it.each([
    ['id', { id: 'bad' }],
    ['id', { owner_id: 'bad' }],
    ['slug', { slug: 'api' }],
    ['short_url', { short_url: 'https://user:pass@go.example/doc001' }],
    ['short_url', { short_url: 'https://go.example/doc001?query=1' }],
    ['short_url', { short_url: 'https://go.example/other' }],
    ['target_url', { target_url: 'not a URL' }],
    ['target_url', { target_url: 'https://target.example/\u0001' }],
    ['title', { title: 'x'.repeat(121) }],
    ['title', { title: 'bad\u0001title' }],
    ['tags', { tags: '{' }],
    ['tags', { tags: '{}' }],
    ['tags', { tags: JSON.stringify(Array.from({ length: 11 }, (_, i) => `tag${i}`)) }],
    ['tags', { tags: '[1]' }],
    ['tags', { tags: '["same", " same "]' }],
    ['tags', { tags: '["bad\\u0001"]' }],
    ['tags', { tags: JSON.stringify(['x'.repeat(33)]) }],
    ['status', { status: 'paused' }],
    ['redirect_mode', { redirect_mode: 'unknown' }],
    ['intermediate_delay_seconds', { intermediate_delay_seconds: '03' }],
    ['intermediate_delay_seconds', { redirect_mode: 'intermediate', intermediate_delay_seconds: '2' }],
    ['intermediate_delay_seconds', { redirect_mode: 'intermediate', intermediate_delay_seconds: '11' }],
    ['expires_at', { expires_at: '2026-02-30T00:00:00Z' }],
    ['max_visits', { max_visits: '0' }],
    ['max_visits', { max_visits: '2147483648' }],
    ['snapshot', { visits_used: '-1' }],
    ['snapshot', { created_at: 'yesterday' }],
    ['owner_username', { owner_username: '' }],
    ['owner_username', { owner_username: 'bad\u0001name' }],
  ] as const)('rejects invalid %s fields', (field, overrides) => {
    expect(parseIssue(manifest([row(1, overrides)]))?.field).toBe(field)
  })

  it('covers UTF-16 pairs, URL schemes, timestamp precision, bounded visits, and all row states', () => {
    for (const redirect_mode of ['confirmation', 'intermediate']) {
      expect(parseManifestRestoreCsv(manifest([row(1, { redirect_mode, intermediate_delay_seconds: redirect_mode === 'intermediate' ? '3' : '5' })])).success).toBe(true)
    }
    expect(parseManifestRestoreCsv(manifest([row(1, { title: 'linked \ud83d\ude00', expires_at: '2026-10-01T00:00:00.123Z', max_visits: '2147483647' })])).success).toBe(true)
    expect(parseIssue(manifest([row(1, { short_url: 'ftp://go.example/doc001' })]))?.field).toBe('short_url')
    expect(parseIssue(manifest([row(1, { short_url: 'https://go.example/doc001#fragment' })]))?.field).toBe('short_url')
    expect(parseManifestRestoreCsv(manifest([row(1, { target_url: 'https://target.example/path#part' })])).success).toBe(true)
    expect(parseIssue(manifest([row(1, { intermediate_delay_seconds: '9007199254740992' })]))?.field).toBe('intermediate_delay_seconds')
    expect(parseIssue(manifest([row(1, { max_visits: '12345678901' })]))?.field).toBe('max_visits')
    expect(parseIssue(manifest([row(1, { expires_at: '2026-10-01T00:00:00.1234567890Z' })]))?.field).toBe('expires_at')
  })

  it('rejects invalid scanner states and malformed row framing', () => {
    const valid = row()
    expect(parseIssue(`${header}\n${valid.slice(0, 5)}"${valid.slice(5)}`)?.kind).toBe('syntax')
    expect(parseIssue(`${header}\n"x"tail,${valid.slice(valid.indexOf(',') + 1)}`)?.kind).toBe('syntax')
    expect(parseIssue(`${header}\n${valid.slice(0, valid.lastIndexOf(','))},"unterminated`)?.kind).toBe('syntax')
    expect(parseManifestRestoreCsv(`${header}\n${valid}\r`)).toMatchObject({ success: false, issue: { kind: 'syntax' } })
    expect(parseIssue(`${header}\n${valid}\n${valid.replace('doc001', 'doc002')},extra`)?.kind).toBe('width')
    expect(parseIssue(`${header}\n${valid},extra\n`)?.kind).toBe('width')
    expect(parseIssue(manifest(Array.from({ length: 102 }, (_, index) => row(index)), '\n') + '\n')?.kind).toBe('width')
  })

  it('rejects extra columns before a record separator and accepts a terminal line ending', () => {
    expect(parseIssue(`${header}\n${'x,'.repeat(18)}`)?.kind).toBe('width')
    expect(parseManifestRestoreCsv(manifest([row()], '\n') + '\n').success).toBe(true)
  })

  it('rejects Unicode low surrogates in CSV input', () => {
    expect(parseManifestRestoreCsv(`${header}\n${row()}\udc00`).success).toBe(false)
  })

  it('rejects tags over the item limit', () => {
    expect(parseManifestRestoreCsv(manifest([row(1, { tags: JSON.stringify(['saved', 'docs']) })])).success).toBe(true)
    expect(parseManifestRestoreCsv(manifest([row(1, { tags: JSON.stringify(['x'.repeat(32)]) })])).success).toBe(true)
  })
})
