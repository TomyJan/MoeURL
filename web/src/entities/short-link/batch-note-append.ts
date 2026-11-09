import { z } from 'zod'
import { ApiClientError, apiPost } from '@/shared/api/client'
import { shortLinkNoteSchema } from '@/shared/validation/shortLinkNote'
import { noteIdSchema, noteVersionSchema } from './note'
import { sameNoteInstant } from './batch-note-clear'

const previewItemSchema = z.strictObject({ id: noteIdSchema, expectedUpdatedAt: noteVersionSchema })
const writeItemSchema = previewItemSchema.extend({ expectedNoteUpdatedAt: noteVersionSchema })
const uniqueItems = <T extends { id: string }>(items: T[]) => new Set(items.map(item => item.id)).size === items.length
const noteSchema = shortLinkNoteSchema.refine(value => value !== '')
const previewInputSchema = z.strictObject({ items: z.array(previewItemSchema).min(1).max(100).refine(uniqueItems), note: noteSchema })
const inputSchema = z.strictObject({ requestId: noteIdSchema, items: z.array(writeItemSchema).min(1).max(100).refine(uniqueItems), note: noteSchema })
const countSchema = z.int().min(0).max(100)
const previewResultSchema = z.strictObject({ items: z.array(writeItemSchema).min(1).max(100), appendableCount: countSchema, overflowCount: countSchema })
const resultSchema = z.strictObject({ requestId: noteIdSchema, appendedCount: z.int().min(1).max(100) })
export type BatchNoteAppendPreviewInput = z.infer<typeof previewInputSchema>
export type BatchNoteAppendInput = Readonly<{ requestId: string; items: readonly Readonly<z.infer<typeof writeItemSchema>>[]; note: string }>
export type BatchNoteAppendPreviewResult = z.infer<typeof previewResultSchema>
export type BatchNoteAppendResult = z.infer<typeof resultSchema>

/** Makes one bounded private attempt; errors contain no response text or untrusted metadata. */
async function request(path: string, input: BatchNoteAppendPreviewInput | BatchNoteAppendInput, userId: string) {
  if (!noteIdSchema.safeParse(userId).success) throw new ApiClientError(100001, 'Invalid note actor')
  const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 15_000)
  try {
    return (await apiPost<unknown>(path, input, controller.signal, { 'X-MoeURL-Expected-User-ID': userId })).data
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      const status = cause.meta.status
      throw new ApiClientError(cause.code, 'Note operation failed', typeof status === 'number' ? { status } : {})
    }
    throw new ApiClientError(900000, 'Note operation result unavailable')
  } finally { clearTimeout(deadline) }
}
/** Accepts only ordered metadata for the exact targets and complete main revisions supplied. */
async function preview(path: string, input: BatchNoteAppendPreviewInput, userId: string): Promise<BatchNoteAppendPreviewResult> {
  const parsed = previewInputSchema.safeParse(input)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid note preview request')
  const value = previewResultSchema.safeParse(await request(path, parsed.data, userId))
  if (!value.success || value.data.items.length !== parsed.data.items.length
    || value.data.items.some((item, index) => item.id !== parsed.data.items[index]!.id || !sameNoteInstant(item.expectedUpdatedAt, parsed.data.items[index]!.expectedUpdatedAt))
    || value.data.appendableCount + value.data.overflowCount !== parsed.data.items.length) {
    throw new ApiClientError(100001, 'Invalid note preview response', { invalidBatchNoteResponse: true })
  }
  return value.data
}
/** Appends once without retry; only an exact full acknowledgment confirms its outcome. */
async function append(path: string, input: BatchNoteAppendInput, userId: string): Promise<BatchNoteAppendResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid note append request')
  const value = resultSchema.safeParse(await request(path, parsed.data, userId))
  if (!value.success || value.data.requestId !== parsed.data.requestId || value.data.appendedCount !== parsed.data.items.length) {
    throw new ApiClientError(100001, 'Invalid note append response', { invalidBatchNoteResponse: true })
  }
  return value.data
}
/** Uses the fixed personal preview endpoint without exposing new text in a URL. */
export const previewOwnNoteAppend = (input: BatchNoteAppendPreviewInput, userId: string) => preview('/short-link/note/batch-append/preview', input, userId)
/** Uses the independent administrative preview permission boundary. */
export const previewAdminNoteAppend = (input: BatchNoteAppendPreviewInput, userId: string) => preview('/admin/short-link/note/batch-append/preview', input, userId)
/** Writes or replays the original personal request key and exact payload. */
export const appendOwnNotes = (input: BatchNoteAppendInput, userId: string) => append('/short-link/note/batch-append', input, userId)
/** Writes or replays the original administrative request key and exact payload. */
export const appendAdminNotes = (input: BatchNoteAppendInput, userId: string) => append('/admin/short-link/note/batch-append', input, userId)
