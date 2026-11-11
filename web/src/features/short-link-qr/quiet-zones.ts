/** Fixed white borders preserve the original minimum and offer more surrounding space. */
export const qrQuietZones = [
  { key: 4, labelKey: 'shortLinkQr.quietZones.standard' },
  { key: 8, labelKey: 'shortLinkQr.quietZones.wide' },
] as const

export type QrQuietZone = (typeof qrQuietZones)[number]['key']
