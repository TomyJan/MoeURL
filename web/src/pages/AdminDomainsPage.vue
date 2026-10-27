<template>
  <section class="domains-page" data-testid="admin-domains-page">
    <header class="domains-page__header">
      <div>
        <p>{{ t('pageMeta.adminEyebrow') }}</p>
        <h1>{{ t('domains.title') }}</h1>
        <span>{{ t('domains.description') }}</span>
      </div>
      <v-btn color="primary" :disabled="creating || transportBlocked" @click="beginCreate">{{ t('domains.add') }}</v-btn>
    </header>

    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-if="query.isError.value || (defaultRefreshRequired && !mutation.isPending.value)" type="error" variant="tonal">
      {{ t('domains.loadFailed') }}
      <template #append><v-btn variant="text" @click="retryDomains">{{ t('domains.retry') }}</v-btn></template>
    </v-alert>
    <v-alert v-if="permissionDenied" type="error" variant="tonal">
      {{ t('domainOrder.accessDenied') }}
      <v-btn type="button" variant="text" :disabled="mutation.isPending.value || orderReloading || !identity.scope.value.userId" @click="reloadAccess">{{ t('domainOrder.reloadAccess') }}</v-btn>
    </v-alert>
    <div v-if="!query.isPending.value" class="domains-page__workspace">
      <aside class="domains-page__list" :aria-label="t('domains.listLabel')">
        <v-list role="group" density="comfortable" nav class="moe-resource-list">
          <v-list-item v-for="item in domains" :key="item.id" tag="button" type="button" role="button" color="primary" :active="selectedID === item.id && !creating" :aria-current="selectedID === item.id && !creating ? 'true' : undefined" @click="selectDomain(item)">
            <template #title>{{ item.displayName }}</template>
            <template #subtitle>{{ item.host }} · {{ item.isDefault ? t('domains.default') : item.enabled ? t('domains.enabled') : t('domains.disabled') }}</template>
          </v-list-item>
        </v-list>
        <p v-if="domains.length === 0 && !creating">{{ t('domains.empty') }}</p>
      </aside>
      <div v-if="creating || selectedDomain" class="domains-page__editors">
        <form class="domains-page__editor" @submit.prevent="save">
          <h2>{{ creating ? t('domains.createTitle') : selectedDomain?.displayName }}</h2>
          <v-text-field v-model="draft.host" :label="t('domains.host')" :disabled="writesBlocked || (!creating && selectedDomain?.referenced)" variant="outlined" />
          <p v-if="selectedDomain?.referenced">{{ t('domains.addressLocked') }}</p>
          <v-text-field v-model="draft.displayName" :label="t('domains.displayName')" :disabled="writesBlocked" variant="outlined" />
          <fieldset class="domains-page__groups" :disabled="writesBlocked">
            <legend>{{ t('domains.allowedGroups') }}</legend>
            <label v-for="group in groupKeys" :key="group">
              <input type="checkbox" :checked="draft.allowedGroups.includes(group)" @change="toggleGroup(group, $event)" />
              {{ t(`domains.groups.${group}`) }}
            </label>
          </fieldset>
          <v-switch v-model="draft.enabled" :label="t('domains.enabled')" :disabled="writesBlocked || (!creating && selectedDomain?.isDefault)" />
          <v-alert v-if="selectionRemoved" type="error" variant="tonal">{{ t('domains.removedDraft') }}</v-alert>
          <div class="domains-page__actions">
            <v-btn v-if="!creating && !selectionRemoved && feedback === 'conflict' && dirty()" type="button" variant="text" :disabled="writesBlocked" @click="requestDiscard(selectedID)">{{ t('domains.reloadDraft') }}</v-btn>
            <v-btn v-if="!creating && !selectedDomain?.isDefault" type="button" variant="text" :disabled="writesBlocked || selectionRemoved || !selectedDomain?.enabled" @click="setDefault">{{ t('domains.setDefault') }}</v-btn>
            <v-btn v-if="!creating" type="button" color="error" variant="text" :disabled="writesBlocked || selectionRemoved || selectedDomain?.isDefault || selectedDomain?.referenced" @click="openDelete">{{ t('domains.delete') }}</v-btn>
            <v-btn v-if="creating" type="button" variant="text" @click="cancelCreate">{{ t('domains.cancel') }}</v-btn>
            <v-btn color="primary" type="submit" :disabled="writesBlocked || selectionRemoved" :loading="mutation.isPending.value">{{ t('domains.save') }}</v-btn>
          </div>
        </form>
        <DomainOrderEditor v-if="!creating && selectedDomain" :key="`${selectedID}:${orderRevision}:${identity.scope.value.epoch}`" :domain="selectedDomain" :disabled="transportBlocked || dirty() || selectionRemoved" :pending="mutation.isPending.value && operationKind === 'order'" :conflict="feedbackKind === 'order' && feedback === 'conflict'" @dirty="orderDirty = $event" @save="saveOrder" @reload="reloadOrder" />
      </div>
    </div>

    <ActionToast v-if="feedback && !selectionRemoved" :key="`${feedback}:${feedbackRevision}`" :type="feedback === 'success' ? 'success' : 'error'">
      {{ t(feedbackKind === 'order' ? feedback === 'success' ? 'domainOrder.saved' : feedback === 'conflict' ? 'domainOrder.conflict' : 'domainOrder.saveFailed' : feedback === 'success' ? 'domains.saved' : feedback === 'conflict' ? 'domains.conflict' : 'domains.saveFailed') }}
    </ActionToast>
    <v-dialog v-model="deleteDialog" max-width="440">
      <v-card>
        <v-card-title>{{ t('domains.deleteTitle') }}</v-card-title>
        <v-card-text>{{ t('domains.deleteWarning') }}</v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="deleteDialog = false">{{ t('domains.cancel') }}</v-btn>
          <v-btn color="error" :disabled="writesBlocked" :loading="mutation.isPending.value" @click="confirmDelete">{{ t('domains.confirmDelete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="discardDialog" max-width="440">
      <v-card>
        <v-card-title>{{ t('domains.discardTitle') }}</v-card-title>
        <v-card-text>{{ t('domains.discardWarning') }}</v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="discardDialog = false">{{ t('domains.cancel') }}</v-btn>
          <v-btn color="error" :disabled="discardReloading" :loading="discardReloading" @click="confirmDiscard">{{ t('domains.confirmDiscard') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup lang="ts">
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import {
  createDomain, deleteDomain, listDomains, managedDomainQueryKey, setDefaultDomain, setDomainOrder, updateDomain,
  type DomainDraftInput, type DomainGroupKey, type ManagedDomain, type SetDomainOrderInput,
} from '@/entities/domain/api'
import { ApiClientError } from '@/shared/api/client'
import { me } from '@/entities/auth/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import DomainOrderEditor from '@/features/domain-order/DomainOrderEditor.vue'

type Operation =
  | { type: 'create'; values: DomainDraftInput }
  | { type: 'update'; domain: ManagedDomain; expectedUpdatedAt: string; values: DomainDraftInput }
  | { type: 'default' | 'delete'; domain: ManagedDomain }
  | { type: 'order'; domain: ManagedDomain; input: SetDomainOrderInput }
type Outcome = { type: 'saved'; domain: ManagedDomain } | { type: 'deleted'; id: string }

const { t } = useI18n()
const queryClient = useQueryClient()
const identity = useAccountIdentity()
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const eligible = computed(() => !auth.isError?.value && !!identity.scope.value.userId && auth.data.value?.user.id === identity.scope.value.userId && ['admin:access', 'domain:manage'].every((permission) => auth.data.value?.user.permissions.includes(permission)))
const queryKey = computed(() => [...managedDomainQueryKey, identity.scope.value.userId, identity.scope.value.epoch])
const query = useQuery({ queryKey, queryFn: listDomains, enabled: eligible, retry: false })
const domains = computed(() => query.data.value?.items ?? [])
const groupKeys = ['user', 'admin'] as const
const selectedID = ref('')
const creating = ref(false)
const feedback = ref<'success' | 'conflict' | 'error' | ''>('')
const feedbackRevision = ref(0)
const feedbackKind = ref<'details' | 'order'>('details')
const operationKind = ref<'details' | 'order'>('details')
const orderDirty = ref(false)
const orderRevision = ref(0)
const orderReloading = ref(false)
const permissionDenied = ref(false)
let mounted = true
onBeforeUnmount(() => { mounted = false })
const deleteDialog = ref(false)
const deleteTarget = ref<ManagedDomain | null>(null)
const discardDialog = ref(false)
const discardTarget = ref('')
const discardReloading = ref(false)
const draft = reactive<DomainDraftInput>({ host: '', displayName: '', allowedGroups: [], enabled: true })
const selectedSnapshot = ref<ManagedDomain | null>(null)
const selectionRemoved = computed(() => !creating.value && !!selectedID.value && query.data.value !== undefined && !domains.value.some(({ id }) => id === selectedID.value))
const selectedDomain = computed(() => domains.value.find(({ id }) => id === selectedID.value) ??
  (selectionRemoved.value && (dirty() || orderDirty.value) && selectedSnapshot.value?.id === selectedID.value ? selectedSnapshot.value : undefined))
let baseline: DomainDraftInput | null = null
let expectedUpdatedAt = ''
const pendingConflicts = new Map<string, string>()
const defaultRefreshRequired = ref(false)
const VERSION_CONFLICT_CODE = 210103

const mutation = useMutation({
  retry: false,
  /** Sends only the chosen command; the captured identity scope remains local to response handling. */
  async mutationFn(operation: Operation & { scope: typeof identity.scope.value }): Promise<Outcome> {
    if (operation.type === 'delete') {
      await deleteDomain({ id: operation.domain.id, expectedUpdatedAt: operation.domain.updatedAt })
      return { type: 'deleted', id: operation.domain.id }
    }
    const result = operation.type === 'order'
      ? await setDomainOrder(operation.input)
      : operation.type === 'create'
      ? await createDomain(operation.values)
      : operation.type === 'update'
        ? await updateDomain({ ...operation.values, id: operation.domain.id, expectedUpdatedAt: operation.expectedUpdatedAt })
        : await setDefaultDomain({ id: operation.domain.id, expectedUpdatedAt: operation.domain.updatedAt })
    return { type: 'saved', domain: result.domain }
  },
  /** Reconciles only the current login round; order/default writes reload server order before unblocking. */
  async onSuccess(result, operation) {
    if (!currentOperation(operation)) return
    const active = targetsCurrentSelection(operation)
    queryClient.setQueryData<{ items: ManagedDomain[] }>(queryKey.value, (current) => {
      const items = current?.items ?? []
      if (result.type === 'deleted') return { items: items.filter(({ id }) => id !== result.id) }
      const next = result.domain
      const updated = items.some(({ id }) => id === next.id) ? items.map((item) => item.id === next.id ? next : item) : [...items, next]
      return { items: result.domain.isDefault ? updated.map((item) => item.id === next.id ? item : { ...item, isDefault: false }) : updated }
    })
    if (active) {
      feedback.value = 'success'
      if (result.type === 'deleted') selectedID.value = ''
      else {
        creating.value = false
        selectedID.value = result.domain.id
        if (operation.type === 'default' && dirty()) {
          draft.enabled = result.domain.enabled
          expectedUpdatedAt = result.domain.updatedAt
        } else fillDraft(result.domain)
      }
    }
    if (result.type === 'deleted' && deleteTarget.value?.id === result.id) deleteDialog.value = false
    if (operation.type === 'order' && active) { orderDirty.value = false; orderRevision.value++ }
    if (operation.type === 'default' || operation.type === 'order') {
      defaultRefreshRequired.value = true
      await retryDomains()
    } else {
      void queryClient.invalidateQueries({ queryKey: queryKey.value })
    }
    if (currentOperation(operation)) {
      void queryClient.invalidateQueries({ queryKey: ['domain', 'available'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-user-group-domain-default'] })
      void queryClient.invalidateQueries({ queryKey: ['group-default-domain'] })
    }
  },
  /** Retains conflicted revisions and blocks denied writes without leaking late feedback across identities. */
  async onError(error, operation) {
    if (!currentOperation(operation)) return
    if (error instanceof ApiClientError && [401, 403, 120001].includes(error.code)) permissionDenied.value = true
    const active = targetsCurrentSelection(operation)
    const conflict = error instanceof ApiClientError && error.code === VERSION_CONFLICT_CODE && operation.type !== 'create'
    if (active) feedback.value = conflict ? 'conflict' : 'error'
    if (conflict) {
      pendingConflicts.set(operation.domain.id, operation.type === 'update' ? operation.expectedUpdatedAt : operation.type === 'order' ? operation.input.expectedUpdatedAt : operation.domain.updatedAt)
      try {
        const refreshed = await query.refetch()
        if (currentOperation(operation) && refreshed.isSuccess) syncPendingConflicts(refreshed.data.items)
      } catch { /* The next successful query can still reconcile this conflict. */ }
    }
  },
})
const transportBlocked = computed(() => mutation.isPending.value || defaultRefreshRequired.value || orderReloading.value || query.isError.value || permissionDenied.value || !eligible.value)
const writesBlocked = computed(() => transportBlocked.value || orderDirty.value)
watch(identity.scope, () => {
  creating.value = false; selectedID.value = ''; selectedSnapshot.value = null; baseline = null
  feedback.value = ''; orderDirty.value = false; orderRevision.value++; pendingConflicts.clear()
  defaultRefreshRequired.value = false; orderReloading.value = false
  permissionDenied.value = false
}, { flush: 'sync' })

watch(deleteDialog, (open) => { if (!open) deleteTarget.value = null })
watch(discardDialog, (open) => { if (!open) discardTarget.value = '' })
watch(domains, (items) => {
  syncPendingConflicts(items)
  if (creating.value) return
  if (selectedID.value && !items.some(({ id }) => id === selectedID.value) && (dirty() || orderDirty.value)) return
  const current = items.find(({ id }) => id === selectedID.value) ?? items[0]
  if (!current) { selectedID.value = ''; selectedSnapshot.value = null; baseline = null; return }
  const changed = selectedID.value !== current.id
  selectedID.value = current.id
  if (changed || (expectedUpdatedAt !== current.updatedAt && !dirty())) fillDraft(current)
}, { immediate: true })

/** Keeps dirty local edits based on their original revision after a conflicting refresh. */
function syncPendingConflicts(items: ManagedDomain[]) {
  for (const [id, conflictRevision] of pendingConflicts) {
    const latest = items.find((item) => item.id === id)
    if (latest && latest.updatedAt === conflictRevision) continue
    pendingConflicts.delete(id)
    if (deleteTarget.value?.id === id) {
      if (latest) deleteTarget.value = { ...latest }
      else { deleteDialog.value = false; deleteTarget.value = null }
    }
    if (!latest && selectedID.value === id && !dirty() && !orderDirty.value) { selectedID.value = ''; selectedSnapshot.value = null; baseline = null }
    else if (latest && selectedID.value === id && !dirty()) fillDraft(latest)
  }
}

function fillDraft(item: ManagedDomain) {
  selectedSnapshot.value = { ...item }
  Object.assign(draft, { host: item.host, displayName: item.displayName, allowedGroups: [...item.allowedGroups], enabled: item.enabled })
  baseline = { ...draft, allowedGroups: [...draft.allowedGroups] }
  expectedUpdatedAt = item.updatedAt
}

function dirty(): boolean {
  if (creating.value) return Boolean(draft.host || draft.displayName || draft.allowedGroups.length || !draft.enabled)
  return baseline !== null && (draft.host !== baseline.host || draft.displayName !== baseline.displayName || draft.enabled !== baseline.enabled ||
    draft.allowedGroups.length !== baseline.allowedGroups.length || draft.allowedGroups.some((group) => !baseline?.allowedGroups.includes(group)))
}

/** Releases the refresh barrier only after a successful read for the same eligible login round. */
async function retryDomains() {
  const scope = identity.scope.value
  const refreshed = await query.refetch()
  if (mounted && identity.isCurrent(scope) && eligible.value && refreshed.isSuccess) defaultRefreshRequired.value = false
  return refreshed
}

/** Preserves either editor's draft and prevents switching while an order operation is pending. */
function selectDomain(item: ManagedDomain) {
  if (orderReloading.value || (mutation.isPending.value && operationKind.value === 'order')) return
  if (dirty() || orderDirty.value) { requestDiscard(item.id); return }
  selectDomainNow(item)
}
/** Adopts a confirmed selection and remounts its order editor to release the previous conflict snapshot. */
function selectDomainNow(item: ManagedDomain) { creating.value = false; selectedID.value = item.id; feedback.value = ''; orderDirty.value = false; orderRevision.value++; fillDraft(item) }
function requestDiscard(target: string) { discardTarget.value = target; discardDialog.value = true }
async function confirmDiscard() {
  const target = discardTarget.value
  if (target === selectedID.value && feedback.value === 'conflict') {
    discardReloading.value = true
    try {
      const refreshed = await query.refetch()
      if (!refreshed.isSuccess) return
    } catch { return }
    finally { discardReloading.value = false }
  }
  if (discardTarget.value !== target) return
  if (target === 'create') beginCreateNow()
  else {
    const latest = domains.value.find(({ id }) => id === target)
    if (!latest) return
    selectDomainNow(latest)
  }
  discardDialog.value = false
}
/** Requires confirmation before leaving either dirty editor for a new domain. */
function beginCreate() {
  if (orderReloading.value || (mutation.isPending.value && operationKind.value === 'order')) return
  if (dirty() || orderDirty.value) { requestDiscard('create'); return }
  beginCreateNow()
}
/** Starts a confirmed blank details draft and retires the previous domain's ordering state. */
function beginCreateNow() {
  creating.value = true; selectedID.value = ''; feedback.value = ''
  orderDirty.value = false; orderRevision.value++
  Object.assign(draft, { host: '', displayName: '', allowedGroups: [], enabled: true })
  baseline = null
}
function cancelCreate() {
  creating.value = false
  const first = domains.value[0]
  if (first) selectDomain(first)
}
function toggleGroup(group: DomainGroupKey, event: globalThis.Event) {
  const enabled = (event.target as globalThis.HTMLInputElement).checked
  draft.allowedGroups = enabled ? [...new Set([...draft.allowedGroups, group])] : draft.allowedGroups.filter((item) => item !== group)
}
/** Submits the details draft with its original revision while respecting the independent order lock. */
function save() {
  if (selectionRemoved.value) return
  feedbackRevision.value++
  if (writesBlocked.value || !draft.host.trim() || !draft.displayName.trim()) { feedback.value = 'error'; return }
  const values = { ...draft, host: draft.host.trim(), displayName: draft.displayName.trim(), allowedGroups: [...draft.allowedGroups] }
  feedback.value = ''
  if (creating.value) dispatch({ type: 'create', values })
  else dispatch({ type: 'update', domain: selectedDomain.value!, expectedUpdatedAt, values })
}
/** Dispatches the selected saved domain so default changes share identity and response guards. */
function setDefault() {
  feedbackRevision.value++
  dispatch({ type: 'default', domain: selectedDomain.value! })
}
function openDelete() {
  deleteTarget.value = { ...selectedDomain.value! }
  deleteDialog.value = true
}
/** Uses the dialog's captured target rather than a subsequently selected domain. */
function confirmDelete() {
  feedbackRevision.value++
  dispatch({ type: 'delete', domain: deleteTarget.value! })
}

/** Binds every response to the exact mounted login round before touching shared cache or feedback. */
function currentOperation(operation: { scope: typeof identity.scope.value }): boolean {
  return mounted && identity.isCurrent(operation.scope) && eligible.value
}

/** Rechecks current transport/target state before binding a command to this login round. */
function dispatch(operation: Operation) {
  if (transportBlocked.value || selectionRemoved.value ||
    (operation.type !== 'create' && (!operation.domain || !domains.value.some(({ id }) => id === operation.domain.id)))) return
  operationKind.value = operation.type === 'order' ? 'order' : 'details'
  feedbackKind.value = operationKind.value
  mutation.mutate({ ...operation, scope: identity.scope.value })
}

/** Keeps the order command separate from the ordinary full-details draft. */
function saveOrder(input: SetDomainOrderInput) {
  if (transportBlocked.value || dirty() || selectionRemoved.value || input.id !== selectedID.value) return
  feedback.value = ''; feedbackRevision.value++
  dispatch({ type: 'order', domain: selectedDomain.value!, input })
}

/** Discards a conflicted ordering draft only after a successful, current-identity reload. */
async function reloadOrder() {
  if (transportBlocked.value || selectionRemoved.value) return
  const scope = identity.scope.value
  const id = selectedID.value
  orderReloading.value = true
  try {
    const result = await queryClient.fetchQuery({ queryKey: queryKey.value, queryFn: listDomains, staleTime: 0 })
    if (!mounted || !identity.isCurrent(scope) || !eligible.value || selectedID.value !== id) return
    const latest = result.items.find((item) => item.id === id)
    if (!latest) return
    fillDraft(latest); orderDirty.value = false; orderRevision.value++; feedback.value = ''
  } catch { /* Keep the original value/revision available for another explicit reload. */ }
  finally { if (mounted && identity.isCurrent(scope)) orderReloading.value = false }
}

/** Clears a confirmed access denial only after explicit fresh identity and domain reads. */
async function reloadAccess() {
  if (mutation.isPending.value || orderReloading.value || !identity.scope.value.userId) return
  const scope = identity.scope.value
  orderReloading.value = true
  try {
    const fresh = await me()
    if (!mounted || !identity.isCurrent(scope) || fresh.user.id !== scope.userId) return
    queryClient.setQueryData(['auth', 'me'], fresh)
    if (!['admin:access', 'domain:manage'].every((permission) => fresh.user.permissions.includes(permission))) return
    await queryClient.fetchQuery({ queryKey: queryKey.value, queryFn: listDomains, staleTime: 0 })
    if (mounted && identity.isCurrent(scope) && eligible.value) {
      permissionDenied.value = false; defaultRefreshRequired.value = false
    }
  } catch { /* Denial remains visible and writes stay blocked until both reads succeed. */ }
  finally { if (mounted && identity.isCurrent(scope)) orderReloading.value = false }
}
function targetsCurrentSelection(operation: Operation): boolean {
  return operation.type === 'create' ? creating.value : !creating.value && selectedID.value === operation.domain.id
}
</script>

<style scoped>
.domains-page { display: grid; gap: 22px; min-width: 0; }
.domains-page__header { display: flex; justify-content: space-between; align-items: end; gap: 16px; }
.domains-page__header p { color: rgb(var(--v-theme-primary)); }
.domains-page__header h1 { margin: 4px 0; }
.domains-page__workspace { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 18px; min-width: 0; }
.domains-page__list, .domains-page__editor { padding: 18px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.domains-page__list { display: flex; flex-direction: column; gap: 8px; }
.domains-page__editor { display: grid; align-content: start; gap: 12px; }
.domains-page__editors { display: grid; align-content: start; gap: 18px; min-width: 0; }
.domains-page__groups { display: flex; gap: 18px; padding: 12px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 8px; }
.domains-page__groups label { display: flex; gap: 6px; align-items: center; }
.domains-page__actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
@media (max-width: 720px) { .domains-page__header { align-items: start; flex-direction: column; } .domains-page__workspace { grid-template-columns: minmax(0, 1fr); } }
</style>
