/** Fixed local encoding levels; M preserves the original download behavior. */
export const qrCorrectionLevels = [
  { key: 'M', labelKey: 'shortLinkQr.correctionLevels.M' },
  { key: 'Q', labelKey: 'shortLinkQr.correctionLevels.Q' },
  { key: 'H', labelKey: 'shortLinkQr.correctionLevels.H' },
] as const

export type QrCorrectionLevel = (typeof qrCorrectionLevels)[number]['key']
