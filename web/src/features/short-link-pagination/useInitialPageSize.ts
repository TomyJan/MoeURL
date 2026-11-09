import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useListPreference } from '@/shared/preferences/useListPreference'
import { DEFAULT_SHORT_LINK_PAGE_SIZE, type ShortLinkPageSize } from './pageSize'

/** Applies the account default only before this list has chosen its first collection. */
export function useInitialPageSize(allowed: Ref<boolean>) {
  const reader = useListPreference(allowed)
  const pageSize = ref<ShortLinkPageSize>(DEFAULT_SHORT_LINK_PAGE_SIZE)
  const ready = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Releases only this consumer's deadline, leaving the shared server read intact. */
  function clearDeadline() { clearTimeout(timer); timer = undefined }
  /** Commits the first collection once, including a deliberate choice of the displayed default. */
  function choose(size: ShortLinkPageSize) {
    clearDeadline()
    pageSize.value = size
    ready.value = true
  }
  /** A failed read falls back locally without putting a fabricated preference in the cache. */
  function settle() {
    if (ready.value || !allowed.value) return
    if (reader.preference.value) choose(reader.preference.value.pageSize ?? DEFAULT_SHORT_LINK_PAGE_SIZE)
    else if (reader.readError.value) choose(DEFAULT_SHORT_LINK_PAGE_SIZE)
  }
  watch([reader.scope, allowed], () => {
    clearDeadline()
    ready.value = false
    pageSize.value = DEFAULT_SHORT_LINK_PAGE_SIZE
    if (allowed.value && reader.scope.value.userId) {
      settle()
      if (!ready.value) timer = setTimeout(() => choose(DEFAULT_SHORT_LINK_PAGE_SIZE), 3000)
    }
  }, { immediate: true, flush: 'sync' })
  watch([reader.preference, reader.readError], settle, { flush: 'sync' })
  onBeforeUnmount(clearDeadline)
  return { pageSize, ready, choose }
}
