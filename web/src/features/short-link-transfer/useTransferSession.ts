import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { me, type UserResponse } from '@/entities/auth/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

/** Pins privileged handoffs to the existing account epoch and confirmed current grants. */
export function useTransferSession(pending: Ref<boolean>, onClose: () => void, requireRead = false) {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const scope = identity.scope.value
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
  const dismissed = ref(false)
  let alive = true
  /** Reads grants directly at submission and completion, including same-tick revocations. */
  function hasPermission(response = client.getQueryData<UserResponse>(['auth', 'me'])) {
    const user = response?.user
    return !!user && user.id === scope.userId && user.group !== 'guest' && user.permissions.includes('admin:access')
      && user.permissions.includes('short_link:update_all') && (!requireRead || user.permissions.includes('short_link:read_all'))
  }
  const allowed = computed(() => identity.isCurrent(scope) && !!scope.userId && hasPermission(auth.data.value))
  watch(allowed, value => { if (!value && !dismissed.value) { dismissed.value = true; onClose() } }, { flush: 'sync' })
  onBeforeUnmount(() => { alive = false })
  /** Suppresses stale completions after dismissal, unmount, account change or lost grants. */
  function isCurrent() { return alive && !dismissed.value && identity.isCurrent(scope) && hasPermission() }
  /** Keeps dismissal locked while a privileged write is outstanding. */
  function close() { if (!pending.value && !dismissed.value) { dismissed.value = true; onClose() } }
  /** Refreshes all ownership-dependent views after a completed attempt. */
  function invalidate() {
    for (const key of ['admin-short-link', 'short-link', 'short-link-overview', 'short-link-statistics', 'insights']) void client.invalidateQueries({ queryKey: [key] })
  }
  return { allowed, dismissed, isCurrent, close, invalidate }
}
