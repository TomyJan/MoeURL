<template>
  <div v-if="canExport" class="analytics-export">
    <v-btn data-testid="analytics-export" color="primary" variant="tonal" :disabled="disabled" :loading="pending" @click="submit">
      {{ t('analytics.exportCsv') }}
    </v-btn>
    <p>{{ t('analytics.exportDescription') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { exportShortLinkStatistics, type AnalyticsContext } from '@/entities/short-link/export'
import type { ShortLinkStatisticsResponse } from '@/entities/short-link/model'
import { downloadCsv } from '@/shared/download/csv'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const props = defineProps<{
  id: string
  context: AnalyticsContext
  statistics?: ShortLinkStatisticsResponse
  blocked: boolean
  appliedRangeKey: string
}>()
const { t } = useI18n()
const client = useQueryClient()
const identity = useAccountIdentity()
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const pending = ref(false)
const canExport = computed(() => auth.isSuccess.value && hasAccess(auth.data.value))
const disabled = computed(() => pending.value || props.blocked || !props.statistics || props.statistics.shortLink.id !== props.id)
let alive = true
let revision = 0
watch([
  () => props.id, () => props.context, () => props.appliedRangeKey,
  () => props.statistics?.range.startDate, () => props.statistics?.range.endDate,
  () => props.blocked, identity.scope, canExport,
], () => { revision++ }, { flush: 'sync' })
onBeforeUnmount(() => { alive = false })

/** Uses the existing authenticated permission view for both presentation and completion checks. */
function hasAccess(response: UserResponse | undefined) {
  const user = response?.user
  if (!user?.id || user.group === 'guest' || user.username === 'guest') return false
  const permissions = user.permissions
  return permissions.includes('short_link:export_statistics') && (props.context === 'own'
    ? permissions.includes('short_link:read_own')
    : permissions.includes('admin:access') && permissions.includes('short_link:read_all'))
}

/** Pins the displayed range and login epoch, rejecting every response from an abandoned context. */
async function submit() {
  if (disabled.value || !canExport.value) return
  const scope = identity.scope.value
  const requestRevision = revision
  const range = { startDate: props.statistics!.range.startDate, endDate: props.statistics!.range.endDate }
  /** Checks cache identity synchronously, including before query observers have rendered a logout. */
  const isCurrent = () => alive && revision === requestRevision && identity.isCurrent(scope)
    && hasAccess(client.getQueryData<UserResponse>(['auth', 'me'])) && !props.blocked
  pending.value = true
  try {
    const file = await exportShortLinkStatistics(props.id, range, props.context)
    if (!isCurrent()) return
    downloadCsv(file)
    toast.success(t('analytics.exportStarted'))
  } catch {
    if (isCurrent()) toast.error(t('analytics.exportFailed'))
  } finally {
    pending.value = false
  }
}
</script>

<style scoped>
.analytics-export { display: flex; align-items: flex-end; flex-direction: column; gap: 6px; min-width: 0; max-width: 100%; }
.analytics-export p { max-width: 300px; margin: 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.8125rem; text-align: right; }
@media (max-width: 760px) {
  .analytics-export { align-items: flex-start; }
  .analytics-export p { text-align: left; }
}
</style>
