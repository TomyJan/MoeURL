import { computed, type Ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getListPreference, listPreferenceKey, type ListPreference } from '@/entities/list-preference/api'
import { useAccountIdentity } from './useAccountPreferences'

interface Owner { userId: string; epoch: number }
interface OwnedPreference extends Owner { preference: ListPreference }
class OwnedReadError extends Error {
  constructor(readonly owner: Owner) { super('List preference unavailable') }
}

/** Shares real server data within one login epoch, independently of each list's deadline. */
export function useListPreference(confirmed: Ref<boolean>) {
  const identity = useAccountIdentity()
  const client = useQueryClient()
  const queryKey = computed(() => [...listPreferenceKey(identity.scope.value.userId), identity.scope.value.epoch] as const)
  const owns = (owner: Owner) => !!owner.userId && owner.userId === identity.scope.value.userId && owner.epoch === identity.scope.value.epoch
  const query = useQuery({
    queryKey, enabled: computed(() => !!identity.scope.value.userId && confirmed.value),
    retry: false, staleTime: Infinity, refetchOnWindowFocus: false,
    /** Guards both boundaries even when an HTTP implementation cannot cancel its response. */
    async queryFn({ signal, queryKey: [, , userId, epoch] }): Promise<OwnedPreference> {
      const owner = { userId, epoch }
      try {
        if (signal.aborted || !owns(owner)) throw new OwnedReadError(owner)
        const preference = await getListPreference(userId)
        if (signal.aborted || !owns(owner)) throw new OwnedReadError(owner)
        return { ...owner, preference }
      } catch { throw new OwnedReadError(owner) }
    },
  })
  const preference = computed(() => query.data.value && owns(query.data.value) ? query.data.value.preference : undefined)
  const readError = computed(() => query.error.value instanceof OwnedReadError && owns(query.error.value.owner))
  /** Publishes a successful write after retiring an older read of this exact document. */
  function publish(owner: Owner, preference: ListPreference) {
    if (!identity.isCurrent(owner)) return
    const key = [...listPreferenceKey(owner.userId), owner.epoch]
    void client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData<OwnedPreference>(key, { ...owner, preference })
  }
  return { ...identity, query, queryKey, preference, readError, publish }
}
