import { onScopeDispose, reactive } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { adminAccountDailyCreateQuotaKey, getAccountDailyCreateQuota, updateAccountDailyCreateQuota, UpdateAccountDailyCreateQuotaSchema, type AccountDailyCreateQuota } from '@/entities/account-daily-create-quota/api'
import { ApiClientError } from '@/shared/api/client'
import { useAuthorizationRefresh } from '@/shared/auth/useAuthorizationRefresh'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

/** Owns the private quota draft and retires every old asynchronous continuation. */
export function useAccountDailyCreateQuotaDraft() {
  const client = useQueryClient(), identity = useAccountIdentity(), authorization = useAuthorizationRefresh()
  const state = reactive({ allowed: false, enabled: false, limit: '0', version: '', loading: false, saving: false, reloadRequired: false, feedback: '', invalid: false })
  let generation = 0, edited = 0
  let previousScope: object | undefined, previousPermissions = ''
  let key: readonly unknown[] = [...adminAccountDailyCreateQuotaKey, '', 0, 0]
  /** Replaces fields and the exact revision only after a confirmed server response. */
  function fill(value: AccountDailyCreateQuota) {
    state.enabled = value.dailyLimit !== null; state.limit = String(value.dailyLimit ?? 0)
    state.version = value.updatedAt; state.reloadRequired = false; state.invalid = false
  }
  function changed() { edited++; state.invalid = false; if (state.feedback === 'saved') state.feedback = '' }
  /** Allows typing during reload but not a write or a retired identity. */
  function edit(value: unknown) {
    if (!state.allowed || state.saving || !state.version) return
    state.limit = String(value ?? ''); changed()
  }
  /** Keeps the local number while switching enforcement off and back on. */
  function setEnabled(enabled: boolean) {
    if (!state.allowed || state.saving || !state.version) return
    state.enabled = enabled; changed()
  }
  function idle() { return state.allowed && !!state.version && !state.loading && !state.saving }
  /** Clears denied grants before recovery and scopes recovery to this login round. */
  function recoverAuthorization(error: unknown) {
    if (!(error instanceof ApiClientError) || ![120001, 401, 403].includes(error.code)) return false
    const scope = identity.scope.value
    void authorization.refresh(() => identity.isCurrent(scope))
    return true
  }
  /** Rejects obsolete reads before cache insertion and never overwrites newer typing. */
  async function load() {
    if (!state.allowed || state.loading || state.saving) return
    const token = generation, revision = edited, readKey = key
    state.loading = true
    try {
      const value = await client.fetchQuery({ queryKey: readKey, staleTime: 0, retry: false,
        async queryFn() {
          const value = await getAccountDailyCreateQuota()
          if (token !== generation) throw new Error('Obsolete daily quota read')
          return value
        },
      })
      if (token !== generation || revision !== edited) return
      fill(value); state.feedback = ''
    } catch (error) {
      if (token === generation && !recoverAuthorization(error)) state.feedback = 'loadFailed'
    } finally { if (token === generation) state.loading = false }
  }
  /** Saves once; conflicts preserve the draft until a successful explicit reload. */
  async function save() {
    if (!idle() || state.reloadRequired) return
    const dailyLimit = state.enabled ? (/^[0-9]+$/.test(state.limit) ? Number(state.limit) : NaN) : null
    const input = UpdateAccountDailyCreateQuotaSchema.safeParse({ dailyLimit, expectedUpdatedAt: state.version })
    if (!input.success) { state.feedback = 'invalid'; state.invalid = true; return }
    const token = generation, saveKey = key
    state.saving = true; state.feedback = ''; state.invalid = false
    try {
      const value = await updateAccountDailyCreateQuota(input.data)
      if (token !== generation) return
      client.setQueryData(saveKey, value)
      if (token !== generation) return
      fill(value); state.feedback = 'saved'
    } catch (error) {
      if (token === generation) {
        if (recoverAuthorization(error)) return
        const conflict = error instanceof ApiClientError && error.code === 900215
        state.feedback = conflict ? 'conflict' : 'saveFailed'; state.reloadRequired = conflict
      }
    } finally { if (token === generation) state.saving = false }
  }
  /** Retires private fields before cancelling requests or starting the next read. */
  function reconcile() {
    const scope = identity.scope.value
    const permissions = client.getQueryData<UserResponse>(['auth', 'me'])?.user?.permissions ?? []
    const signature = [...permissions].sort().join('\n')
    if (scope === previousScope && signature === previousPermissions) return
    previousScope = scope; previousPermissions = signature; generation++
    void client.cancelQueries({ queryKey: key, exact: true }); client.removeQueries({ queryKey: key, exact: true })
    key = [...adminAccountDailyCreateQuotaKey, scope.userId, scope.epoch, generation]
    Object.assign(state, { allowed: !!scope.userId && permissions.includes('admin:access') && permissions.includes('system:manage'), enabled: false, limit: '0', version: '', loading: false, saving: false, reloadRequired: false, feedback: '', invalid: false })
    edited = 0; void load()
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  reconcile()
  onScopeDispose(() => {
    generation++; unsubscribe()
    void client.cancelQueries({ queryKey: key, exact: true }); client.removeQueries({ queryKey: key, exact: true })
    Object.assign(state, { allowed: false, enabled: false, limit: '0', version: '', loading: false, saving: false, reloadRequired: false, feedback: '', invalid: false })
  })
  return { state, edit, setEnabled, load, save }
}
