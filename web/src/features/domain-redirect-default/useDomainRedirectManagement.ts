import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { ManagedDomain } from '@/entities/domain/api'
import { adminDomainRedirectDefaultQueryKey, domainRedirectDefaultsQueryKey, getDomainRedirectDefault, setDomainRedirectDefault, type SetDomainRedirectDefaultInput } from '@/entities/domain/redirect-default'
import type { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { ApiClientError } from '@/shared/api/client'

interface ManagementInputs {
  domain: Ref<ManagedDomain | undefined>
  identity: ReturnType<typeof useAccountIdentity>
  eligible: Ref<boolean>
  denied: Ref<boolean>
  removed: Ref<boolean>
  dirty: Ref<boolean>
  legacyDirty: Ref<boolean>
  legacyBusy: Ref<boolean>
  list: { isError: Ref<boolean>; refetch: () => Promise<{ isSuccess: boolean; data?: { items: ManagedDomain[] } }> }
  adopt: (domain: ManagedDomain) => void
}

/** Coordinates only the third domain draft; legacy commands keep their existing DTOs. */
export function useDomainRedirectManagement(input: ManagementInputs) {
  const client = useQueryClient()
  const revision = ref(0)
  const conflicted = ref(false)
  const barrier = ref(false)
  const reloading = ref(false)
  const feedback = ref<'saved' | 'conflict' | 'failed' | ''>('')
  let mounted = true
  onBeforeUnmount(() => { mounted = false })
  const key = computed(() => [...adminDomainRedirectDefaultQueryKey, input.identity.scope.value.userId, input.identity.scope.value.epoch, input.domain.value?.id ?? ''])
  const query = useQuery({
    queryKey: key,
    queryFn: ({ queryKey }) => getDomainRedirectDefault(queryKey[3] as string),
    enabled: computed(() => input.eligible.value && !input.denied.value && !!input.domain.value && !input.removed.value),
    retry: false, staleTime: 0, refetchOnWindowFocus: true,
  })
  const setting = computed(() => {
    const value = query.data.value?.setting
    return input.eligible.value && !input.denied.value && value?.domainId === input.domain.value?.id ? value : undefined
  })

  /** Retains exact target and login-round ownership across every awaited boundary. */
  function current(scope: typeof input.identity.scope.value, id: string) {
    return mounted && input.identity.isCurrent(scope) && input.eligible.value && input.domain.value?.id === id
  }

  /** Both resources must be read successfully before a post-save write barrier is released. */
  async function refresh() {
    await nextTick()
    const scope = input.identity.scope.value
    const id = input.domain.value?.id
    if (!id) return input.eligible.value
    if (!current(scope, id) || input.removed.value) return false
    reloading.value = true
    const targetKey = [...key.value]
    try {
      await client.cancelQueries({ queryKey: targetKey })
      if (!current(scope, id)) return false
      const [list, value] = await Promise.all([input.list.refetch(), client.fetchQuery({ queryKey: targetKey, queryFn: () => getDomainRedirectDefault(id), staleTime: 0 })])
      if (!current(scope, id) || !list.isSuccess) return false
      const domain = list.data!.items.find((domain) => domain.id === id)
      if (!domain || domain.updatedAt !== value.setting.updatedAt) return false
      if (!input.legacyDirty.value) input.adopt(domain)
      input.dirty.value = false; conflicted.value = false; barrier.value = false; revision.value++
      return true
    } catch { return false }
    finally { if (current(scope, id)) reloading.value = false }
  }

  const mutation = useMutation({
    retry: false,
    /** Cancels an older settings read before sending one explicitly scoped write. */
    async mutationFn(operation: { input: SetDomainRedirectDefaultInput; scope: typeof input.identity.scope.value; key: readonly unknown[] }) {
      await client.cancelQueries({ queryKey: operation.key })
      if (!current(operation.scope, operation.input.id)) throw new Error('Stale domain redirect operation')
      return setDomainRedirectDefault(operation.input)
    },
    /** Acknowledges the authoritative response without fabricating a legacy managed-domain DTO. */
    async onSuccess(value, operation) {
      if (!current(operation.scope, operation.input.id)) return
      client.setQueryData(operation.key, value)
      barrier.value = true; feedback.value = 'saved'
      await refresh()
      if (current(operation.scope, operation.input.id)) void client.invalidateQueries({ queryKey: domainRedirectDefaultsQueryKey })
    },
    /** Keeps failed drafts and never turns denial or conflict into a silent automatic retry. */
    onError(error, operation) {
      if (!current(operation.scope, operation.input.id)) return
      if (error instanceof ApiClientError && [401, 403, 120001].includes(error.code)) { input.denied.value = true; feedback.value = ''; return }
      if (error instanceof ApiClientError && error.code === 210103) { conflicted.value = true; feedback.value = 'conflict'; return }
      barrier.value = true; feedback.value = 'failed'
    },
  })
  const pending = computed(() => mutation.isPending.value || reloading.value)
  const blocked = computed(() => pending.value || barrier.value || input.legacyBusy.value || input.legacyDirty.value || input.list.isError.value || query.isError.value || input.denied.value || !input.eligible.value || input.removed.value || !setting.value)

  /** Accepts only the current editor's original full revision and one mode value. */
  function save(value: SetDomainRedirectDefaultInput) {
    if (blocked.value || conflicted.value || value.id !== input.domain.value?.id) return
    feedback.value = ''
    mutation.mutate({ input: value, scope: input.identity.scope.value, key: [...key.value] })
  }
  /** Explicit recovery can read a denied query after the parent has freshly verified auth/me. */
  async function reload() {
    if (pending.value || input.legacyBusy.value) return false
    return refresh()
  }
  /** Selection and account transitions retire only this editor's local feedback. */
  function clear() {
    mutation.reset()
    input.dirty.value = false; conflicted.value = false; barrier.value = false; reloading.value = false; feedback.value = ''; revision.value++
  }
  watch(input.identity.scope, clear, { flush: 'sync' })
  watch(() => input.domain.value?.id, clear, { flush: 'sync' })
  watch(() => input.domain.value?.updatedAt, (next, previous) => {
    if (!next || !previous || next === previous || mutation.isPending.value) return
    if (input.dirty.value) conflicted.value = true
    else void query.refetch()
  })
  watch(() => setting.value?.updatedAt, (next, previous) => {
    if (previous && next && next !== previous && input.dirty.value && !mutation.isPending.value) conflicted.value = true
  })
  watch(query.error, (error) => {
    if (error instanceof ApiClientError && [401, 403, 120001].includes(error.code) && input.eligible.value) { input.denied.value = true; feedback.value = '' }
  }, { flush: 'post' })
  return { query, setting, revision, conflicted, pending, blocked, barrier, feedback, save, reload, recoverAccess: refresh }
}
