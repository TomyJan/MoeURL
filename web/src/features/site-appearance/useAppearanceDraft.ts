import { onScopeDispose, reactive } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { adminAppearanceKey, getAppearance, UpdateAppearanceSchema, updateAppearance, type AccentPreset, type AppearanceSettings } from '@/entities/appearance/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { ApiClientError } from '@/shared/api/client'
import { publishAppearance } from '@/shared/site/useSiteAppearance'

/** Owns this independent draft inside one synchronous identity/permission generation. */
export function useAppearanceDraft() {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const state = reactive({ allowed: false, accentPreset: 'iris' as AccentPreset, version: '', loading: false, saving: false, feedback: '' })
  let generation = 0, edited = 0
  let previousScope: object | undefined
  let previousPermissions = ''
  let key: readonly unknown[] = [...adminAppearanceKey, '', 0, 0]
  /** Accepts only a current server document, retaining its full revision string. */
  function fill(value: AppearanceSettings) {
    state.accentPreset = value.accentPreset
    state.version = value.updatedAt
  }
  /** Records edits so a pending explicit reload cannot replace them. */
  function edit(value: AccentPreset) {
    state.accentPreset = value; edited++
    if (state.feedback === 'saved') state.feedback = ''
  }
  /** Reads private state with both a response-generation and an edit-revision guard. */
  async function load() {
    if (!state.allowed || state.loading || state.saving) return
    const token = generation, revision = edited
    state.loading = true
    try {
      const value = await client.fetchQuery({ queryKey: key, staleTime: 0, retry: false,
        async queryFn() {
          const value = await getAppearance()
          if (token !== generation) throw new Error('Obsolete appearance management read')
          return value
        },
      })
      if (token !== generation || revision !== edited) return
      fill(value); state.feedback = ''
    } catch {
      if (token === generation) state.feedback = 'loadFailed'
    } finally {
      if (token === generation) state.loading = false
    }
  }
  /** Submits once and guards success, error and finally against stale identity generations. */
  async function save() {
    if (!state.allowed || !state.version || state.saving || state.loading) return
    const input = UpdateAppearanceSchema.safeParse({ accentPreset: state.accentPreset, expectedUpdatedAt: state.version })
    if (!input.success) { state.feedback = 'invalid'; return }
    const token = generation
    state.saving = true; state.feedback = ''
    try {
      const value = await updateAppearance(input.data)
      if (token !== generation) return
      fill(value)
      client.setQueryData(key, value)
      publishAppearance(client, { accentPreset: value.accentPreset })
      state.feedback = 'saved'
    } catch (error) {
      if (token === generation) state.feedback = error instanceof ApiClientError && error.code === 900207 ? 'conflict' : 'saveFailed'
    } finally {
      if (token === generation) state.saving = false
    }
  }
  /** Clears private state synchronously even when revoke/restore occurs within one tick. */
  function reconcile() {
    const scope = identity.scope.value
    const permissions = client.getQueryData<UserResponse>(['auth', 'me'])?.user?.permissions ?? []
    const signature = [...permissions].sort().join('\n')
    if (scope === previousScope && signature === previousPermissions) return
    previousScope = scope; previousPermissions = signature; generation++
    void client.cancelQueries({ queryKey: key, exact: true })
    client.removeQueries({ queryKey: key, exact: true })
    key = [...adminAppearanceKey, scope.userId, scope.epoch, generation]
    Object.assign(state, { allowed: !!scope.userId && permissions.includes('admin:access') && permissions.includes('system:manage'), accentPreset: 'iris', version: '', loading: false, saving: false, feedback: '' })
    edited = 0
    void load()
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  reconcile()
  onScopeDispose(() => {
    generation++; unsubscribe()
    void client.cancelQueries({ queryKey: key, exact: true })
    client.removeQueries({ queryKey: key, exact: true })
  })
  return { state, edit, load, save }
}
