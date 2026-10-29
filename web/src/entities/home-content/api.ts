import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'

export const publicHomeContentKey = ['home-content', 'public'] as const
export const adminHomeContentKey = ['home-content', 'admin'] as const
const controls = /\p{Cc}/u
// Match Go strings.TrimSpace exactly; JavaScript trim additionally removes BOM.
const edgeWhitespace = /^\p{White_Space}+|\p{White_Space}+$/gu
const trimContent = (value: string) => value.replace(edgeWhitespace, '')
const validContent = (value: string, limit: number) => !controls.test(value) && [...value].length <= limit
const savedText = (limit: number) => z.string().refine(value => validContent(value, limit) && trimContent(value) === value)
const inputText = (limit: number) => z.string().refine(value => !controls.test(value)).transform(trimContent).refine(value => [...value].length <= limit)
const revision = z.iso.datetime({ offset: true })

export const HomeContentSchema = z.object({ title: savedText(80), summary: savedText(200) }).strict()
export const HomeContentSettingsSchema = HomeContentSchema.extend({ updatedAt: revision }).strict()
export const UpdateHomeContentSchema = z.object({ title: inputText(80), summary: inputText(200), expectedUpdatedAt: revision }).strict()
export type HomeContent = z.infer<typeof HomeContentSchema>
export type HomeContentSettings = z.infer<typeof HomeContentSettingsSchema>
export type UpdateHomeContent = z.input<typeof UpdateHomeContentSchema>

/** Loads only public plain-text overrides, without a management version. */
export async function getPublicHomeContent(): Promise<HomeContent> {
  return HomeContentSchema.parse((await apiGet<unknown>('/system/home-content')).data)
}
/** Loads the independent complete-precision management document. */
export async function getHomeContent(): Promise<HomeContentSettings> {
  return HomeContentSettingsSchema.parse((await apiGet<unknown>('/admin/system/home-content')).data)
}
/** Validates and submits a complete CAS command without converting its revision. */
export async function updateHomeContent(input: UpdateHomeContent): Promise<HomeContentSettings> {
  return HomeContentSettingsSchema.parse((await apiPost<unknown>('/admin/system/home-content/update', UpdateHomeContentSchema.parse(input))).data)
}
