<template>
  <section v-if="access.canRead.value" class="tag-catalog-browser">
    <v-btn variant="text" :aria-expanded="open" :aria-controls="panelId" @click="toggle">{{ t(catalog.messages + '.title') }}</v-btn>
    <div v-if="open" :id="panelId" class="tag-catalog-browser__panel">
      <p>{{ t(catalog.messages + '.description') }}</p>
      <v-text-field v-model="draft" :label="t(catalog.messages + '.search')" :error-messages="invalid ? t(catalog.messages + '.invalid') : ''" density="compact" variant="outlined" />
      <div v-if="invalid" role="status">{{ t(catalog.messages + '.invalid') }}</div>
      <div v-else-if="!ready || query.isPending.value || query.isFetching.value" role="status">
        <v-progress-linear indeterminate :aria-label="t(catalog.messages + '.loading')" />
        {{ t(catalog.messages + '.loading') }}
      </div>
      <v-alert v-else-if="query.isError.value" type="error" variant="tonal">
        {{ t(catalog.messages + '.failed') }}
        <v-btn variant="text" @click="retry">{{ t(catalog.messages + '.retry') }}</v-btn>
      </v-alert>
      <template v-else-if="data">
        <p v-if="data.items.length === 0" role="status">{{ t(catalog.messages + (debounced ? '.noMatches' : '.empty')) }}</p>
        <div v-else class="tag-catalog-browser__items">
          <v-btn v-for="item in data.items" :key="item.tag" class="tag-catalog-browser__tag" variant="tonal" :disabled="blocked" @click="select(item.tag)">
            <span>{{ item.tag }} · {{ item.linkCount }}</span>
          </v-btn>
        </div>
        <p v-if="data.hasMore" role="status">{{ t(catalog.messages + '.more') }}</p>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { listPersonalTags, listAdminTags, tagCatalogQuerySchema } from '@/entities/short-link/tag-catalog'
import type { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

const props = defineProps<{ context: 'own' | 'admin'; access: ReturnType<typeof useShortLinkAccess>; blocked?: boolean }>()
// Context comes only from fixed own/admin wrappers and stays fixed for this component lifetime.
const catalog = props.context === 'admin'
  ? { family: 'admin-short-link', messages: 'adminTagCatalog', list: listAdminTags }
  : { family: 'short-link', messages: 'tagCatalog', list: listPersonalTags }
const emit = defineEmits<{ select: [tag: string] }>()
const { t } = useI18n()
const client = useQueryClient()
const panelId = useId()
const open = ref(false)
const draft = ref('')
const debounced = ref('')
const generation = ref(0)
const cacheRevision = ref(0)
const parsed = computed(() => tagCatalogQuerySchema.safeParse(draft.value))
const invalid = computed(() => !parsed.value.success)
const allowed = computed(() => {
  void cacheRevision.value
  const auth = client.getQueryState(['auth', 'me'])
  return props.access.canRead.value && auth?.status === 'success' && !auth.isInvalidated && props.access.allows('read')
})
const ready = computed(() => open.value && allowed.value && parsed.value.success && parsed.value.data === debounced.value)
const queryKey = computed(() => [catalog.family, 'tag-catalog', props.access.identity.scope.value.userId, props.access.identity.scope.value.epoch, generation.value, debounced.value] as const)
const query = useQuery({ queryKey, enabled: ready, retry: false, staleTime: 0, gcTime: 0, queryFn: async ({ queryKey: key }) => ({ generation: key[4], search: key[5], result: await catalog.list(key[5]) }) })
const data = computed(() => {
  void cacheRevision.value
  const state = client.getQueryState(queryKey.value)
  const response = query.data.value
  return ready.value && query.isSuccess.value && !query.isFetching.value && !state?.isInvalidated && response?.generation === generation.value && response.search === debounced.value ? response.result : undefined
})

/** Retires the opening generation so late reads cannot reappear after closing or authorization changes. */
function close() { generation.value++; open.value = false; draft.value = ''; debounced.value = '' }
/** Opens a fresh read, or dismisses the current local search without changing list filters. */
function toggle() {
  if (!allowed.value) return
  if (open.value) close()
  else { generation.value++; open.value = true }
}
/** A queued click must still belong to a visible, currently authorized response. */
function select(tag: string) { if (!props.blocked && allowed.value && data.value?.items.some(item => item.tag === tag)) emit('select', tag) }
/** Retries only the live search; no list or write operation is replayed. */
function retry() { if (ready.value) void query.refetch() }
watch(draft, (_value, _old, onCleanup) => {
  const result = parsed.value
  if (!result.success) return
  const timer = globalThis.setTimeout(() => { debounced.value = result.data }, 250)
  onCleanup(() => globalThis.clearTimeout(timer))
}, { flush: 'sync' })
watch([props.access.identity.scope, allowed], close, { flush: 'sync' })
const unsubscribe = client.getQueryCache().subscribe(event => {
  cacheRevision.value++
  if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me' && !allowed.value) close()
  // Initial in-flight queries have no data, so ordinary invalidation can reuse their old promise.
  // Retire this exact read before the cache starts refetching; the new key keeps the live search.
  if (event.type === 'updated' && event.action.type === 'invalidate' && event.query === client.getQueryCache().find({ queryKey: queryKey.value, exact: true })) {
    const retiredKey = queryKey.value
    generation.value++
    void client.cancelQueries({ queryKey: retiredKey, exact: true })
    client.removeQueries({ queryKey: retiredKey, exact: true })
  }
})
onBeforeUnmount(() => { unsubscribe(); close() })
</script>

<style scoped>
.tag-catalog-browser { min-width: 0; }
.tag-catalog-browser__panel { padding: 12px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 12px; }
.tag-catalog-browser__panel p { margin: 0 0 12px; }
.tag-catalog-browser__items { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.tag-catalog-browser__tag { min-width: 0; max-width: 100%; height: auto; min-height: 36px; white-space: normal; padding-block: 8px; }
.tag-catalog-browser__tag :deep(.v-btn__content), .tag-catalog-browser__tag span { min-width: 0; white-space: normal; overflow-wrap: anywhere; }
</style>
