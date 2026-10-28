import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { domainRedirectDefaultsQueryKey, listDomainRedirectDefaults } from '@/entities/domain/redirect-default'
import { useAccountIdentity } from './useAccountPreferences'

/** Observes the independent domain defaults without changing the application client. */
export function useDomainRedirectDefaults(enabled: MaybeRefOrGetter<boolean> = true) {
  const identity = useAccountIdentity()
  return useQuery({
    queryKey: computed(() => [...domainRedirectDefaultsQueryKey, identity.scope.value.userId, identity.scope.value.epoch]),
    queryFn: listDomainRedirectDefaults,
    enabled: computed(() => !!identity.scope.value.userId && toValue(enabled)),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}
