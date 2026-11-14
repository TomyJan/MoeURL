import { onScopeDispose, reactive } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { checkTargetPolicy, TargetPolicyCheckInputSchema, type TargetPolicyCheckResult } from '@/entities/target-policy-check/api'
import { ApiClientError } from '@/shared/api/client'
import { useAuthorizationRefresh } from '@/shared/auth/useAuthorizationRefresh'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

/** Keeps a single private check bound to its login, input and explicit request. */
export function useTargetPolicyCheck() {
  const client = useQueryClient(), identity = useAccountIdentity(), authorization = useAuthorizationRefresh()
  const state = reactive({ allowed: false, targetUrl: '', outcome: '' as '' | TargetPolicyCheckResult['outcome'], feedback: '', loading: false })
  let active = true, generation = 0, revision = 0, sequence = 0
  let previousScope: object | undefined, previousPermissions = ''

  /** Editing immediately retires the decision and permits a new explicit check. */
  function edit(value: string) {
    if (!active || !state.allowed) return
    revision++; state.targetUrl = value; state.outcome = ''; state.feedback = ''; state.loading = false
  }

  /** Sends once and accepts continuations only while all three scopes still match. */
  async function check() {
    if (!active || !state.allowed || state.loading) return
    const input = TargetPolicyCheckInputSchema.safeParse({ targetUrl: state.targetUrl })
    if (!input.success) { state.feedback = 'invalid'; return }
    const token = generation, edited = revision, request = ++sequence
    const current = () => active && state.allowed && token === generation && edited === revision && request === sequence
    state.loading = true; state.outcome = ''; state.feedback = ''
    try {
      const value = await checkTargetPolicy(input.data)
      if (current()) state.outcome = value.outcome
    } catch (error) {
      if (!current()) return
      if (error instanceof ApiClientError && [120001, 401, 403].includes(error.code)) {
        const scope = identity.scope.value
        void authorization.refresh(() => identity.isCurrent(scope))
      } else state.feedback = error instanceof ApiClientError && error.code === 900226 ? 'invalid' : 'failed'
    } finally {
      if (current()) state.loading = false
    }
  }

  /** Clears private state synchronously on login or relevant authorization changes. */
  function reconcile() {
    const scope = identity.scope.value
    const permissions = client.getQueryData<UserResponse>(['auth', 'me'])?.user?.permissions ?? []
    const signature = ['admin:access', 'system:manage'].map(permission => permissions.includes(permission)).join('\n')
    if (scope === previousScope && signature === previousPermissions) return
    previousScope = scope; previousPermissions = signature; generation++
    Object.assign(state, { allowed: !!scope.userId && permissions.includes('admin:access') && permissions.includes('system:manage'), targetUrl: '', outcome: '', feedback: '', loading: false })
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  reconcile()
  onScopeDispose(() => {
    active = false; generation++; unsubscribe()
    Object.assign(state, { allowed: false, targetUrl: '', outcome: '', feedback: '', loading: false })
  })
  return { state, edit, check }
}
