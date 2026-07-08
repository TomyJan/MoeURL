import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export function useAvatarText(displayName: MaybeRefOrGetter<string | null | undefined>) {
  return computed(() => {
    const resolvedName = toValue(displayName)
    const normalizedName = typeof resolvedName === 'string' ? resolvedName.trim() : ''
    const firstCharacter = Array.from(normalizedName)[0]
    return firstCharacter ? firstCharacter.toUpperCase() : 'M'
  })
}
