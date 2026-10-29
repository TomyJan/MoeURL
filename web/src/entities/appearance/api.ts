import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'

export const publicAppearanceKey = ['system', 'appearance'] as const
export const adminAppearanceKey = ['admin', 'system', 'appearance'] as const
export const AccentPresetSchema = z.enum(['iris', 'ocean', 'forest'])
const revision = z.iso.datetime({ offset: true }).refine(value => {
  // Validate Go's nonzero instant without transforming or truncating the returned string.
  const fraction = value.match(/[.]([0-9]+)/)?.[1] ?? ''
  return !value.startsWith('0000-') && (Date.parse(value) !== -62135596800000 || /[1-9]/.test(fraction))
})
export const AppearanceSchema = z.object({ accentPreset: AccentPresetSchema }).strict()
export const AppearanceSettingsSchema = AppearanceSchema.extend({ updatedAt: revision }).strict()
export const UpdateAppearanceSchema = z.object({ accentPreset: AccentPresetSchema, expectedUpdatedAt: revision }).strict()
export type AccentPreset = z.infer<typeof AccentPresetSchema>
export type Appearance = z.infer<typeof AppearanceSchema>
export type AppearanceSettings = z.infer<typeof AppearanceSettingsSchema>
export type UpdateAppearance = z.infer<typeof UpdateAppearanceSchema>

/** Reads only the public preset; management versions never enter this projection. */
export async function getPublicAppearance(): Promise<Appearance> {
  return AppearanceSchema.parse((await apiGet<unknown>('/system/appearance')).data)
}
/** Loads the independent complete-precision management document. */
export async function getAppearance(): Promise<AppearanceSettings> {
  return AppearanceSettingsSchema.parse((await apiGet<unknown>('/admin/system/appearance')).data)
}
/** Submits a complete CAS command, retaining every revision digit verbatim. */
export async function updateAppearance(input: UpdateAppearance): Promise<AppearanceSettings> {
  return AppearanceSettingsSchema.parse((await apiPost<unknown>('/admin/system/appearance/update', UpdateAppearanceSchema.parse(input))).data)
}
