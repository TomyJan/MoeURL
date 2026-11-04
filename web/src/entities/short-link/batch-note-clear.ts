import { z } from 'zod'
import { ApiClientError, apiPost } from '@/shared/api/client'
import { noteIdSchema, noteVersionSchema } from './note'

const previewItemSchema = z.strictObject({ id: noteIdSchema, expectedUpdatedAt: noteVersionSchema })
const clearItemSchema = previewItemSchema.extend({ expectedNoteUpdatedAt: noteVersionSchema })
const uniqueItems = <T extends { id: string }>(items: T[]) => new Set(items.map(item => item.id)).size === items.length
const previewInputSchema = z.strictObject({ items: z.array(previewItemSchema).min(1).max(100).refine(uniqueItems) })
const clearInputSchema = z.strictObject({ items: z.array(clearItemSchema).min(1).max(100).refine(uniqueItems) })
const countSchema = z.int().min(0).max(100)
const previewResultSchema = z.strictObject({ items: z.array(clearItemSchema.extend({ hasNote: z.boolean() })).min(1).max(100), nonemptyCount: countSchema, emptyCount: countSchema })
const clearResultSchema = z.strictObject({ changedCount: countSchema, unchangedCount: countSchema })
export type BatchNotePreviewInput = z.infer<typeof previewInputSchema>
export type BatchNoteClearInput = z.infer<typeof clearInputSchema>
export type BatchNotePreviewResult = z.infer<typeof previewResultSchema>
export type BatchNoteClearResult = z.infer<typeof clearResultSchema>

/** Compares validated whole seconds and all nine fractional digits, preserving original CAS strings. */
export function sameNoteInstant(left: string, right: string): boolean {
  if (!noteVersionSchema.safeParse(left).success || !noteVersionSchema.safeParse(right).success) return false
  const seconds = (value: string) => Date.parse(value.replace(/\.\d+/, ''))
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0')
  return seconds(left) === seconds(right) && fraction(left) === fraction(right)
}

/** Sends one attempt and strips response messages, metadata and transport details from private errors. */
async function request(path: string, input: BatchNotePreviewInput | BatchNoteClearInput, userId: string) {
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
/** Validates an actual preview against the fixed input order, versions and counts without accepting text. */
async function preview(path: string, input: BatchNotePreviewInput, userId: string): Promise<BatchNotePreviewResult> {
  const parsed = previewInputSchema.safeParse(input)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid note preview request')
  const value = previewResultSchema.safeParse(await request(path, parsed.data, userId))
  if (!value.success || value.data.items.length !== parsed.data.items.length
    || value.data.items.some((item, index) => item.id !== parsed.data.items[index]!.id || !sameNoteInstant(item.expectedUpdatedAt, parsed.data.items[index]!.expectedUpdatedAt))
    || value.data.nonemptyCount !== value.data.items.filter(item => item.hasNote).length
    || value.data.nonemptyCount + value.data.emptyCount !== parsed.data.items.length) {
    throw new ApiClientError(100001, 'Invalid note preview response', { invalidBatchNoteResponse: true })
  }
  return value.data
}
/** Accepts only a complete, bounded count result from one explicit versioned clear. */
async function clear(path: string, input: BatchNoteClearInput, userId: string): Promise<BatchNoteClearResult> {
  const parsed = clearInputSchema.safeParse(input)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid note clear request')
  const value = clearResultSchema.safeParse(await request(path, parsed.data, userId))
  if (!value.success || value.data.changedCount + value.data.unchangedCount !== parsed.data.items.length) {
    throw new ApiClientError(100001, 'Invalid note clear response', { invalidBatchNoteResponse: true })
  }
  return value.data
}
/** Previews only targets owned by the current authenticated account. */
export const previewOwnNoteClear = (input: BatchNotePreviewInput, userId: string) => preview('/short-link/note/batch-clear/preview', input, userId)
/** Previews targets through the fixed administrative authorization boundary. */
export const previewAdminNoteClear = (input: BatchNotePreviewInput, userId: string) => preview('/admin/short-link/note/batch-clear/preview', input, userId)
/** Clears one personal snapshot without retrying the write. */
export const clearOwnNotes = (input: BatchNoteClearInput, userId: string) => clear('/short-link/note/batch-clear', input, userId)
/** Clears one administrative snapshot without retrying the write. */
export const clearAdminNotes = (input: BatchNoteClearInput, userId: string) => clear('/admin/short-link/note/batch-clear', input, userId)
