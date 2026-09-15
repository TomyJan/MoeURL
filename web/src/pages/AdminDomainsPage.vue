<template>
  <section class="domains-page" data-testid="admin-domains-page">
    <header class="domains-page__header">
      <div>
        <p>{{ t('pageMeta.adminEyebrow') }}</p>
        <h1>{{ t('domains.title') }}</h1>
        <span>{{ t('domains.description') }}</span>
      </div>
      <v-btn color="primary" :disabled="creating || writesBlocked" @click="beginCreate">{{ t('domains.add') }}</v-btn>
    </header>

    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="query.isError.value || (defaultRefreshRequired && !mutation.isPending.value)" type="error" variant="tonal">
      {{ t('domains.loadFailed') }}
      <template #append><v-btn variant="text" @click="retryDomains">{{ t('domains.retry') }}</v-btn></template>
    </v-alert>
    <div v-else class="domains-page__workspace">
      <aside class="domains-page__list" :aria-label="t('domains.listLabel')">
        <button v-for="item in domains" :key="item.id" type="button" :class="{ 'domains-page__selected': selectedID === item.id && !creating }" @click="selectDomain(item)">
          <strong>{{ item.displayName }}</strong>
          <small>{{ item.host }} · {{ item.isDefault ? t('domains.default') : item.enabled ? t('domains.enabled') : t('domains.disabled') }}</small>
        </button>
        <p v-if="domains.length === 0 && !creating">{{ t('domains.empty') }}</p>
      </aside>
      <form v-if="creating || selectedDomain" class="domains-page__editor" @submit.prevent="save">
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
        <v-alert v-if="feedback" :type="feedback === 'success' ? 'success' : 'error'" variant="tonal">
          {{ t(feedback === 'success' ? 'domains.saved' : feedback === 'conflict' ? 'domains.conflict' : 'domains.saveFailed') }}
        </v-alert>
        <div class="domains-page__actions">
          <v-btn v-if="!creating && !selectedDomain?.isDefault" type="button" variant="text" :disabled="writesBlocked || !selectedDomain?.enabled" @click="setDefault">{{ t('domains.setDefault') }}</v-btn>
          <v-btn v-if="!creating" type="button" color="error" variant="text" :disabled="writesBlocked || selectedDomain?.isDefault || selectedDomain?.referenced" @click="openDelete">{{ t('domains.delete') }}</v-btn>
          <v-btn v-if="creating" type="button" variant="text" @click="cancelCreate">{{ t('domains.cancel') }}</v-btn>
          <v-btn color="primary" type="submit" :disabled="writesBlocked" :loading="mutation.isPending.value">{{ t('domains.save') }}</v-btn>
        </div>
      </form>
    </div>

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
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import {
  createDomain, deleteDomain, listDomains, managedDomainQueryKey, setDefaultDomain, updateDomain,
  type DomainDraftInput, type DomainGroupKey, type ManagedDomain,
} from '@/entities/domain/api'
import { ApiClientError } from '@/shared/api/client'

type Operation =
  | { type: 'create'; values: DomainDraftInput }
  | { type: 'update'; domain: ManagedDomain; expectedUpdatedAt: string; values: DomainDraftInput }
  | { type: 'default' | 'delete'; domain: ManagedDomain }
type Outcome = { type: 'saved'; domain: ManagedDomain } | { type: 'deleted'; id: string }

const { t } = useI18n()
const queryClient = useQueryClient()
const query = useQuery({ queryKey: managedDomainQueryKey, queryFn: listDomains, retry: false })
const domains = computed(() => query.data.value?.items ?? [])
const groupKeys = ['user', 'admin'] as const
const selectedID = ref('')
const creating = ref(false)
const feedback = ref<'success' | 'conflict' | 'error' | ''>('')
const deleteDialog = ref(false)
const deleteTarget = ref<ManagedDomain | null>(null)
const draft = reactive<DomainDraftInput>({ host: '', displayName: '', allowedGroups: [], enabled: true })
const selectedDomain = computed(() => domains.value.find(({ id }) => id === selectedID.value))
let baseline: DomainDraftInput | null = null
let expectedUpdatedAt = ''
const pendingConflicts = new Map<string, string>()
const defaultRefreshRequired = ref(false)
const VERSION_CONFLICT_CODE = 210103

const mutation = useMutation({
  retry: false,
  async mutationFn(operation: Operation): Promise<Outcome> {
    if (operation.type === 'delete') {
      await deleteDomain({ id: operation.domain.id, expectedUpdatedAt: operation.domain.updatedAt })
      return { type: 'deleted', id: operation.domain.id }
    }
    const result = operation.type === 'create'
      ? await createDomain(operation.values)
      : operation.type === 'update'
        ? await updateDomain({ ...operation.values, id: operation.domain.id, expectedUpdatedAt: operation.expectedUpdatedAt })
        : await setDefaultDomain({ id: operation.domain.id, expectedUpdatedAt: operation.domain.updatedAt })
    return { type: 'saved', domain: result.domain }
  },
  async onSuccess(result, operation) {
    const active = targetsCurrentSelection(operation)
    queryClient.setQueryData<{ items: ManagedDomain[] }>(managedDomainQueryKey, (current) => {
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
        if (operation.type === 'default' && dirty()) expectedUpdatedAt = result.domain.updatedAt
        else fillDraft(result.domain)
      }
    }
    if (result.type === 'deleted' && deleteTarget.value?.id === result.id) deleteDialog.value = false
    if (operation.type === 'default') {
      defaultRefreshRequired.value = true
      await retryDomains()
    } else {
      void queryClient.invalidateQueries({ queryKey: managedDomainQueryKey })
    }
    void queryClient.invalidateQueries({ queryKey: ['domain', 'available'] })
  },
  async onError(error, operation) {
    const active = targetsCurrentSelection(operation)
    const conflict = error instanceof ApiClientError && error.code === VERSION_CONFLICT_CODE && operation.type !== 'create'
    if (active) feedback.value = conflict ? 'conflict' : 'error'
    if (conflict) {
      pendingConflicts.set(operation.domain.id, operation.type === 'update' ? operation.expectedUpdatedAt : operation.domain.updatedAt)
      try {
        const refreshed = await query.refetch()
        if (refreshed.isSuccess) syncPendingConflicts(refreshed.data.items)
      } catch { /* The next successful query can still reconcile this conflict. */ }
    }
  },
})
const writesBlocked = computed(() => mutation.isPending.value || defaultRefreshRequired.value)

watch(deleteDialog, (open) => { if (!open) deleteTarget.value = null })
watch(domains, (items) => {
  syncPendingConflicts(items)
  if (creating.value) return
  const current = items.find(({ id }) => id === selectedID.value) ?? items[0]
  if (!current) { selectedID.value = ''; baseline = null; return }
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
    if (!latest && selectedID.value === id) { selectedID.value = ''; baseline = null }
    else if (latest && selectedID.value === id && !dirty()) fillDraft(latest)
  }
}

function fillDraft(item: ManagedDomain) {
  Object.assign(draft, { host: item.host, displayName: item.displayName, allowedGroups: [...item.allowedGroups], enabled: item.enabled })
  baseline = { ...draft, allowedGroups: [...draft.allowedGroups] }
  expectedUpdatedAt = item.updatedAt
}

function dirty(): boolean {
  return baseline !== null && (draft.host !== baseline.host || draft.displayName !== baseline.displayName || draft.enabled !== baseline.enabled ||
    draft.allowedGroups.length !== baseline.allowedGroups.length || draft.allowedGroups.some((group) => !baseline?.allowedGroups.includes(group)))
}

async function retryDomains() {
  const refreshed = await query.refetch()
  if (refreshed.isSuccess) defaultRefreshRequired.value = false
  return refreshed
}

function selectDomain(item: ManagedDomain) { creating.value = false; selectedID.value = item.id; feedback.value = ''; fillDraft(item) }
function beginCreate() {
  creating.value = true; selectedID.value = ''; feedback.value = ''
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
function save() {
  if (writesBlocked.value || !draft.host.trim() || !draft.displayName.trim()) { feedback.value = 'error'; return }
  const values = { ...draft, host: draft.host.trim(), displayName: draft.displayName.trim(), allowedGroups: [...draft.allowedGroups] }
  feedback.value = ''
  if (creating.value) mutation.mutate({ type: 'create', values })
  else mutation.mutate({ type: 'update', domain: selectedDomain.value!, expectedUpdatedAt, values })
}
function setDefault() {
  mutation.mutate({ type: 'default', domain: selectedDomain.value! })
}
function openDelete() {
  deleteTarget.value = { ...selectedDomain.value! }
  deleteDialog.value = true
}
function confirmDelete() { mutation.mutate({ type: 'delete', domain: deleteTarget.value! }) }
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
.domains-page__list button { display: grid; gap: 5px; padding: 12px; border-radius: 12px; text-align: left; overflow-wrap: anywhere; }
.domains-page__list button:hover, .domains-page__selected { background: rgb(var(--v-theme-surface-variant)); }
.domains-page__editor { display: grid; align-content: start; gap: 12px; }
.domains-page__groups { display: flex; gap: 18px; padding: 12px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 8px; }
.domains-page__groups label { display: flex; gap: 6px; align-items: center; }
.domains-page__actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
@media (max-width: 720px) { .domains-page__header { align-items: start; flex-direction: column; } .domains-page__workspace { grid-template-columns: minmax(0, 1fr); } }
</style>
