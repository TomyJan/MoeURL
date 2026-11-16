import { describe, expect, it } from 'vitest'
import { parseBulkCreateMappedCsv } from './bulk-create-csv-mapping'

describe('complete explicit CSV field mapping', () => {
  const record = (values: readonly string[]) => values.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')
  it('routes a selected custom slug through the existing custom-slug protocol', () => {
    const text = 'Address,Short code,Private\nhttps://example.com/a,docs,do-not-upload'
    const columns = { target: 0, title: null, tags: null, customSlug: 1 }

    expect(parseBulkCreateMappedCsv(text, columns)).toEqual({
      success: true,
      mode: 'custom-slugs',
      data: [{ targetUrl: 'https://example.com/a', title: '', tags: [], customSlug: 'docs' }],
    })
  })

  it('supports every optional-field subset while preserving the selected protocol and defaults', () => {
    const fields = ['title', 'tags', 'customSlug', 'redirectMode', 'expiresAt', 'maxVisits', 'intermediateDelaySeconds'] as const
    const values = ['Literal title', '["docs"]', 'short7', 'intermediate', '2030-01-02T03:04:05Z', '9', '3']
    const modes = ['targets', 'titles', 'metadata', 'custom-slugs', 'redirect-modes', 'expirations', 'visit-limits', 'countdowns']

    for (let mask = 0; mask < 128; mask++) {
      const selected = fields.map((field, rank) => ({ field, rank, index: rank + 1 })).filter(({ rank }) => mask & (1 << rank)).reverse()
      const headers = ['URL', ...selected.map(({ field }) => field)]
      const row = ['https://example.com/subset', ...selected.map(({ rank }) => values[rank]!)]
      const columns: Parameters<typeof parseBulkCreateMappedCsv>[1] = { target: 0, title: null, tags: null, customSlug: null, redirectMode: null, expiresAt: null, maxVisits: null, intermediateDelaySeconds: null }
      for (let i = 0; i < selected.length; i++) columns[selected[i]!.field] = i + 1
      const text = record(headers) + '\n' + record(row)
      const highest = selected.reduce((max, field) => Math.max(max, field.rank + 1), 0)

      if (mask & (1 << 6) && !(mask & (1 << 3))) {
        expect(parseBulkCreateMappedCsv(text, columns), `subset ${mask}`).toEqual({ success: false })
        continue
      }

      const mode = modes[highest]!
      const targetUrl = 'https://example.com/subset'
      const result = parseBulkCreateMappedCsv(text, columns)
      if (mode === 'targets') {
        expect(result, `subset ${mask}`).toEqual({ success: true, mode, data: [targetUrl] })
        continue
      }
      const item: Record<string, string | string[]> = { targetUrl, title: '', tags: [] }
      for (const { field, rank } of selected) {
        if (field === 'tags') item.tags = ['docs']
        else item[field === 'title' ? 'title' : field] = values[rank]!
      }
      for (const field of fields.slice(0, highest)) {
        if (field === 'tags' && !('tags' in item)) item.tags = []
        else if (!(field === 'tags') && !(field in item)) item[field] = ''
      }
      const properties = ['targetUrl', 'title', 'tags', 'customSlug', 'redirectMode', 'expiresAt', 'maxVisits', 'intermediateDelaySeconds'].slice(0, highest + 1)
      const expectedItem = Object.fromEntries(properties.map(property => [property, item[property] ?? (property === 'tags' ? [] : '')]))
      expect(result, `subset ${mask}`).toEqual({ success: true, mode, data: [expectedItem] })
    }
  })

  it.each([
    { field: 'title', columns: { target: 0, title: 1, tags: null, customSlug: 1 } },
    { field: 'tags', columns: { target: 0, title: null, tags: 1, customSlug: 1 } },
    { field: 'customSlug', columns: { target: 0, title: null, tags: null, customSlug: 1, redirectMode: 1 } },
    { field: 'redirectMode', columns: { target: 0, title: null, tags: null, customSlug: null, redirectMode: 1, expiresAt: 1 } },
    { field: 'expiresAt', columns: { target: 0, title: null, tags: null, customSlug: null, redirectMode: null, expiresAt: 1, maxVisits: 1 } },
    { field: 'maxVisits', columns: { target: 0, title: null, tags: null, customSlug: null, redirectMode: null, expiresAt: null, maxVisits: 1, intermediateDelaySeconds: 1 } },
    { field: 'intermediateDelaySeconds', columns: { target: 0, title: null, tags: null, customSlug: null, redirectMode: null, expiresAt: null, maxVisits: null, intermediateDelaySeconds: 1 } },
  ])('rejects duplicate selected indexes involving $field', ({ columns }) => {
    expect(parseBulkCreateMappedCsv('a,b\nhttps://example.com/a,x', columns)).toEqual({ success: false })
  })

  it('keeps unselected secret cells out of every protocol result', () => {
    const text = 'URL,Secret,Code\nhttps://example.com/a,private-never-uploaded,doc7'
    const result = parseBulkCreateMappedCsv(text, { target: 0, title: null, tags: null, customSlug: 2 })
    expect(result).toEqual({ success: true, mode: 'custom-slugs', data: [{ targetUrl: 'https://example.com/a', title: '', tags: [], customSlug: 'doc7' }] })
    expect(JSON.stringify(result)).not.toContain('private-never-uploaded')
  })
})
