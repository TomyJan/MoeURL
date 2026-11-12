import { onBeforeUnmount, ref, shallowRef } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { getOwnDailyCreateUsage, OwnDailyCreateUsageOwnerSchema, type OwnDailyCreateUsage } from '@/entities/account-daily-create-quota/usage'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { useAuthorizationRefresh } from '@/shared/auth/useAuthorizationRefresh'

/** Owns one private snapshot; login epochs and request generations retire late replies. */
export function useOwnDailyCreateUsage() {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const authorization = useAuthorizationRefresh()
  const data = shallowRef<OwnDailyCreateUsage>()
  const state = ref<'idle' | 'loading' | 'success' | 'error' | 'denied' | 'recovering'>('idle')
  const visible = ref(false)
  let scope = identity.scope.value
  let generation = 0
  let alive = true
  let allowed = false
  let denied = false
  let recovering = false

  /** Requires a confirmed canonical owner and the current cache grant. */
  function hasAccess() {
    const user = client.getQueryData<UserResponse>(['auth', 'me'])?.user
    return OwnDailyCreateUsageOwnerSchema.safeParse(scope.userId).success
      && user?.id === scope.userId && user.permissions.includes('short_link:create')
  }
  /** Cancels cache publication even when the underlying HTTP request cannot abort. */
  function clear() {
    const queryKey = ['account-daily-create-usage', scope.userId, scope.epoch]
    void client.cancelQueries({ queryKey })
    client.removeQueries({ queryKey })
    data.value = undefined
  }
  /** Loads explicitly without an observer, retry, focus refresh or reconnect polling. */
  async function load() {
    if (!alive || !allowed || denied || recovering || state.value === 'loading' || !hasAccess()) return
    const owner = scope
    const token = ++generation
    const current = () => alive && token === generation && identity.isCurrent(owner) && allowed && hasAccess()
    clear()
    state.value = 'loading'
    try {
      const value = await client.fetchQuery({
        queryKey: ['account-daily-create-usage', owner.userId, owner.epoch], retry: false, staleTime: 0,
        async queryFn() {
          const value = await getOwnDailyCreateUsage(owner.userId)
          if (!current()) throw Error('Retired usage request')
          return value
        },
      })
      if (!current()) return
      data.value = value
      state.value = 'success'
    } catch (error) {
      if (!current()) return
      clear()
      if (error instanceof ApiClientError && [120001, 401, 403].includes(error.code)) {
        denied = true
        allowed = false
        state.value = 'denied'
      } else state.value = 'error'
    }
  }
  /** Clears revoked scopes synchronously before another account's reply can publish. */
  function reconcile() {
    const next = identity.scope.value
    if (next !== scope) {
      generation++
      clear()
      scope = next
      allowed = denied = recovering = false
      state.value = 'idle'
    }
    if (recovering) return
    if (!hasAccess()) {
      if (allowed) { generation++; clear(); allowed = false }
      visible.value = denied && OwnDailyCreateUsageOwnerSchema.safeParse(scope.userId).success
      state.value = visible.value ? 'denied' : 'idle'
      return
    }
    visible.value = true
    if (denied) { state.value = 'denied'; return }
    if (!allowed) { allowed = true; void load() }
  }
  /** Explicit recovery refreshes auth first while suppressing automatic reads. */
  async function recover() {
    if (!alive || !denied || recovering) return
    const owner = scope
    const token = ++generation
    const current = () => alive && token === generation && identity.isCurrent(owner)
    clear()
    recovering = true
    state.value = 'recovering'
    await authorization.refresh(current)
    if (!current()) return
    recovering = false
    denied = !hasAccess()
    allowed = false
    reconcile()
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  onBeforeUnmount(() => { alive = false; generation++; unsubscribe(); clear() })
  reconcile()
  return { data, state, visible, refresh: load, recover }
}
