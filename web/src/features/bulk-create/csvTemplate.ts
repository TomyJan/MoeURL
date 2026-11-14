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

export const bulkCreateMetadataCsvExample = 'target_url,title,tags\nhttps://example.com/one,Example title,"[""tools"",""a,b""]"\n"https://example.org/search?q=a,b","Title, with comma",[]'
export const bulkCreateMetadataCsvTemplate = {
  fileName: 'moeurl-metadata-template.csv',
  contentType: 'text/csv;charset=utf-8' as const,
  content: '\uFEFF' + bulkCreateMetadataCsvExample.replaceAll('\n', '\r\n') + '\r\n',
}

export const bulkCreateCustomSlugsCsvExample = 'target_url,title,tags,custom_slug\nhttps://example.com/one,Example title,"[""tools"",""a,b""]",TeamDocs56\n"https://example.org/search?q=a,b","Title, with comma",[],'
export const bulkCreateCustomSlugsCsvTemplate = {
  fileName: 'moeurl-custom-codes-template.csv',
  contentType: 'text/csv;charset=utf-8' as const,
  content: '\uFEFF' + bulkCreateCustomSlugsCsvExample.replaceAll('\n', '\r\n') + '\r\n',
}

export const bulkCreateRedirectModesCsvExample = 'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com/direct,Example title,"[""tools"",""a,b""]",TeamDocs74,direct\nhttps://example.com/intermediate,,[],,intermediate\nhttps://example.com/confirmation,,[],Confirm74,confirmation\nhttps://example.com/empty,,[],,'
export const bulkCreateRedirectModesCsvTemplate = {
  fileName: 'moeurl-redirect-modes-template.csv',
  contentType: 'text/csv;charset=utf-8' as const,
  content: '\uFEFF' + bulkCreateRedirectModesCsvExample.replaceAll('\n', '\r\n') + '\r\n',
}
