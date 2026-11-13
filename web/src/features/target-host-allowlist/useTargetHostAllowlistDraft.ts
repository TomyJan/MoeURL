import { onScopeDispose, reactive } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { adminTargetHostAllowlistKey, getTargetHostAllowlist, updateTargetHostAllowlist, UpdateTargetHostAllowlistSchema, type TargetHostAllowlist } from '@/entities/target-host-allowlist/api'
import { ApiClientError } from '@/shared/api/client'
import { useAuthorizationRefresh } from '@/shared/auth/useAuthorizationRefresh'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

interface DraftRow { key: number; host: string }
/** Owns a private draft and retires every asynchronous continuation synchronously. */
export function useTargetHostAllowlistDraft() {
  const client = useQueryClient(), identity = useAccountIdentity(), authorization = useAuthorizationRefresh()
  const state = reactive({ allowed: false, enabled: false, rows: [] as DraftRow[], version: '', loading: false, saving: false, reloadRequired: false, feedback: '', errors: {} as Record<string, boolean> })
  let generation = 0, edited = 0, sequence = 0
  let previousScope: object | undefined, previousPermissions = ''
  let key: readonly unknown[] = [...adminTargetHostAllowlistKey, '', 0, 0]
  /** Applies only a confirmed server document, never sorting the editable rows. */
  function fill(value: TargetHostAllowlist) {
    state.enabled = value.enabled
    state.rows = value.hosts.map(host => ({ key: ++sequence, host }))
    state.version = value.updatedAt; state.reloadRequired = false; state.errors = {}
  }
  /** Keeps conflict barriers until a successful explicit reload. */
  function changed() {
    edited++; state.errors = {}
    if (state.feedback === 'saved') state.feedback = ''
  }
  function idle() { return state.allowed && !!state.version && !state.loading && !state.saving }
  /** Allows newer typing during a read, but never during a pending write. */
  function edit(index: number, host: string) {
    if (!state.allowed || state.saving || !state.version) return
    state.rows[index]!.host = host; changed()
  }
  /** Changes only the local switch and protects it from an older reload. */
  function setEnabled(enabled: boolean) {
    if (!state.allowed || state.saving || !state.version) return
    state.enabled = enabled; changed()
  }
  function add() {
    if (!idle() || state.rows.length >= 100) return
    state.rows.push({ key: ++sequence, host: '' }); changed()
  }
  function remove(index: number) {
    if (!idle()) return
    state.rows.splice(index, 1); changed()
  }
  /** An empty list is still only a draft until explicitly saved. */
  function clear() {
    if (!idle()) return
    state.rows = []; changed()
  }
  /** Clears denied grants synchronously; only the same login round may restore confirmed access. */
  function recoverAuthorization(error: unknown) {
    if (!(error instanceof ApiClientError) || ![120001, 401, 403].includes(error.code)) return false
    const scope = identity.scope.value
    void authorization.refresh(() => identity.isCurrent(scope))
    return true
  }
  /** Rejects stale results before cache insertion and protects edits made mid-read. */
  async function load() {
    if (!state.allowed || state.loading || state.saving) return
    const token = generation, revision = edited, readKey = key
    state.loading = true
    try {
      const value = await client.fetchQuery({ queryKey: readKey, staleTime: 0, retry: false,
        async queryFn() {
          const value = await getTargetHostAllowlist()
          if (token !== generation) throw new Error('Obsolete target policy read')
          return value
        },
      })
      if (token !== generation || revision !== edited) return
      fill(value); state.feedback = ''
    } catch (error) {
      if (token === generation && !recoverAuthorization(error) && state.feedback !== 'saveUnknown') state.feedback = 'loadFailed'
    } finally {
      if (token === generation) state.loading = false
    }
  }
  /** Saves exactly once; ordinary failures preserve the draft while denial retires private state. */
  async function save() {
    if (!idle() || state.reloadRequired) return
    if (state.enabled && !state.rows.length) { state.feedback = 'enabledEmpty'; return }
    const input = UpdateTargetHostAllowlistSchema.safeParse({ enabled: state.enabled, hosts: state.rows.map(row => row.host), expectedUpdatedAt: state.version })
    if (!input.success) {
      state.feedback = 'invalid'; state.errors = {}
      for (const issue of input.error.issues) state.errors[String(issue.path[1])] = true
      return
    }
    const token = generation, saveKey = key
    state.saving = true; state.feedback = ''; state.errors = {}
    try {
      const value = await updateTargetHostAllowlist(input.data)
      if (token !== generation) return
      client.setQueryData(saveKey, value)
      if (token !== generation) return
      fill(value); state.feedback = 'saved'
    } catch (error) {
      if (token === generation) {
        if (recoverAuthorization(error)) return
        const conflict = error instanceof ApiClientError && error.code === 900213
        const rejected = error instanceof ApiClientError && error.code === 900212
        state.feedback = conflict ? 'conflict' : rejected ? 'saveFailed' : 'saveUnknown'; state.reloadRequired = !rejected
      }
    } finally {
      if (token === generation) state.saving = false
    }
  }
  /** Clears old private state before cancelling requests or beginning a new read. */
  function reconcile() {
    const scope = identity.scope.value
    const permissions = client.getQueryData<UserResponse>(['auth', 'me'])?.user?.permissions ?? []
    const signature = ['admin:access', 'system:manage'].map(permission => permissions.includes(permission)).join('\n')
    if (scope === previousScope && signature === previousPermissions) return
    previousScope = scope; previousPermissions = signature; generation++
    void client.cancelQueries({ queryKey: key, exact: true }); client.removeQueries({ queryKey: key, exact: true })
    key = [...adminTargetHostAllowlistKey, scope.userId, scope.epoch, generation]
    Object.assign(state, { allowed: !!scope.userId && permissions.includes('admin:access') && permissions.includes('system:manage'), enabled: false, rows: [], version: '', loading: false, saving: false, reloadRequired: false, feedback: '', errors: {} })
    edited = 0; void load()
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  reconcile()
  onScopeDispose(() => {
    generation++; unsubscribe()
    void client.cancelQueries({ queryKey: key, exact: true }); client.removeQueries({ queryKey: key, exact: true })
    Object.assign(state, { allowed: false, enabled: false, rows: [], version: '', loading: false, saving: false, reloadRequired: false, feedback: '', errors: {} })
  })
  return { state, edit, setEnabled, add, remove, clear, load, save }
}
