import type { StatisticsExport } from '@/entities/short-link/export'

/** Starts a browser download and releases its temporary DOM and object URL even on failure. */
export function downloadCsv(descriptor: StatisticsExport) {
  const anchor = document.createElement('a')
  const url = URL.createObjectURL(new Blob([descriptor.content], { type: descriptor.contentType }))
  try {
    anchor.href = url
    anchor.download = descriptor.fileName
    document.body.appendChild(anchor)
    anchor.click()
  } finally {
    try { URL.revokeObjectURL(url) } finally { anchor.remove() }
  }
}
