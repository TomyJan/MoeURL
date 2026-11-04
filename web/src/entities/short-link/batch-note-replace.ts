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
const writeInputSchema = z.strictObject({ items: z.array(writeItemSchema).min(1).max(100).refine(uniqueItems), note: noteSchema })
const countSchema = z.int().min(0).max(100)
const previewResultSchema = z.strictObject({ items: z.array(writeItemSchema.extend({ willChange: z.boolean() })).min(1).max(100), changedCount: countSchema, unchangedCount: countSchema })
const resultSchema = z.strictObject({ changedCount: countSchema, unchangedCount: countSchema })
export type BatchNoteReplacePreviewInput = z.infer<typeof previewInputSchema>
export type BatchNoteReplaceInput = z.infer<typeof writeInputSchema>
export type BatchNoteReplacePreviewResult = z.infer<typeof previewResultSchema>
export type BatchNoteReplaceResult = z.infer<typeof resultSchema>

/** Makes one private attempt without retaining response bodies or transport details in errors. */
async function request(path: string, input: BatchNoteReplacePreviewInput | BatchNoteReplaceInput, userId: string) {
  if (!noteIdSchema.safeParse(userId).success) throw new ApiClientError(100001, 'Invalid note actor')
  try {
    return (await apiPost<unknown>(path, input, undefined, { 'X-MoeURL-Expected-User-ID': userId })).data
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      const status = cause.meta.status
      throw new ApiClientError(cause.code, 'Note operation failed', typeof status === 'number' ? { status } : {})
    }
    throw new ApiClientError(900000, 'Note operation result unavailable')
  }
}
/** Accepts comparison metadata only when every target, complete main revision and count matches. */
async function preview(path: string, input: BatchNoteReplacePreviewInput, userId: string): Promise<BatchNoteReplacePreviewResult> {
  const parsed = previewInputSchema.safeParse(input)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid note preview request')
  const value = previewResultSchema.safeParse(await request(path, parsed.data, userId))
  if (!value.success || value.data.items.length !== parsed.data.items.length
    || value.data.items.some((item, index) => item.id !== parsed.data.items[index]!.id || !sameNoteInstant(item.expectedUpdatedAt, parsed.data.items[index]!.expectedUpdatedAt))
    || value.data.changedCount !== value.data.items.filter(item => item.willChange).length
    || value.data.changedCount + value.data.unchangedCount !== parsed.data.items.length) {
    throw new ApiClientError(100001, 'Invalid note preview response', { invalidBatchNoteResponse: true })
  }
  return value.data
}
/** A replacement is one explicit write, with no automatic retry or accepted partial response. */
async function replace(path: string, input: BatchNoteReplaceInput, userId: string): Promise<BatchNoteReplaceResult> {
  const parsed = writeInputSchema.safeParse(input)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid note replacement request')
  const value = resultSchema.safeParse(await request(path, parsed.data, userId))
  if (!value.success || value.data.changedCount + value.data.unchangedCount !== parsed.data.items.length) {
    throw new ApiClientError(100001, 'Invalid note replacement response', { invalidBatchNoteResponse: true })
  }
  return value.data
}
/** Uses the personal fixed endpoint without exposing private text in a URL. */
export const previewOwnNoteReplace = (input: BatchNoteReplacePreviewInput, userId: string) => preview('/short-link/note/batch-replace/preview', input, userId)
/** Uses the separate administrative preview authorization boundary. */
export const previewAdminNoteReplace = (input: BatchNoteReplacePreviewInput, userId: string) => preview('/admin/short-link/note/batch-replace/preview', input, userId)
/** Replaces one personal snapshot using both complete revisions. */
export const replaceOwnNotes = (input: BatchNoteReplaceInput, userId: string) => replace('/short-link/note/batch-replace', input, userId)
/** Replaces one administrative snapshot using both complete revisions. */
export const replaceAdminNotes = (input: BatchNoteReplaceInput, userId: string) => replace('/admin/short-link/note/batch-replace', input, userId)
