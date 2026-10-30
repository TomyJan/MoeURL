import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'

export const publicFooterLinksKey = ['footer-links', 'public'] as const
export const adminFooterLinksKey = ['footer-links', 'admin'] as const
const controls = /\p{Cc}/u
const whitespace = /^\p{White_Space}+|\p{White_Space}+$/gu
/** Matches Go TrimSpace without removing BOM, which remains a counted label codepoint. */
const trim = (value: string) => value.replace(whitespace, '')
/** Rejects raw controls and lone UTF-16 surrogates before trimming can erase invalid input. */
const scalarText = (value: string) => !controls.test(value) && !/[\uD800-\uDFFF]/u.test(value)

/**
 * Decodes one lower-case ACE label using RFC 3492 sections 6.1–6.2, then
 * requires its Unicode form to round-trip through the platform IDNA parser.
 * ASCII-only URL fast paths may accept invalid ACE unchanged; ordinary ASCII
 * labels must not inherit IDNA's third/fourth-position hyphen restriction.
 */
function validateFooterACE(label: string): void {
  const input = label.slice(4), delimiter = input.lastIndexOf('-')
  const points = Array.from(input.slice(0, Math.max(0, delimiter)), value => value.charCodeAt(0))
  let cursor = delimiter < 0 ? 0 : delimiter + 1
  let codepoint = 128, index = 0, bias = 72
  while (cursor < input.length) {
    const previous = index
    let weight = 1
    for (let base = 36; ; base += 36) {
      const code = input.charCodeAt(cursor++)
      const digit = code >= 97 && code <= 122 ? code - 97 : code >= 48 && code <= 57 ? code - 22 : 36
      index += digit * weight
      if (digit === 36 || !Number.isSafeInteger(index)) throw new Error('Invalid footer ACE encoding')
      const threshold = Math.max(1, Math.min(26, base - bias))
      if (digit < threshold) break
      weight *= 36 - threshold
    }
    const count = points.length + 1
    let delta = Math.floor((index - previous) / (previous === 0 ? 700 : 2)), offset = 0
    delta += Math.floor(delta / count)
    while (delta > 455) { delta = Math.floor(delta / 35); offset += 36 }
    bias = offset + Math.floor(36 * delta / (delta + 38))
    codepoint += Math.floor(index / count)
    if (codepoint > 0x10ffff || codepoint >= 0xd800 && codepoint <= 0xdfff) throw new Error('Invalid footer ACE codepoint')
    index %= count
    points.splice(index++, 0, codepoint)
  }
  if (new URL('https://' + String.fromCodePoint(...points)).hostname !== label) throw new Error('Noncanonical footer ACE label')
}

/** Validates navigation syntax without resolving, fetching or rewriting the suffix. */
export function normalizeFooterLinkURL(input: string): string {
  if (!scalarText(input)) throw new Error('Invalid footer URL text')
  const raw = trim(input)
  if (!raw || raw.length > 2048 || !/^[a-zA-Z0-9:/?#[\]@!$&'()*+,;=._~%+-]+$/.test(raw)) throw new Error('Invalid footer URI bytes')
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== '%') continue
    const hex = raw.slice(index + 1, index + 3)
    if (!/^[a-fA-F0-9]{2}$/.test(hex)) throw new Error('Invalid footer URL escape')
    const byte = Number.parseInt(hex, 16)
    if (byte < 32 || byte === 127) throw new Error('Encoded footer URL control')
    index += 2
  }
  const match = /^(https?):\/\/([^/?#]+)(.*)$/i.exec(raw)
  if (!match) throw new Error('Invalid footer URL scheme or host')
  const scheme = match[1]!.toLowerCase(), authority = match[2]!, suffix = match[3]!
  if (/[@%]/.test(authority)) throw new Error('Footer URL credentials or zone')
  let host: string, port: string | undefined
  if (authority.startsWith('[')) {
    const bracketed = /^(\[[a-fA-F0-9:.]+\])(?::(.*))?$/.exec(authority)
    if (!bracketed) throw new Error('Invalid footer IPv6 authority')
    host = bracketed[1]!; port = bracketed[2]
  } else {
    const parts = authority.split(':')
    if (parts.length > 2) throw new Error('Unbracketed footer IPv6')
    host = parts[0]!.toLowerCase(); port = parts[1]
    const ipv4 = host.split('.')
    if (ipv4.length === 4 && ipv4.every(part => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)) {
      // Canonical decimal IPv4 has no WHATWG shorthand or leading zeroes.
    } else {
      if (!host || host.length > 253 || host.split('.').some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) throw new Error('Invalid footer DNS labels')
      for (const label of host.split('.')) if (label.startsWith('xn--')) validateFooterACE(label)
      const last = host.split('.').at(-1)!
      if (/^[0-9]+$/.test(last) || /^0x[a-f0-9]*$/.test(last)) throw new Error('Ambiguous numeric footer host')
    }
  }
  let canonicalPort = ''
  if (port !== undefined) {
    if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid footer URL port')
    const value = Number(port)
    if (!(scheme === 'http' && value === 80) && !(scheme === 'https' && value === 443)) canonicalPort = ':' + value
  }
  const parsed = new URL(raw)
  if (parsed.hostname.startsWith('[::ffff:')) throw new Error('Mapped footer IPv6 is ambiguous')
  if (!host.startsWith('[') && parsed.hostname !== host) throw new Error('Noncanonical footer DNS spelling')
  return scheme + '://' + parsed.hostname + canonicalPort + suffix
}

const inputLabel = z.string().refine(scalarText).transform(trim).refine(value => [...value].length >= 1 && [...value].length <= 40)
const inputURL = z.string().transform((value, context) => {
  try { return normalizeFooterLinkURL(value) } catch {
    context.addIssue({ code: 'custom', message: 'Invalid footer URL' })
    return z.NEVER
  }
})
const savedLabel = z.string().refine(value => inputLabel.safeParse(value).success && trim(value) === value)
const savedURL = z.string().refine(value => {
  try { return normalizeFooterLinkURL(value) === value } catch { return false }
})
const revision = z.iso.datetime({ offset: true }).refine(value => {
  const fraction = value.match(/[.]([0-9]+)/)?.[1] ?? ''
  return !value.startsWith('0000-') && (Date.parse(value) !== -62135596800000 || /[1-9]/.test(fraction))
})
const link = z.object({ label: savedLabel, url: savedURL }).strict()
export const FooterLinksSchema = z.object({ links: z.array(link).max(5) }).strict()
export const FooterLinksSettingsSchema = FooterLinksSchema.extend({ updatedAt: revision }).strict()
export const UpdateFooterLinksSchema = z.object({ links: z.array(z.object({ label: inputLabel, url: inputURL }).strict()).max(5), expectedUpdatedAt: revision }).strict()
export type FooterLink = z.infer<typeof link>
export type FooterLinks = z.infer<typeof FooterLinksSchema>
export type FooterLinksSettings = z.infer<typeof FooterLinksSettingsSchema>
export type UpdateFooterLinks = z.input<typeof UpdateFooterLinksSchema>

/** Reads only public ordered links, with no management revision or private fields. */
export async function getPublicFooterLinks(): Promise<FooterLinks> {
  return FooterLinksSchema.parse((await apiGet<unknown>('/system/footer-links')).data)
}
/** Reads the independent administrator document without truncating its revision. */
export async function getFooterLinks(): Promise<FooterLinksSettings> {
  return FooterLinksSettingsSchema.parse((await apiGet<unknown>('/admin/system/footer-links')).data)
}
/** Validates a complete ordered replacement and sends the exact CAS version. */
export async function updateFooterLinks(input: UpdateFooterLinks): Promise<FooterLinksSettings> {
  return FooterLinksSettingsSchema.parse((await apiPost<unknown>('/admin/system/footer-links/update', UpdateFooterLinksSchema.parse(input))).data)
}
