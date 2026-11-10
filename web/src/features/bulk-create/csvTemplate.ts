/** Public sample shared by the on-screen format help and the downloadable file. */
export const bulkCreateCsvExample = 'target_url\nhttps://example.com/one\n"https://example.org/search?q=a,b"'

export const bulkCreateCsvTemplate = {
  fileName: 'moeurl-target-urls-template.csv',
  contentType: 'text/csv;charset=utf-8' as const,
  content: '\uFEFF' + bulkCreateCsvExample.replaceAll('\n', '\r\n') + '\r\n',
}

export const bulkCreateTitlesCsvExample = 'target_url,title\nhttps://example.com/one,Example title\n"https://example.org/search?q=a,b","Title, with comma"'
export const bulkCreateTitlesCsvTemplate = {
  fileName: 'moeurl-titles-template.csv',
  contentType: 'text/csv;charset=utf-8' as const,
  content: '\uFEFF' + bulkCreateTitlesCsvExample.replaceAll('\n', '\r\n') + '\r\n',
}
