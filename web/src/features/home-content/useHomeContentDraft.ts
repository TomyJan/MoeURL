import { onScopeDispose, reactive } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { adminHomeContentKey, getHomeContent, publicHomeContentKey, UpdateHomeContentSchema, updateHomeContent, type HomeContentSettings } from '@/entities/home-content/api'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

/** Keeps this independent CAS draft inside one current identity and permission generation. */
export function useHomeContentDraft() {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const state = reactive({ allowed: false, title: '', summary: '', version: '', loading: false, saving: false, feedback: '' })
  let generation = 0
  let edited = 0
  let previousScope: object | undefined
  let previousPermissions = ''
  let key: readonly unknown[] = [...adminHomeContentKey, '', 0, 0]

  /** Applies only a current server document, preserving its complete revision string. */
  function fill(value: HomeContentSettings) {
    state.title = value.title
    state.summary = value.summary
    state.version = value.updatedAt
  }
  /** Records user edits so a pending explicit refresh cannot replace newer input. */
  function edit(field: 'title' | 'summary', value: string) {
    state[field] = value
    edited++
  }
  /** Reloads explicitly; errors retain an existing draft and never retry a write. */
  async function load() {
    if (!state.allowed || state.loading || state.saving) return
    const token = generation
    const revision = edited
    state.loading = true
    try {
      const value = await client.fetchQuery({
        queryKey: key, staleTime: 0, retry: false,
        async queryFn() {
          const value = await getHomeContent()
          // Do not put a revoked identity's late response into the private cache.
          if (token !== generation) throw new Error('Obsolete homepage copy read')
          return value
        },
      })
      if (token !== generation || revision !== edited) return
      fill(value)
      state.feedback = ''
    } catch {
      if (token === generation) state.feedback = 'loadFailed'
    } finally {
      if (token === generation) state.loading = false
    }
  }
  /** Submits one complete command and guards success, failure and finally independently. */
  async function save() {
    if (!state.allowed || !state.version || state.saving || state.loading) return
    const input = UpdateHomeContentSchema.safeParse({ title: state.title, summary: state.summary, expectedUpdatedAt: state.version })
    if (!input.success) { state.feedback = 'invalid'; return }
    const token = generation
    state.saving = true
    state.feedback = ''
    try {
      const value = await updateHomeContent(input.data)
      if (token !== generation) return
      fill(value)
      state.feedback = 'saved'
      client.setQueryData(key, value)
      void client.invalidateQueries({ queryKey: publicHomeContentKey })
    } catch (error) {
      if (token === generation) state.feedback = error instanceof ApiClientError && error.code === 900205 ? 'conflict' : 'saveFailed'
    } finally {
      if (token === generation) state.saving = false
    }
  }
  /** Synchronously clears private state, even for revoke/restore within one render tick. */
  function reconcile() {
    const scope = identity.scope.value
    const user = client.getQueryData<UserResponse>(['auth', 'me'])?.user
    const permissions = user?.permissions ?? []
    const signature = [...permissions].sort().join('\n')
    if (scope === previousScope && signature === previousPermissions) return
    previousScope = scope
    previousPermissions = signature
    generation++
    void client.cancelQueries({ queryKey: key, exact: true })
    client.removeQueries({ queryKey: key, exact: true })
    key = [...adminHomeContentKey, scope.userId, scope.epoch, generation]
    Object.assign(state, { allowed: !!scope.userId && permissions.includes('admin:access') && permissions.includes('system:manage'), title: '', summary: '', version: '', loading: false, saving: false, feedback: '' })
    edited = 0
    void load()
  }
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me') reconcile()
  })
  reconcile()
  onScopeDispose(() => {
    generation++
    unsubscribe()
    void client.cancelQueries({ queryKey: key, exact: true })
    client.removeQueries({ queryKey: key, exact: true })
  })
  return { state, edit, load, save }
}
