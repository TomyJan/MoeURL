import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getCurrentGroupDefaultDomain, groupDefaultDomainQueryKey } from '@/entities/user-group/domain-default'
import { useAccountIdentity } from './useAccountPreferences'

/** Partitions group selection by login epoch while allowing focus and online refreshes. */
export function useGroupDefaultDomain() {
  const identity = useAccountIdentity()
  return useQuery({
    queryKey: computed(() => [...groupDefaultDomainQueryKey, identity.scope.value.userId, identity.scope.value.epoch]),
    queryFn: getCurrentGroupDefaultDomain,
    enabled: computed(() => !!identity.scope.value.userId),
    retry: false,
    staleTime: 0,
  })
}
