import { computed, ref, watch } from 'vue'
import { shortLinkKeywordSchema, shortLinkTagFilterSchema } from '@/shared/validation/shortLinkMetadata'

/** Debounces valid list filters, keeping invalid drafts out of request keys. */
export function useShortLinkFilters() {
  const searchKeyword = ref('')
  const tagFilter = ref('')
  const debouncedKeyword = ref('')
  const debouncedTag = ref('')
  const keywordResult = computed(() => shortLinkKeywordSchema.safeParse(searchKeyword.value))
  const tagResult = computed(() => shortLinkTagFilterSchema.safeParse(tagFilter.value))
  const keywordInvalid = computed(() => !keywordResult.value.success)
  const tagInvalid = computed(() => !tagResult.value.success)

  watch([searchKeyword, tagFilter], (_values, _oldValues, onCleanup) => {
    const keyword = keywordResult.value
    const tag = tagResult.value
    if (!keyword.success || !tag.success) return
    const timer = globalThis.setTimeout(() => {
      debouncedKeyword.value = keyword.data
      debouncedTag.value = tag.data
    }, 500)
    onCleanup(() => globalThis.clearTimeout(timer))
  })

  return { searchKeyword, tagFilter, debouncedKeyword, debouncedTag, keywordInvalid, tagInvalid }
}
