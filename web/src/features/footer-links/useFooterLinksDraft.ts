import { onScopeDispose, reactive } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import type { UserResponse } from '@/entities/auth/api'
import { adminFooterLinksKey, getFooterLinks, updateFooterLinks, UpdateFooterLinksSchema, type FooterLink, type FooterLinksSettings } from '@/entities/footer-links/api'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { publishFooterLinks } from '@/shared/site/useSiteFooterLinks'

interface DraftRow extends FooterLink { key: number }
/** Keeps private ordered drafts and every continuation inside the current identity generation. */
export function useFooterLinksDraft() {
  const client = useQueryClient(), identity = useAccountIdentity()
  const state = reactive({ allowed: false, rows: [] as DraftRow[], version: '', loading: false, saving: false, feedback: '', errors: {} as Record<string, string> })
  let generation = 0, edited = 0, sequence = 0
  let previousScope: object | undefined
  let previousPermissions = ''
  let key: readonly unknown[] = [...adminFooterLinksKey, '', 0, 0]
  /** Uses local row identity only; it is never part of a stored document. */
  function fill(value: FooterLinksSettings) {
    state.rows = value.links.map(link => ({ ...link, key: ++sequence }))
    state.version = value.updatedAt
    state.errors = {}
  }
  /** Clears stale success feedback for every actual draft edit. */
  function changed() {
    edited++; state.errors = {}
    if (state.feedback === 'saved') state.feedback = ''
  }
  /** Allows newer text edits during explicit reload, but never during a save. */
  function edit(index: number, field: 'label' | 'url', value: string) {
    if (!state.allowed || state.saving || !state.version) return
    state.rows[index]![field] = value; changed()
  }
  /** Structural edits are unavailable until a confirmed draft is idle. */
  function idle() { return state.allowed && !!state.version && !state.loading && !state.saving }
  function add() {
    if (!idle() || state.rows.length >= 5) return
    state.rows.push({ key: ++sequence, label: '', url: '' }); changed()
  }
  function remove(index: number) {
    if (!idle()) return
    state.rows.splice(index, 1); changed()
  }
  function move(index: number, offset: -1 | 1) {
    const target = index + offset
    if (!idle() || target < 0 || target >= state.rows.length) return
    const row = state.rows[index]!
    state.rows[index] = state.rows[target]!; state.rows[target] = row; changed()
  }
  /** Rejects stale cache writes before QueryClient sees a response, then guards await and edits. */
  async function load() {
    if (!state.allowed || state.loading || state.saving) return
    const token = generation, revision = edited, readKey = key
    state.loading = true
    try {
      const value = await client.fetchQuery({ queryKey: readKey, staleTime: 0, retry: false,
        async queryFn() {
          const value = await getFooterLinks()
          if (token !== generation) throw new Error('Obsolete footer management read')
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
  /** Saves once, preserves failed drafts and rechecks after synchronous private cache notifications. */
  async function save() {
    if (!idle()) return
    const links = state.rows.map(({ label, url }) => ({ label, url }))
    const input = UpdateFooterLinksSchema.safeParse({ links, expectedUpdatedAt: state.version })
    if (!input.success) {
      state.feedback = 'invalid'; state.errors = {}
      for (const issue of input.error.issues) state.errors[String(issue.path[1]) + ':' + String(issue.path[2])] = 'footerLinks.invalidField'
      return
    }
    const token = generation, saveKey = key
    state.saving = true; state.feedback = ''; state.errors = {}
    try {
      const value = await updateFooterLinks(input.data)
      if (token !== generation) return
      client.setQueryData(saveKey, value)
      if (token !== generation) return
      fill(value)
      publishFooterLinks(client, { links: value.links })
      if (token === generation) state.feedback = 'saved'
    } catch (error) {
      if (token === generation) state.feedback = error instanceof ApiClientError && error.code === 900209 ? 'conflict' : 'saveFailed'
    } finally {
      if (token === generation) state.saving = false
    }
  }
  /** Retires all prior continuations before cancellation, including revoke/restore within one tick. */
  function reconcile() {
    const scope = identity.scope.value
    const permissions = client.getQueryData<UserResponse>(['auth', 'me'])?.user?.permissions ?? []
    const signature = [...permissions].sort().join('\n')
    if (scope === previousScope && signature === previousPermissions) return
    previousScope = scope; previousPermissions = signature; generation++
    void client.cancelQueries({ queryKey: key, exact: true })
    client.removeQueries({ queryKey: key, exact: true })
    key = [...adminFooterLinksKey, scope.userId, scope.epoch, generation]
    Object.assign(state, { allowed: !!scope.userId && permissions.includes('admin:access') && permissions.includes('system:manage'), rows: [], version: '', loading: false, saving: false, feedback: '', errors: {} })
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
  return { state, edit, add, remove, move, load, save }
}
