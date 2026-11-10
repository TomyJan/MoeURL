import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv, parseBulkCreateImportCsv } from '@/entities/short-link/bulk-create-csv'
import { bulkCreateCsvTemplate, bulkCreateTitlesCsvTemplate, bulkCreateMetadataCsvTemplate, bulkCreateCustomSlugsCsvTemplate } from './csvTemplate'

describe('bulk creation CSV template', () => {
  it('imports the custom-code template with literal metadata and one explicitly random row', () => {
    expect(parseBulkCreateImportCsv(bulkCreateCustomSlugsCsvTemplate.content)).toEqual({ success: true, mode: 'custom-slugs', data: [
      { targetUrl: 'https://example.com/one', title: 'Example title', tags: ['tools', 'a,b'], customSlug: 'TeamDocs56' },
      { targetUrl: 'https://example.org/search?q=a,b', title: 'Title, with comma', tags: [], customSlug: '' },
    ] })
  })
  it('imports the metadata template as exact titles and ordered JSON tags', () => {
    expect(parseBulkCreateImportCsv(bulkCreateMetadataCsvTemplate.content)).toEqual({ success: true, mode: 'metadata', data: [
      { targetUrl: 'https://example.com/one', title: 'Example title', tags: ['tools', 'a,b'] },
      { targetUrl: 'https://example.org/search?q=a,b', title: 'Title, with comma', tags: [] },
    ] })
  })
  it('imports the title template with both exact titles and a quoted URL', () => {
    expect(parseBulkCreateImportCsv(bulkCreateTitlesCsvTemplate.content)).toEqual({ success: true, mode: 'titles', data: [
      { targetUrl: 'https://example.com/one', title: 'Example title' },
      { targetUrl: 'https://example.org/search?q=a,b', title: 'Title, with comma' },
    ] })
  })
  // Broken CSV quoting or an export-only format must not produce a usable import template.
  it('imports the downloaded public sample as two exact ordered targets', () => {
    expect(parseBulkCreateCsv(bulkCreateCsvTemplate.content)).toEqual({
      success: true,
      data: ['https://example.com/one', 'https://example.org/search?q=a,b'],
    })
  })
})
