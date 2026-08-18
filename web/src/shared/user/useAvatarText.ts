import { computed, toValue, type MaybeRefOrGetter } from 'vue'

/** Derives a stable one-character avatar label from a reactive display name. */
export function useAvatarText(displayName: MaybeRefOrGetter<string | null | undefined>) {
  return computed(() => {
    const resolvedName = toValue(displayName)
    const normalizedName = typeof resolvedName === 'string' ? resolvedName.trim() : ''
    const firstCharacter = Array.from(normalizedName)[0]
    const uppercaseCharacter = firstCharacter?.toUpperCase()
    return uppercaseCharacter ? Array.from(uppercaseCharacter)[0] ?? 'M' : 'M'
  })
}
