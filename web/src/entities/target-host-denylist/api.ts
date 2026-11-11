import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'
import { normalizeFooterLinkURL } from '@/entities/footer-links/api'

export const adminTargetHostDenylistKey = ['target-host-denylist', 'admin'] as const

/** Validates DNS input locally; only the server canonicalizes the saved document. */
export function normalizeTargetPolicyHost(raw: string): string {
  if (/\p{Cc}/u.test(raw)) throw new Error('Control character in target host')
  const trimmed = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, '')
  if (trimmed.length > 253 || !/^[ -~]*$/.test(trimmed)) throw new Error('Expected ASCII target host')
  const host = trimmed.toLowerCase().replace(/[.]$/, '')
  // The existing strict URL validator checks labels, numeric ambiguity and ACE
  // round-trips. A literal DNS host cannot use its canonical IPv4 exception.
  if (/^[0-9]+$|^0x[a-f0-9]*$/.test(host.split('.').at(-1)!)) throw new Error('Numeric target host')
  normalizeFooterLinkURL('https://' + host)
  if (!/^[a-z0-9.-]+$/.test(host)) throw new Error('Expected host without URL syntax')
  return host
}
const rawHost = z.string().refine(value => {
  try { normalizeTargetPolicyHost(value); return true } catch { return false }
})
const hosts = z.array(rawHost).max(100).refine(values => {
  try { return new Set(values.map(normalizeTargetPolicyHost)).size === values.length } catch { return false }
})
const revision = z.iso.datetime({ offset: true }).refine(value => {
  const fraction = value.match(/[.]([0-9]+)/)?.[1] ?? ''
  return !value.startsWith('0000-') && !/[1-9]/.test(fraction.slice(6))
    && (Date.parse(value) !== -62135596800000 || /[1-9]/.test(fraction))
})
export const TargetHostDenylistSchema = z.strictObject({
  hosts: hosts.refine(values => {
    try { return values.every((value, index) => normalizeTargetPolicyHost(value) === value && (index === 0 || values[index - 1]! < value)) } catch { return false }
  }),
  updatedAt: revision,
})
export const UpdateTargetHostDenylistSchema = z.strictObject({ hosts, expectedUpdatedAt: revision })
export type TargetHostDenylist = z.infer<typeof TargetHostDenylistSchema>
export type UpdateTargetHostDenylist = z.input<typeof UpdateTargetHostDenylistSchema>

/** Loads the independent administrator resource without projecting its revision. */
export async function getTargetHostDenylist(): Promise<TargetHostDenylist> {
  return TargetHostDenylistSchema.parse((await apiGet<unknown>('/admin/system/target-host-denylist')).data)
}
/** Sends one raw, complete replacement; the response is the canonical authority. */
export async function updateTargetHostDenylist(input: UpdateTargetHostDenylist): Promise<TargetHostDenylist> {
  return TargetHostDenylistSchema.parse((await apiPost<unknown>('/admin/system/target-host-denylist/update', UpdateTargetHostDenylistSchema.parse(input))).data)
}
