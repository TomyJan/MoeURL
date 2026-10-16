import { computed, shallowRef } from 'vue'
import { QueryClient, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { accountPreferencesKey, getAccountPreferences } from '@/entities/user/preferences'
import { resetAccountPreferences, useAppPreferences } from './useAppPreferences'

interface IdentityScope { userId: string; epoch: number }
const identities = new WeakMap<QueryClient, ReturnType<typeof createIdentity>>()

/** Tracks synchronous cache identity transitions, including a same-account login after guest. */
function createIdentity(client: QueryClient) {
  const scope = shallowRef<IdentityScope>({ userId: '', epoch: 0 })
  let hydratedEpoch = -1
  /** Restores the browser baseline before starting any new account's reads. */
  function reconcile() {
    const user = client.getQueryData<UserResponse>(['auth', 'me'])?.user
    const userId = user && user.group !== 'guest' && user.username !== 'guest' ? user.id : ''
    if (scope.value.userId === userId) return
    const previous = scope.value.userId
    scope.value = { userId, epoch: scope.value.epoch + 1 }
    resetAccountPreferences()
    if (previous) {
      void client.cancelQueries({ queryKey: accountPreferencesKey(previous) })
      client.removeQueries({ queryKey: accountPreferencesKey(previous) })
    }
  }
  client.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  reconcile()
  return {
    scope,
    /** Checks the complete identity epoch rather than only a reusable user ID. */
    isCurrent: (candidate: IdentityScope) => scope.value === candidate,
    /** Claims automatic hydration once per confirmed identity, including retries after failure. */
    claimHydration(candidate: IdentityScope) {
      if (scope.value !== candidate || hydratedEpoch === candidate.epoch) return false
      hydratedEpoch = candidate.epoch
      return true
    },
    /** Prevents a pending automatic read from overriding a successful explicit save. */
    markSaved() { hydratedEpoch = scope.value.epoch },
  }
}

/** Shares the identity guard among the application observer and account editor. */
function getIdentity(client: QueryClient) {
  let identity = identities.get(client)
  if (!identity) { identity = createIdentity(client); identities.set(client, identity) }
  return identity
}

/** Revokes identity synchronously; password changes additionally cancel every private data read. */
export function revokeAccountIdentity(client: QueryClient, cancelAllReads = false) {
  const cancelled = client.cancelQueries(cancelAllReads ? {} : { queryKey: ['auth', 'me'] })
  client.setQueryData<UserResponse>(['auth', 'me'], { user: { id: '', username: 'guest', nickname: '', group: 'guest', permissions: [] } })
  resetAccountPreferences()
  client.removeQueries({ queryKey: ['user', 'preferences'] })
  return cancelled
}

/** Loads account values with a cache key and response guard scoped to the current login epoch. */
export function useAccountPreferences() {
  const client = useQueryClient()
  const identity = getIdentity(client)
  const preferences = useAppPreferences()
  const queryKey = computed(() => [...accountPreferencesKey(identity.scope.value.userId), identity.scope.value.epoch])
  const query = useQuery({
    queryKey,
    enabled: computed(() => !!identity.scope.value.userId),
    retry: false,
    staleTime: Infinity,
    /** Applies only the first successful automatic read for this exact identity. */
    async queryFn() {
      const scope = identity.scope.value
      const value = await getAccountPreferences()
      if (identity.claimHydration(scope)) preferences.applyAccountPreferences(value, true)
      return value
    },
  })
  return { ...identity, query, queryKey, preferences, client }
}
