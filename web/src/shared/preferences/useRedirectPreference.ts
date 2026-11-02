import { computed, type Ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getRedirectPreference, redirectPreferenceKey, type RedirectPreference } from '@/entities/redirect-preference/api'
import { useAccountIdentity } from './useAccountPreferences'

interface Owner { userId: string; epoch: number }
interface OwnedPreference extends Owner { preference: RedirectPreference }
class OwnedReadError extends Error {
  constructor(readonly owner: Owner) { super('Redirect preference unavailable') }
}

/** Scalar ownership hides old observers synchronously, including a same-account new login. */
export function useRedirectPreference(confirmed: Ref<boolean>) {
  const identity = useAccountIdentity()
  const client = useQueryClient()
  const queryKey = computed(() => [...redirectPreferenceKey(identity.scope.value.userId), identity.scope.value.epoch] as const)
  const owns = (owner: Owner) => !!owner.userId && owner.userId === identity.scope.value.userId && owner.epoch === identity.scope.value.epoch
  const query = useQuery({
    queryKey, enabled: computed(() => !!identity.scope.value.userId && confirmed.value), retry: false, staleTime: Infinity,
    /** Checks the captured epoch before and after HTTP, and binds the server read to the expected account. */
    async queryFn({ signal, queryKey: [, , userId, epoch] }): Promise<OwnedPreference> {
      const owner = { userId, epoch }
      try {
        if (signal.aborted || !owns(owner)) throw new OwnedReadError(owner)
        const preference = await getRedirectPreference(owner.userId)
        if (signal.aborted || !owns(owner)) throw new OwnedReadError(owner)
        return { ...owner, preference }
      } catch { throw new OwnedReadError(owner) }
    },
  })
  const preference = computed(() => query.data.value && owns(query.data.value) ? query.data.value.preference : undefined)
  const readError = computed(() => query.error.value instanceof OwnedReadError && owns(query.error.value.owner))
  /** Replaces only the current owner's exact cache entry and prevents an older read from overwriting it. */
  function publish(owner: Owner, preference: RedirectPreference) {
    if (!identity.isCurrent(owner)) return
    const key = [...redirectPreferenceKey(owner.userId), owner.epoch]
    void client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData<OwnedPreference>(key, { ...owner, preference })
  }
  return { ...identity, query, queryKey, preference, readError, publish }
}
