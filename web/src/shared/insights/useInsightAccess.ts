import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import { me } from '@/entities/auth/api'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const readInstances = new WeakMap<QueryClient, number>()

/** Scopes private reads to a unique mount, the login epoch and observed permission transitions. */
export function useInsightAccess(required: MaybeRefOrGetter<string[]>) {
  const client = useQueryClient()
  const instance = (readInstances.get(client) ?? 0) + 1
  readInstances.set(client, instance)
  const identity = useAccountIdentity()
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
  const revision = ref(0)
  const permissions = computed(() => auth.data.value?.user.permissions ?? [])
  const allowed = computed(() => auth.isSuccess.value && !!identity.scope.value.userId && toValue(required).every((permission) => permissions.value.includes(permission)))
  watch([allowed, () => permissions.value.join('\n')], () => { revision.value++ }, { flush: 'sync' })
  const scope = computed(() => [identity.scope.value.userId, identity.scope.value.epoch, revision.value, instance] as const)
  return { allowed, scope }
}

/** Distinguishes confirmed access failures from network or malformed-data failures. */
export function isInsightAccessError(error: unknown) {
  return error instanceof ApiClientError && [401, 403, 120001, 200104].includes(error.code)
}
