<template>
  <div v-if="canExport" class="list-export">
    <v-btn data-testid="short-link-list-export" color="primary" variant="tonal" :disabled="disabled" :loading="pending" @click="submit">
      {{ t('listExport.csv') }}
    </v-btn>
    <p>{{ t('listExport.description') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { exportShortLinkList, type ShortLinkListExportContext, type ShortLinkListExportFilters } from '@/entities/short-link/list-export'
import { ApiClientError } from '@/shared/api/client'
import { downloadCsv } from '@/shared/download/csv'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const props = defineProps<{ context: ShortLinkListExportContext; filters: ShortLinkListExportFilters; blocked: boolean }>()
const { t } = useI18n()
const client = useQueryClient()
const identity = useAccountIdentity()
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const pending = ref(false)
const canExport = computed(() => auth.isSuccess.value && hasAccess(auth.data.value))
const disabled = computed(() => pending.value || props.blocked)
let alive = true
let revision = 0
watch([
  () => props.context, () => props.filters.status, () => props.filters.q, () => props.filters.tag,
  () => props.blocked, identity.scope, canExport,
], () => { revision++ }, { flush: 'sync' })
let permissions = permissionKey()
const unsubscribe = client.getQueryCache().subscribe(event => {
  if (event.query.queryKey[0] !== 'auth' || event.query.queryKey[1] !== 'me') return
  const current = permissionKey()
  if (current !== permissions) { permissions = current; revision++ }
})
onBeforeUnmount(() => { alive = false; unsubscribe() })

/** Tracks permission changes synchronously, including revocation and restoration in one render. */
function permissionKey() {
  return JSON.stringify(client.getQueryData<UserResponse>(['auth', 'me'])?.user.permissions)
}

/** Applies the independent export permission and the context's complete read boundary. */
function hasAccess(response: UserResponse | undefined) {
  const user = response?.user
  if (!user?.id || user.group === 'guest' || user.username === 'guest') return false
  const permissions = user.permissions
  return permissions.includes('short_link:export') && (props.context === 'own'
    ? permissions.includes('short_link:read_own')
    : permissions.includes('admin:access') && permissions.includes('short_link:read_all'))
}

/** Pins applied filters and login epoch until the browser download can safely begin. */
async function submit() {
  if (disabled.value || !canExport.value) return
  const scope = identity.scope.value
  const requestRevision = revision
  const filters = { status: props.filters.status, q: props.filters.q, tag: props.filters.tag }
  const context = props.context
  /** Checks synchronous cache state after waiting for parent filter and loading props to render. */
  const isCurrent = () => alive && revision === requestRevision && identity.isCurrent(scope)
    && hasAccess(client.getQueryData<UserResponse>(['auth', 'me'])) && !props.blocked
  pending.value = true
  try {
    const file = await exportShortLinkList(filters, context)
    await nextTick()
    if (!isCurrent()) return
    downloadCsv(file)
    toast.success(t('listExport.started'))
  } catch (error) {
    await nextTick()
    if (isCurrent()) toast.error(t(error instanceof ApiClientError && error.code === 200118 ? 'listExport.limitExceeded' : 'listExport.failed'))
  } finally {
    pending.value = false
  }
}
</script>

<style scoped>
.list-export { display: flex; align-items: flex-end; flex-direction: column; gap: 6px; min-width: 0; max-width: 100%; }
.list-export p { max-width: 300px; margin: 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.8125rem; text-align: right; }
@media (max-width: 760px) {
  .list-export { align-items: flex-start; }
  .list-export p { text-align: left; }
}
</style>
