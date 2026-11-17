export type CsvHeaderField = 'target' | 'title' | 'tags' | 'customSlug' | 'redirectMode' | 'expiration' | 'visitLimit' | 'countdown'
export type CsvHeaderSelection = Readonly<Record<CsvHeaderField, number | null>>
type Permissions = Readonly<{ title: boolean; tags: boolean; advanced: boolean }>

const aliases: ReadonlyArray<readonly [CsvHeaderField, readonly string[]]> = [
  ['target', ['target_url', 'url', '网址', '目标网址']],
  ['title', ['title', '标题']],
  ['tags', ['tags', '标签']],
  ['customSlug', ['custom_slug', 'slug', '自定义短码', '短码']],
  ['redirectMode', ['redirect_mode', '跳转方式']],
  ['expiration', ['expires_at', '过期时间']],
  ['visitLimit', ['max_visits', '最大访问次数']],
  ['countdown', ['intermediate_delay_seconds', '倒计时', '中间页倒计时']],
]

/** Suggests only unique, unoccupied, permitted columns after the user explicitly requests matching. */
export function matchCsvHeaderAliases(headers: readonly string[], selected: CsvHeaderSelection, permissions: Permissions, excluded: readonly CsvHeaderField[] = []): Partial<Record<CsvHeaderField, number>> {
  const normalized = headers.map(header => header.replace(/^[ \t]+|[ \t]+$/g, '').replace(/[A-Z]/g, letter => letter.toLowerCase()))
  const occupied = new Set(Object.values(selected).filter(index => index !== null))
  const matches: Partial<Record<CsvHeaderField, number>> = {}
  for (const [field, names] of aliases) {
    const permitted = field === 'target' || (field === 'title' || field === 'tags' ? permissions[field] : permissions.advanced)
    if (selected[field] !== null || !permitted || excluded.includes(field)) continue
    // Count all candidates before excluding occupied columns: occupancy must not resolve ambiguity.
    const candidates = normalized.flatMap((header, index) => names.includes(header) ? [index] : [])
    if (candidates.length !== 1 || occupied.has(candidates[0]!)) continue
    matches[field] = candidates[0]!
    occupied.add(candidates[0]!)
  }
  return matches
}
