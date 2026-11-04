export const SHORT_LINK_PAGE_SIZES = [20, 50, 100] as const
export const DEFAULT_SHORT_LINK_PAGE_SIZE = SHORT_LINK_PAGE_SIZES[0]
export type ShortLinkPageSize = (typeof SHORT_LINK_PAGE_SIZES)[number]

/** Accepts only the finite numeric page sizes supported by the list controls. */
export function isShortLinkPageSize(value: unknown): value is ShortLinkPageSize {
  return SHORT_LINK_PAGE_SIZES.some(size => size === value)
}
