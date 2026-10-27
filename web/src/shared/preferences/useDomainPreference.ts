import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { domainPreferenceKey, getDomainPreference } from '@/entities/user/domain-preference'
import { availableDomainQueryKey, listAvailableDomains } from '@/entities/domain/api'
import { useAccountIdentity } from './useAccountPreferences'

/** Shares one independent preference read for the current account and login epoch. */
export function useDomainPreference() {
  const identity = useAccountIdentity()
  const queryKey = computed(() => [...domainPreferenceKey(identity.scope.value.userId), identity.scope.value.epoch])
  const query = useQuery({ queryKey, queryFn: getDomainPreference, enabled: computed(() => !!identity.scope.value.userId), retry: false, staleTime: Infinity })
  return { ...identity, query, queryKey }
}

/** Retains prefix invalidation while partitioning authorized domains by complete identity. */
export function useAvailableDomainChoices() {
  const identity = useAccountIdentity()
  return useQuery({
    queryKey: computed(() => [...availableDomainQueryKey, identity.scope.value.userId, identity.scope.value.epoch]),
    queryFn: listAvailableDomains,
    enabled: computed(() => !!identity.scope.value.userId),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}
