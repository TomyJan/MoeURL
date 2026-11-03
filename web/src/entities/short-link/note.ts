import { z } from 'zod'
import { ApiClientError, apiGet, apiPost } from '@/shared/api/client'
import { shortLinkNoteSchema } from '@/shared/validation/shortLinkNote'

export const noteIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== '00000000-0000-0000-0000-000000000000')
export const noteVersionSchema = z.iso.datetime({ offset: true }).refine(value => {
  // Date checks only the whole-second range; the original nanosecond string remains the CAS token.
  const instant = Date.parse(value.replace(/\.\d+/, ''))
  const utcYear = new Date(instant).getUTCFullYear()
  return !value.startsWith('0000-') && !/\.\d{10}/.test(value) && utcYear >= 1 && utcYear <= 9999
    && (instant !== Date.parse('0001-01-01T00:00:00Z') || /\.\d*[1-9]/.test(value))
})
const inputSchema = z.strictObject({ id: noteIdSchema, note: shortLinkNoteSchema, expectedUpdatedAt: noteVersionSchema })
const resultSchema = z.strictObject({ id: noteIdSchema, note: z.string().refine(value => {
  const parsed = shortLinkNoteSchema.safeParse(value)
  return parsed.success && parsed.data === value
}), updatedAt: noteVersionSchema })
export type NoteInput = z.infer<typeof inputSchema>
export type NoteResult = z.infer<typeof resultSchema>

/** Rejects malformed success data without exposing the private response in an error. */
function result(data: unknown, id: string): NoteResult {
  const parsed = resultSchema.safeParse(data)
  if (!parsed.success || parsed.data.id !== id) throw new ApiClientError(100001, 'Invalid note response', { invalidNoteResponse: true })
  return parsed.data
}
/** Pins the official client's request to the identity captured when its editor opened. */
function headers(userId: string) {
  if (!noteIdSchema.safeParse(userId).success) throw new ApiClientError(100001, 'Invalid note actor')
  return { 'X-MoeURL-Expected-User-ID': userId }
}
/** Reads one authorized note using a fixed endpoint family. */
async function read(path: string, id: string, userId: string) {
  if (!noteIdSchema.safeParse(id).success) throw new ApiClientError(100001, 'Invalid note ID')
  const response = await apiGet<unknown>(`${path}?id=${id}`, headers(userId))
  return result(response.data, id)
}
/** Makes one explicit versioned write; no transport or business failure is retried. */
async function update(path: string, input: NoteInput, userId: string) {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid note request')
  const response = await apiPost<unknown>(path, parsed.data, undefined, headers(userId))
  return result(response.data, parsed.data.id)
}
/** Reads a note through current personal ownership authorization. */
export const readOwnNote = (id: string, userId: string) => read('/short-link/note', id, userId)
/** Reads a note through current administrative authorization. */
export const readAdminNote = (id: string, userId: string) => read('/admin/short-link/note', id, userId)
/** Writes only through the personal note endpoint. */
export const updateOwnNote = (input: NoteInput, userId: string) => update('/short-link/note/update', input, userId)
/** Writes only through the administrative note endpoint. */
export const updateAdminNote = (input: NoteInput, userId: string) => update('/admin/short-link/note/update', input, userId)
