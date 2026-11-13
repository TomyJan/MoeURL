import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'
import { TargetHostDenylistSchema } from '@/entities/target-host-denylist/api'
import { normalizeTargetPolicyIP } from '@/entities/target-ip-denylist/api'

export const adminTargetCIDRDenylistKey = ['target-cidr-denylist', 'admin'] as const

/** Validates both families before clearing host bits with exact integer masks. */
export function normalizeTargetPolicyCIDR(raw: string): string {
  if (/\p{Cc}/u.test(raw)) throw new Error('Control character in target CIDR')
  const text = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
  const match = /^([0-9a-fA-F:.]+)\/(0|[1-9][0-9]{0,2})$/.exec(text)
  if (!match) throw new Error('Expected literal CIDR with decimal prefix length')
  const address = normalizeTargetPolicyIP(match[1]!)
  const ipv4 = !address.includes(':')
  if (ipv4 && match[1]!.includes(':')) throw new Error('Use IPv4 CIDR for mapped addresses')
  const width = ipv4 ? 32 : 128, bits = Number(match[2])
  if (bits > width) throw new Error('Prefix length exceeds address width')
  let value: bigint
  if (ipv4) value = address.split('.').reduce((total, octet) => (total << 8n) | BigInt(octet), 0n)
  else {
    const [first, last] = address.split('::')
    const leading = first!.split(':').filter(Boolean), trailing = last?.split(':').filter(Boolean) ?? []
    const words: string[] = [...leading, ...Array<string>(8 - leading.length - trailing.length).fill('0'), ...trailing]
    value = words.reduce((total, word) => (total << 16n) | BigInt('0x' + word), 0n)
  }
  const shift = BigInt(width - bits), masked = (value >> shift) << shift
  const network = ipv4
    ? [24, 16, 8, 0].map(bit => Number((masked >> BigInt(bit)) & 255n)).join('.')
    : new URL('http://[' + masked.toString(16).padStart(32, '0').match(/.{4}/g)!.join(':') + ']/').hostname.slice(1, -1)
  return network + '/' + bits
}

const rawPrefix = z.string().refine(value => {
  try { normalizeTargetPolicyCIDR(value); return true } catch { return false }
})
const prefixes = z.array(rawPrefix).max(100).refine(values => {
  try { return new Set(values.map(normalizeTargetPolicyCIDR)).size === values.length } catch { return false }
})
const revision = TargetHostDenylistSchema.shape.updatedAt
export const TargetCIDRDenylistSchema = z.strictObject({
  prefixes: prefixes.refine(values => {
    try { return values.every((value, index) => normalizeTargetPolicyCIDR(value) === value && (index === 0 || values[index - 1]! < value)) } catch { return false }
  }),
  updatedAt: revision,
})
export const UpdateTargetCIDRDenylistSchema = z.strictObject({ prefixes, expectedUpdatedAt: revision })
export type TargetCIDRDenylist = z.infer<typeof TargetCIDRDenylistSchema>
export type UpdateTargetCIDRDenylist = z.input<typeof UpdateTargetCIDRDenylistSchema>

/** Loads the independent complete administrator network resource. */
export async function getTargetCIDRDenylist(): Promise<TargetCIDRDenylist> {
  return TargetCIDRDenylistSchema.parse((await apiGet<unknown>('/admin/system/target-cidr-denylist')).data)
}
/** Keeps editable spelling intact; only the server canonicalizes a saved document. */
export async function updateTargetCIDRDenylist(input: UpdateTargetCIDRDenylist): Promise<TargetCIDRDenylist> {
  return TargetCIDRDenylistSchema.parse((await apiPost<unknown>('/admin/system/target-cidr-denylist/update', UpdateTargetCIDRDenylistSchema.parse(input))).data)
}
