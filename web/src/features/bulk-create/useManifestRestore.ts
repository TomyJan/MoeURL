import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type UserResponse } from '@/entities/auth/api'
import { MANIFEST_RESTORE_CSV_MAX_BYTES, parseManifestRestoreCsv, type ManifestRestoreCsvIssue, type ManifestRestoreCsvItem } from '@/entities/short-link/manifest-restore-csv'
import { manifestRestoreShortLinks, type ManifestRestoreInput } from '@/entities/short-link/manifest-restore-api'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

type AccountScope = ReturnType<typeof useAccountIdentity>['scope']['value']
type RestoreSnapshot = Readonly<{ requestId: string; items: readonly ManifestRestoreCsvItem[] }>

/** Owns one local manifest draft and retires every completion after identity or authority changes. */
export function useManifestRestore() {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, retry: false, staleTime: Infinity })
  const { t } = useI18n()
  const opened = ref(false), reading = ref(false), pending = ref(false), unknown = ref(false)
  const errorKey = ref(''), errorIssue = shallowRef<ManifestRestoreCsvIssue | null>(null)
  const fileName = ref(''), parsed = shallowRef<readonly ManifestRestoreCsvItem[] | null>(null)
  const snapshot = shallowRef<RestoreSnapshot | null>(null)
  const createdCount = ref(0)
  let generation = 0, readSequence = 0, alive = true
  let scope: AccountScope = identity.scope.value
  let authority = authorityKey(client.getQueryData<UserResponse>(['auth', 'me'])?.user)

  const allowed = computed(() => canRestore(auth.data.value?.user))
  const origins = computed(() => [...new Set(parsed.value?.map(item => item.domainOrigin) ?? [])])

  function currentUser() { return client.getQueryData<UserResponse>(['auth', 'me'])?.user }
  function currentAuthority() { return authorityKey(currentUser()) }
  function canRestoreNow(items?: readonly ManifestRestoreCsvItem[]) {
    const user = currentUser()
    if (!client.getQueryState(['auth', 'me']) || client.getQueryState(['auth', 'me'])?.status !== 'success' || !canRestore(user)) return false
    if (!items) return true
    const permissions = new Set(user!.permissions)
    return permissions.has('short_link:custom_slug')
      && permissions.has('short_link:set_metadata')
      && (!items.some(item => item.status === 'disabled') || permissions.has('short_link:update_own'))
      && (!items.some(item => item.redirectMode === 'intermediate') || permissions.has('short_link:use_intermediate'))
      && (!items.some(item => item.redirectMode === 'confirmation') || permissions.has('short_link:use_confirmation'))
      && (!items.some(item => item.expiresAt !== '') || permissions.has('short_link:set_expiration'))
      && (!items.some(item => item.maxVisits !== '') || permissions.has('short_link:set_max_visits'))
  }
  function isCurrent(token: number, candidate: AccountScope, authorityToken: string) {
    return alive && opened.value && token === generation && identity.isCurrent(candidate)
      && currentAuthority() === authorityToken && canRestoreNow()
  }
  function reset() {
    generation++
    opened.value = false; reading.value = false; pending.value = false; unknown.value = false
    errorKey.value = ''; errorIssue.value = null; fileName.value = ''; parsed.value = null; snapshot.value = null; createdCount.value = 0
    readSequence++
  }

  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.query.queryKey[0] !== 'auth' || event.query.queryKey[1] !== 'me') return
    const nextAuthority = currentAuthority()
    if (nextAuthority !== authority) {
      authority = nextAuthority
      reset()
      if (canRestoreNow()) scope = identity.scope.value
    } else if (!identity.isCurrent(scope) || !canRestoreNow()) reset()
  })

  function begin() {
    if (!canRestoreNow() || pending.value) return
    if (unknown.value && snapshot.value && alive && identity.isCurrent(scope)
      && currentAuthority() === authority && canRestoreNow()) {
      opened.value = true
      return
    }
    reset()
    scope = identity.scope.value
    authority = currentAuthority()
    opened.value = true
  }

  /** Reads and parses only the selected local file; stale reads cannot replace a newer draft. */
  async function selectFile(file: File | undefined) {
    if (!file || !opened.value || pending.value || unknown.value || !isCurrent(generation, scope, authority)) return
    const token = generation, candidate = scope, authorityToken = authority, sequence = ++readSequence
    const isReadCurrent = () => isCurrent(token, candidate, authorityToken) && sequence === readSequence
    reading.value = true; errorKey.value = ''; errorIssue.value = null
    try {
      if (file.size > MANIFEST_RESTORE_CSV_MAX_BYTES) {
        errorKey.value = 'manifestRestore.fileTooLarge'
        return
      }
      const bytes = await file.arrayBuffer()
      if (!isReadCurrent()) return
      if (bytes.byteLength > MANIFEST_RESTORE_CSV_MAX_BYTES) { errorKey.value = 'manifestRestore.fileTooLarge'; return }
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
      const result = parseManifestRestoreCsv(text)
      if (!result.success) {
        errorIssue.value = result.issue ?? null
        errorKey.value = 'manifestRestore.fileInvalid'
        return
      }
      if (!canRestoreNow(result.data)) { errorKey.value = 'manifestRestore.permissionChanged'; return }
      parsed.value = Object.freeze(result.data.map(item => Object.freeze({ ...item, tags: Object.freeze([...item.tags]) })))
      fileName.value = file.name
      snapshot.value = null; unknown.value = false; createdCount.value = 0
    } catch {
      if (isReadCurrent()) errorKey.value = 'manifestRestore.fileReadFailed'
    } finally {
      if (isReadCurrent()) reading.value = false
    }
  }

  /** Freezes the explicit confirmation into a new request key before one network attempt. */
  async function confirm() {
    if (!opened.value || pending.value || unknown.value || createdCount.value > 0 || reading.value || !parsed.value
      || !isCurrent(generation, scope, authority) || !canRestoreNow(parsed.value)) return
    const token = generation, candidate = scope, authorityToken = authority
    const input: RestoreSnapshot = Object.freeze({
      requestId: crypto.randomUUID(),
      items: Object.freeze(parsed.value.map(item => Object.freeze({ ...item, tags: Object.freeze([...item.tags]) }))),
    })
    snapshot.value = input
    await send(input, token, candidate, authorityToken)
  }

  /** Retries an uncertain write only with its unchanged request key and frozen body. */
  async function retry() {
    const input = snapshot.value
    if (!opened.value || pending.value || !unknown.value || !input || !isCurrent(generation, scope, authority)) return
    await send(input, generation, scope, authority)
  }

  async function send(input: RestoreSnapshot, token: number, candidate: AccountScope, authorityToken: string) {
    const wasUnknown = unknown.value
    pending.value = true; unknown.value = false; errorKey.value = ''; errorIssue.value = null
    try {
      const result = await manifestRestoreShortLinks(input as ManifestRestoreInput, candidate.userId)
      if (!isCurrent(token, candidate, authorityToken)) return
      createdCount.value = result.createdCount
      errorKey.value = 'manifestRestore.success'
      for (const key of ['short-link', 'short-link-overview']) void client.invalidateQueries({ queryKey: [key] })
      toast.success(t('manifestRestore.success', { count: result.createdCount }, result.createdCount))
    } catch (error) {
      if (!isCurrent(token, candidate, authorityToken)) return
      if (error instanceof ApiClientError && [401, 403, 120001].includes(error.code)) {
        toast.error(t('manifestRestore.permissionChanged'))
        reset()
        void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
      } else if (error instanceof ApiClientError) {
        if (wasUnknown) {
          unknown.value = true
          errorKey.value = 'manifestRestore.unknown'
        } else {
          snapshot.value = null
          errorKey.value = error.code === 200120 ? 'manifestRestore.conflict'
          : error.code === 200121 ? 'targetPolicy.bulkDenied'
            : error.code === 200122 ? 'dailyCreateQuota.bulkDenied'
              : error.code === 200101 ? 'bulkCreate.customSlugTaken'
                : error.code === 200102 ? 'bulkCreate.customSlugReserved'
                  : 'manifestRestore.failed'
        }
      } else {
        unknown.value = true
        errorKey.value = 'manifestRestore.unknown'
      }
    } finally {
      if (isCurrent(token, candidate, authorityToken)) pending.value = false
    }
  }

  function close() {
    if (!opened.value) return
    if (pending.value) {
      generation++; opened.value = false; pending.value = false; unknown.value = true; readSequence++; reading.value = false
      return
    }
    if (unknown.value) return
    reset()
  }

  function discard() { if (opened.value && !pending.value) reset() }

  onBeforeUnmount(() => { alive = false; generation++; readSequence++; unsubscribe() })
  return { allowed, opened, reading, pending, unknown, errorKey, errorIssue, fileName, parsed, origins, snapshot, createdCount, begin, selectFile, confirm, retry, close, discard }
}

function canRestore(user: UserResponse['user'] | undefined) {
  return !!user?.id && user.group !== 'guest' && user.username !== 'guest'
    && user.permissions.includes('short_link:create') && user.permissions.includes('short_link:custom_slug')
    && user.permissions.includes('short_link:set_metadata')
}

function authorityKey(user: UserResponse['user'] | undefined) {
  if (!user) return ''
  return JSON.stringify([user.id, user.group, [...user.permissions].sort()])
}
