import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

/** Keeps cursor history local to one applied query context and resets it synchronously. */
export function useCursorHistory(context: MaybeRefOrGetter<unknown>) {
  const history = ref([''])
  const revision = ref(0)
  watch(() => JSON.stringify(toValue(context)), () => { history.value = ['']; revision.value++ }, { flush: 'sync' })
  const cursor = computed(() => history.value[history.value.length - 1]!)
  const canPrevious = computed(() => history.value.length > 1)
  /** Advances only to a server-supplied continuation token. */
  function next(value: string) { if (value) history.value = [...history.value, value] }
  /** Returns to the previously requested keyset without reconstructing an offset. */
  function previous() { if (canPrevious.value) history.value = history.value.slice(0, -1) }
  return { cursor, canPrevious, next, previous, revision }
}
