import { onScopeDispose, reactive } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { checkTargetPolicyBatch, TargetPolicyBatchCheckInputSchema, type TargetPolicyBatchCheckResult } from '@/entities/target-policy-batch-check/api'
import { ApiClientError } from '@/shared/api/client'
import { useAuthorizationRefresh } from '@/shared/auth/useAuthorizationRefresh'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

/** Binds private batch decisions to the current login, exact draft and explicit request. */
export function useTargetPolicyBatchCheck() {
  const client = useQueryClient(), identity = useAccountIdentity(), authorization = useAuthorizationRefresh()
  const state = reactive({ allowed: false, targets: '', items: [] as TargetPolicyBatchCheckResult['items'], feedback: '', loading: false })
  let active = true, generation = 0, revision = 0, sequence = 0
  let previousScope: object | undefined, previousPermissions = ''

  /** Retires the entire old result immediately, including when a request is still pending. */
  function edit(value: string) {
    if (!active || !state.allowed) return
    revision++; state.targets = value; state.items = []; state.feedback = ''; state.loading = false
  }

  /** Preserves every input line and accepts only continuations belonging to this request. */
  async function check() {
    if (!active || !state.allowed || state.loading) return
    const input = TargetPolicyBatchCheckInputSchema.safeParse({ targetUrls: state.targets.split(/\r?\n/) })
    if (!input.success) { state.feedback = 'invalid'; return }
    const token = generation, edited = revision, request = ++sequence
    const current = () => active && state.allowed && token === generation && edited === revision && request === sequence
    state.loading = true; state.items = []; state.feedback = ''
    try {
      const value = await checkTargetPolicyBatch(input.data)
      if (current()) state.items = value.items
    } catch (error) {
      if (!current()) return
      if (error instanceof ApiClientError && [120001, 401, 403].includes(error.code)) {
        const scope = identity.scope.value
        void authorization.refresh(() => identity.isCurrent(scope))
      } else state.feedback = error instanceof ApiClientError && error.code === 900227 ? 'invalid' : 'failed'
    } finally {
      if (current()) state.loading = false
    }
  }

  /** Clears private input and results synchronously when login or either required grant changes. */
  function reconcile() {
    const scope = identity.scope.value
    const permissions = client.getQueryData<UserResponse>(['auth', 'me'])?.user?.permissions ?? []
    const signature = ['admin:access', 'system:manage'].map(permission => permissions.includes(permission)).join('\n')
    if (scope === previousScope && signature === previousPermissions) return
    previousScope = scope; previousPermissions = signature; generation++
    Object.assign(state, { allowed: !!scope.userId && permissions.includes('admin:access') && permissions.includes('system:manage'), targets: '', items: [], feedback: '', loading: false })
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  reconcile()
  onScopeDispose(() => {
    active = false; generation++; unsubscribe()
    Object.assign(state, { allowed: false, targets: '', items: [], feedback: '', loading: false })
  })
  return { state, edit, check }
}
