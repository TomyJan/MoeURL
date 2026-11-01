import { computed, type Ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getTimeZonePreference, timeZonePreferenceKey, type TimeZonePreference } from '@/entities/time-zone-preference/api'
import { useAccountIdentity } from './useAccountPreferences'
import { supportsTimeZone } from '@/shared/lib/date-time'

interface Owner { userId: string; epoch: number }
interface OwnedPreference extends Owner { preference: TimeZonePreference }
class OwnedReadError extends Error {
  constructor(readonly owner: Owner) { super('Time-zone preference unavailable') }
}

/** Rejects previous-observer data and failures synchronously, including same-account relogin. */
export function useTimeZonePreference(confirmed: Ref<boolean>) {
  const identity = useAccountIdentity()
  const client = useQueryClient()
  const queryKey = computed(() => [...timeZonePreferenceKey(identity.scope.value.userId), identity.scope.value.epoch])
  const owns = (owner: Owner) => !!identity.scope.value.userId && owner.userId === identity.scope.value.userId && owner.epoch === identity.scope.value.epoch
  const query = useQuery({
    queryKey, enabled: computed(() => !!identity.scope.value.userId && confirmed.value), retry: false, staleTime: Infinity,
    /** Copies scalar ownership so reactive wrapping cannot change identity comparison. */
    async queryFn({ signal }): Promise<OwnedPreference> {
      const owner = { ...identity.scope.value }
      try {
        const preference = await getTimeZonePreference()
        if (signal.aborted || !owns(owner)) throw new OwnedReadError(owner)
        return { ...owner, preference }
      }
      catch { throw new OwnedReadError(owner) }
    },
  })
  const preference = computed(() => query.data.value && owns(query.data.value) ? query.data.value.preference : undefined)
  const readError = computed(() => query.error.value instanceof OwnedReadError && owns(query.error.value.owner))
  const unsupported = computed(() => !!preference.value?.timeZone && !supportsTimeZone(preference.value.timeZone))
  const effectiveTimeZone = computed(() => readError.value || unsupported.value ? null : preference.value?.timeZone ?? null)
  /** A stale write cannot populate another epoch's cache or resurrect a cancelled read. */
  function publish(owner: Owner, value: TimeZonePreference) {
    if (!identity.isCurrent(owner)) return
    const key = [...timeZonePreferenceKey(owner.userId), owner.epoch]
    void client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData<OwnedPreference>(key, { ...owner, preference: value })
  }
  return { ...identity, query, queryKey, preference, readError, unsupported, effectiveTimeZone, publish }
}
