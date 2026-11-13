import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'
import { TargetHostDenylistSchema } from '@/entities/target-host-denylist/api'

export const adminTargetIPDenylistKey = ['target-ip-denylist', 'admin'] as const

/** Rejects browser-only short, octal, hexadecimal and zero-padded IPv4 spellings. */
function strictIPv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every(part => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)
}

/** Validates a literal address; only the server canonicalizes the saved document. */
export function normalizeTargetPolicyIP(raw: string): string {
  if (/\p{Cc}/u.test(raw)) throw new Error('Control character in target IP')
  const address = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
  if (!/^[0-9a-fA-F:.]+$/.test(address) || address.length > 45) throw new Error('Expected literal ASCII address')
  if (!address.includes(':')) {
    if (!strictIPv4(address)) throw new Error('Expected four decimal IPv4 octets')
    return address
  }
  // Validate dotted tails before URL can rewrite numeric aliases. Brackets,
  // zones, ports and all other URL syntax are excluded by the character check.
  if (address.includes('.') && !strictIPv4(address.slice(address.lastIndexOf(':') + 1))) throw new Error('Invalid IPv4 tail')
  const canonical = new URL('http://[' + address + ']/').hostname.slice(1, -1)
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical)
  if (!mapped) return canonical
  const high = Number.parseInt(mapped[1]!, 16), low = Number.parseInt(mapped[2]!, 16)
  return [high >>> 8, high & 255, low >>> 8, low & 255].join('.')
}

const rawAddress = z.string().refine(value => {
  try { normalizeTargetPolicyIP(value); return true } catch { return false }
})
const addresses = z.array(rawAddress).max(100).refine(values => {
  try { return new Set(values.map(normalizeTargetPolicyIP)).size === values.length } catch { return false }
})
const revision = TargetHostDenylistSchema.shape.updatedAt
export const TargetIPDenylistSchema = z.strictObject({
  addresses: addresses.refine(values => {
    try { return values.every((value, index) => normalizeTargetPolicyIP(value) === value && (index === 0 || values[index - 1]! < value)) } catch { return false }
  }),
  updatedAt: revision,
})
export const UpdateTargetIPDenylistSchema = z.strictObject({ addresses, expectedUpdatedAt: revision })
export type TargetIPDenylist = z.infer<typeof TargetIPDenylistSchema>
export type UpdateTargetIPDenylist = z.input<typeof UpdateTargetIPDenylistSchema>

/** Loads only the independent, complete administrator IP resource. */
export async function getTargetIPDenylist(): Promise<TargetIPDenylist> {
  return TargetIPDenylistSchema.parse((await apiGet<unknown>('/admin/system/target-ip-denylist')).data)
}
/** Sends raw rows and the exact revision once; the server owns canonical values. */
export async function updateTargetIPDenylist(input: UpdateTargetIPDenylist): Promise<TargetIPDenylist> {
  return TargetIPDenylistSchema.parse((await apiPost<unknown>('/admin/system/target-ip-denylist/update', UpdateTargetIPDenylistSchema.parse(input))).data)
}
