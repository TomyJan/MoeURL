<template>
  <div v-if="canExport" class="audit-export">
    <v-btn data-testid="audit-export" color="primary" variant="tonal" :disabled="disabled" :loading="pending" @click="submit">{{ t('auditExport.csv') }}</v-btn>
    <p>{{ t('auditExport.description') }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { exportAuditRecords, type AuditExportRange, type AuditExportFilters } from '@/entities/insights/audit-export'
import { ApiClientError } from '@/shared/api/client'
import { downloadCsv } from '@/shared/download/csv'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { useAuthorizationRefresh } from '@/shared/auth/useAuthorizationRefresh'

const props = defineProps<{ range?: AuditExportRange; filters: AuditExportFilters; blocked: boolean; contextRevision: number }>()
const { t } = useI18n()
const client = useQueryClient()
const identity = useAccountIdentity()
const authorization = useAuthorizationRefresh()
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const pending = ref(false)
const canExport = computed(() => auth.isSuccess.value && hasAccess(auth.data.value))
const disabled = computed(() => pending.value || props.blocked || !props.range)
let alive = true
let revision = 0
watch([
  () => props.contextRevision,
  () => props.range?.startDate, () => props.range?.endDate,
  () => props.filters.actorId, () => props.filters.resourceType, () => props.filters.action,
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
  const required = ['admin:access', 'audit:read', 'audit:export']
  return required.every(permission => user.permissions.includes(permission))
}

/** Freezes displayed filters and rejects abandoned contexts before any download or feedback. */
async function submit() {
  if (disabled.value || !canExport.value || !hasAccess(client.getQueryData<UserResponse>(['auth', 'me']))) return
  const scope = identity.scope.value
  const requestRevision = revision
  const range = { startDate: props.range!.startDate, endDate: props.range!.endDate }
  const filters = { actorId: props.filters.actorId, resourceType: props.filters.resourceType, action: props.filters.action }
  /** Waits for the parent's synchronous revision to arrive, then checks cache grants directly. */
  const isCurrent = () => alive && revision === requestRevision && identity.isCurrent(scope)
    && hasAccess(client.getQueryData<UserResponse>(['auth', 'me'])) && !props.blocked
  pending.value = true
  try {
    await nextTick()
    if (!isCurrent()) return
    const file = await exportAuditRecords(range, filters)
    await nextTick()
    if (!isCurrent()) return
    downloadCsv(file)
    toast.success(t('auditExport.started'))
  } catch (error) {
    await nextTick()
    if (!isCurrent()) return
    const code = error instanceof ApiClientError ? error.code : 0
    toast.error(t(code === 100002 ? 'auditExport.limitExceeded' : 'auditExport.failed'))
    if ([120001, 401, 403].includes(code)) {
      await authorization.refresh(() => identity.isCurrent(scope))
    }
  } finally { pending.value = false }
}
</script>
<style scoped>
.audit-export { display: flex; align-items: flex-end; flex-direction: column; gap: 6px; min-width: 0; max-width: 100%; }
.audit-export p { max-width: 320px; margin: 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.8125rem; text-align: right; }
@media (max-width: 760px) { .audit-export { align-items: flex-start; } .audit-export p { text-align: left; } }
</style>
