import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export function useAvatarText(displayName: MaybeRefOrGetter<string | null | undefined>) {
  return computed(() => (toValue(displayName) || 'M').slice(0, 1).toUpperCase())
}
