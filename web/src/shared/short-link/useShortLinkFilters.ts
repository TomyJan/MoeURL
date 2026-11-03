import { computed, ref, watch } from 'vue'
import { shortLinkKeywordSchema, shortLinkTagFilterSchema } from '@/shared/validation/shortLinkMetadata'
import { noteQuerySchema } from '@/shared/validation/noteSearch'

/** Debounces valid list filters, keeping invalid drafts out of request keys. */
export function useShortLinkFilters() {
  const searchKeyword = ref('')
  const tagFilter = ref('')
  const noteQuery = ref('')
  const debouncedNoteQuery = ref('')
  const debouncedKeyword = ref('')
  const debouncedTag = ref('')
  const keywordResult = computed(() => shortLinkKeywordSchema.safeParse(searchKeyword.value))
  const tagResult = computed(() => shortLinkTagFilterSchema.safeParse(tagFilter.value))
  const keywordInvalid = computed(() => !keywordResult.value.success)
  const tagInvalid = computed(() => !tagResult.value.success)
  const noteQueryResult = computed(() => noteQuerySchema.safeParse(noteQuery.value))
  const noteQueryInvalid = computed(() => !noteQueryResult.value.success)
  const noteQueryPending = computed(() => noteQueryResult.value.success && noteQueryResult.value.data !== debouncedNoteQuery.value)
  const filtersPending = computed(() => keywordResult.value.success && tagResult.value.success && noteQueryResult.value.success
    && (keywordResult.value.data !== debouncedKeyword.value || tagResult.value.data !== debouncedTag.value || noteQueryPending.value))

  watch([searchKeyword, tagFilter, noteQuery], (_values, _oldValues, onCleanup) => {
    const keyword = keywordResult.value
    const tag = tagResult.value
    const note = noteQueryResult.value
    if (!keyword.success || !tag.success || !note.success) return
    const timer = globalThis.setTimeout(() => {
      debouncedKeyword.value = keyword.data
      debouncedTag.value = tag.data
      debouncedNoteQuery.value = note.data
    }, 500)
    onCleanup(() => globalThis.clearTimeout(timer))
  })

  return { searchKeyword, tagFilter, noteQuery, debouncedKeyword, debouncedTag, debouncedNoteQuery, keywordInvalid, tagInvalid, noteQueryInvalid, noteQueryPending, filtersPending }
}
