/** Fixed output canvases; 320 preserves the existing default artifacts. */
export const qrExportSizes = [320, 640, 1024] as const

export type QrExportSize = (typeof qrExportSizes)[number]
