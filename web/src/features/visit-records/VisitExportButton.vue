<template>
  <div v-if="canExport" class="visit-export">
    <v-btn data-testid="visit-export" color="primary" variant="tonal" :disabled="disabled" :loading="pending" @click="submit">{{ t('visitExport.csv') }}</v-btn>
    <p>{{ t('visitExport.description') }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { exportVisitRecords, type VisitExportContext, type VisitExportRange, type VisitExportFilters } from '@/entities/insights/visit-export'
import { ApiClientError } from '@/shared/api/client'
import { downloadCsv } from '@/shared/download/csv'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const props = defineProps<{ id: string; context: VisitExportContext; range?: VisitExportRange; filters: VisitExportFilters; blocked: boolean; contextRevision: number }>()
const emit = defineEmits<{ unavailable: [] }>()
const { t } = useI18n()
const client = useQueryClient()
const identity = useAccountIdentity()
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const pending = ref(false)
const canExport = computed(() => auth.isSuccess.value && hasAccess(auth.data.value))
const disabled = computed(() => pending.value || props.blocked || !props.range)
let alive = true
let revision = 0
watch([
  () => props.id, () => props.context, () => props.contextRevision,
  () => props.range?.startDate, () => props.range?.endDate,
  () => props.filters.deviceType, () => props.filters.countryCode,
  () => props.blocked, identity.scope, canExport,
], () => { revision++ }, { flush: 'sync' })
let permissions = permissionKey()
const unsubscribe = client.getQueryCache().subscribe(event => {
  if (event.query.queryKey[0] !== 'auth' || event.query.queryKey[1] !== 'me') return
  const current = permissionKey()
  if (current !== permissions) { permissions = current; revision++ }
})
onBeforeUnmount(() => { alive = false; unsubscribe() })

/** Observes same-tick revocation and restoration before query observers render. */
function permissionKey() { return JSON.stringify(client.getQueryData<UserResponse>(['auth', 'me'])?.user.permissions) }

/** Requires the independent export grant and every read permission in this context. */
function hasAccess(response: UserResponse | undefined) {
  const user = response?.user
  if (!user?.id || user.group === 'guest' || user.username === 'guest') return false
  const required = ['short_link:export_visits', 'short_link:read_visits', ...(props.context === 'own' ? ['short_link:read_own'] : ['admin:access', 'short_link:read_all'])]
  return required.every(permission => user.permissions.includes(permission))
}

/** Freezes displayed filters and rejects abandoned contexts before any download or feedback. */
async function submit() {
  if (disabled.value || !canExport.value || !hasAccess(client.getQueryData<UserResponse>(['auth', 'me']))) return
  const scope = identity.scope.value
  const requestRevision = revision
  const range = { startDate: props.range!.startDate, endDate: props.range!.endDate }
  const filters = { deviceType: props.filters.deviceType, countryCode: props.filters.countryCode }
  const id = props.id
  const context = props.context
  /** Waits for the parent's synchronous revision to arrive, then checks cache grants directly. */
  const isCurrent = () => alive && revision === requestRevision && identity.isCurrent(scope)
    && hasAccess(client.getQueryData<UserResponse>(['auth', 'me'])) && !props.blocked
  pending.value = true
  try {
    await nextTick()
    if (!isCurrent()) return
    const file = await exportVisitRecords(id, context, range, filters)
    await nextTick()
    if (!isCurrent()) return
    downloadCsv(file)
    toast.success(t('visitExport.started'))
  } catch (error) {
    await nextTick()
    if (!isCurrent()) return
    const code = error instanceof ApiClientError ? error.code : 0
    toast.error(t(code === 200120 ? 'visitExport.limitExceeded' : 'visitExport.failed'))
    if ([120001, 401, 403].includes(code)) {
      // Keep the identity epoch, but never keep grants the server has just rejected.
      void client.cancelQueries({ queryKey: ['auth', 'me'] })
      const current = client.getQueryData<UserResponse>(['auth', 'me'])!
      client.setQueryData<UserResponse>(['auth', 'me'], { user: { ...current.user, permissions: [] } })
      try {
        const refreshed = await me()
        if (alive && identity.isCurrent(scope)) client.setQueryData(['auth', 'me'], refreshed)
      } catch { /* Keep denied grants cleared until a later authenticated read succeeds. */ }
    } else if (code === 200104) emit('unavailable')
  } finally { pending.value = false }
}
</script>
<style scoped>
.visit-export { display: flex; align-items: flex-end; flex-direction: column; gap: 6px; min-width: 0; max-width: 100%; }
.visit-export p { max-width: 320px; margin: 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.8125rem; text-align: right; }
@media (max-width: 760px) { .visit-export { align-items: flex-start; } .visit-export p { text-align: left; } }
</style>
