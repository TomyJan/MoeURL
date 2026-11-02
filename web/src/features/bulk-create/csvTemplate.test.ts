import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv } from '@/entities/short-link/bulk-create-csv'
import { bulkCreateCsvTemplate } from './csvTemplate'

describe('bulk creation CSV template', () => {
  // Broken CSV quoting or an export-only format must not produce a usable import template.
  it('imports the downloaded public sample as two exact ordered targets', () => {
    expect(parseBulkCreateCsv(bulkCreateCsvTemplate.content)).toEqual({
      success: true,
      data: ['https://example.com/one', 'https://example.org/search?q=a,b'],
    })
  })
})
