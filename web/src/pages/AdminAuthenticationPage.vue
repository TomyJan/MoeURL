<template>
  <section class="identity-page" data-testid="admin-authentication-page">
    <header class="identity-page__header">
      <div>
        <p>{{ t('pageMeta.identityEyebrow') }}</p>
        <h1>{{ t('oidc.title') }}</h1>
        <span>{{ t('oidc.description') }}</span>
      </div>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="beginCreate">{{ t('oidc.addProvider') }}</v-btn>
    </header>

    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="query.isError.value" type="error" variant="tonal">
      {{ t('oidc.loadFailed') }}
      <template #append><v-btn variant="text" @click="query.refetch()">{{ t('oidc.retry') }}</v-btn></template>
    </v-alert>

    <div v-else class="identity-page__workspace">
      <aside class="identity-page__providers" aria-label="OIDC providers">
        <button
          v-for="provider in providers"
          :key="provider.id"
          :class="['identity-page__provider', { 'identity-page__provider--active': provider.id === selectedID && !creating }]"
          type="button"
          @click="selectProvider(provider)"
        >
          <span>{{ provider.displayName }}</span>
          <small>{{ provider.enabled ? t('oidc.enabled') : t('oidc.disabled') }}</small>
        </button>
        <div v-if="providers.length === 0 && !creating" class="identity-page__empty">
          <strong>{{ t('oidc.empty') }}</strong>
          <span>{{ t('oidc.emptyDescription') }}</span>
        </div>
      </aside>

      <form v-if="creating || selectedProvider" class="identity-page__editor" @submit.prevent="save">
        <div class="identity-page__editor-title">
          <div>
            <h2>{{ creating ? t('oidc.createTitle') : selectedProvider?.displayName }}</h2>
            <p v-if="selectedProvider">{{ selectedProvider.callbackUrl }}</p>
          </div>
          <v-switch v-model="draft.enabled" :label="t('oidc.enabled')" :disabled="mutation.isPending.value" hide-details />
        </div>
        <div class="identity-page__fields">
          <v-text-field v-model="draft.key" :label="t('oidc.key')" :disabled="!creating || mutation.isPending.value" variant="outlined" />
          <v-text-field v-model="draft.displayName" :label="t('oidc.displayName')" :disabled="mutation.isPending.value" variant="outlined" />
          <v-text-field v-model="draft.issuerUrl" :label="t('oidc.issuerUrl')" :disabled="mutation.isPending.value" variant="outlined" />
          <v-text-field v-model="draft.clientId" :label="t('oidc.clientId')" :disabled="mutation.isPending.value" variant="outlined" />
          <v-text-field
            v-model="draft.clientSecret"
            autocomplete="new-password"
            :label="t('oidc.clientSecret')"
            :placeholder="creating ? '' : t('oidc.secretPreserved')"
            :disabled="mutation.isPending.value"
            type="password"
            variant="outlined"
          />
          <v-text-field v-model="draft.allowedDomains" :label="t('oidc.allowedDomains')" :disabled="mutation.isPending.value" variant="outlined" />
        </div>
        <v-alert v-if="feedback" :type="feedback === 'success' ? 'success' : 'error'" variant="tonal">
          {{ feedbackMessage }}
        </v-alert>
        <div class="identity-page__actions">
          <v-btn v-if="!creating" color="error" variant="text" :disabled="mutation.isPending.value" @click="deleteDialog = true">{{ t('oidc.delete') }}</v-btn>
          <span />
          <v-btn v-if="creating" variant="text" :disabled="mutation.isPending.value" @click="cancelCreate">{{ t('oidc.cancel') }}</v-btn>
          <v-btn color="primary" type="submit" :loading="mutation.isPending.value">{{ t('oidc.save') }}</v-btn>
        </div>
      </form>
    </div>

    <v-dialog v-model="deleteDialog" max-width="440">
      <v-card>
        <v-card-title>{{ t('oidc.deleteTitle') }}</v-card-title>
        <v-card-text>{{ t('oidc.deleteDescription') }}</v-card-text>
        <v-card-actions>
          <v-btn variant="text" @click="deleteDialog = false">{{ t('oidc.cancel') }}</v-btn>
          <v-btn color="error" :loading="mutation.isPending.value" @click="confirmDelete">{{ t('oidc.delete') }}</v-btn>
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
  createOIDCProvider,
  deleteOIDCProvider,
  listOIDCProviders,
  updateOIDCProvider,
  type OIDCProvider,
} from '@/entities/oidc/api'

const { t } = useI18n()
const queryClient = useQueryClient()
const query = useQuery({ queryKey: ['admin', 'oidc', 'providers'], queryFn: listOIDCProviders, retry: false })
const selectedID = ref('')
const creating = ref(false)
const deleteDialog = ref(false)
const feedback = ref<'success' | 'conflict' | 'error' | ''>('')
const draft = reactive({ key: '', displayName: '', issuerUrl: '', clientId: '', clientSecret: '', allowedDomains: '', enabled: true })
const providers = computed(() => query.data.value?.providers ?? [])
const selectedProvider = computed(() => providers.value.find((provider) => provider.id === selectedID.value))
const PROVIDER_CONFLICT_CODE = 340102
const suspendedDraftSync = new Set<string>()
let loadedProviderUpdatedAt = ''

type ProviderDraft = typeof draft
type ProviderValues = Pick<ProviderDraft, 'key' | 'displayName' | 'issuerUrl' | 'clientId' | 'clientSecret' | 'allowedDomains' | 'enabled'>
type ProviderMutationValues = Omit<ProviderValues, 'clientSecret'>
type ProviderOperation =
  | { type: 'create'; values: ProviderMutationValues }
  | { type: 'update'; provider: OIDCProvider; values: ProviderMutationValues }
  | { type: 'delete'; provider: OIDCProvider }
type ProviderMutationResult =
  | { type: 'saved'; provider: OIDCProvider }
  | { type: 'delete'; providerID: string }
const pendingClientSecrets = new WeakMap<object, string>()

const mutation = useMutation({
  retry: false,
  mutationFn: async (operation: ProviderOperation): Promise<ProviderMutationResult> => {
    if (operation.type === 'delete') {
      await deleteOIDCProvider({ id: operation.provider.id, expectedUpdatedAt: operation.provider.updatedAt })
      return { type: 'delete', providerID: operation.provider.id }
    }
    const values = operation.values
    const clientSecret = pendingClientSecrets.get(operation) ?? ''
    const allowedEmailDomains = splitDomains(values.allowedDomains)
    if (operation.type === 'create') {
      const result = await createOIDCProvider({ key: values.key.trim(), displayName: values.displayName.trim(), issuerUrl: values.issuerUrl.trim(), clientId: values.clientId.trim(), clientSecret, allowedEmailDomains, enabled: values.enabled })
      return { type: 'saved', provider: result.provider }
    }
    const result = await updateOIDCProvider({
      id: operation.provider.id,
      displayName: values.displayName.trim(), issuerUrl: values.issuerUrl.trim(), clientId: values.clientId.trim(),
      clientSecret: clientSecret ? { mode: 'set', value: clientSecret } : { mode: 'preserve' },
      allowedEmailDomains, enabled: values.enabled, expectedUpdatedAt: operation.provider.updatedAt,
    })
    return { type: 'saved', provider: result.provider }
  },
  onSuccess(result, operation) {
    const active = operationTargetsActiveContext(operation)
    if (result.type === 'delete') {
      if (active) selectedID.value = ''
      queryClient.setQueryData<{ providers: OIDCProvider[] }>(['admin', 'oidc', 'providers'], (current) => ({
        providers: (current?.providers ?? []).filter((provider) => provider.id !== result.providerID),
      }))
    } else {
      queryClient.setQueryData<{ providers: OIDCProvider[] }>(['admin', 'oidc', 'providers'], (current) => {
        const items = current?.providers ?? []
        const existing = items.some((provider) => provider.id === result.provider.id)
        return { providers: existing ? items.map((provider) => provider.id === result.provider.id ? result.provider : provider) : [...items, result.provider] }
      })
      if (active) {
        creating.value = false
        selectedID.value = result.provider.id
        fillDraft(result.provider)
      }
    }
    if (active) {
      draft.clientSecret = ''
      feedback.value = 'success'
      deleteDialog.value = false
    }
    void queryClient.invalidateQueries({ queryKey: ['admin', 'oidc', 'providers'] })
    void queryClient.invalidateQueries({ queryKey: ['auth', 'methods'] })
  },
  async onError(error, operation) {
    const providerID = operation.type === 'update' || operation.type === 'delete' ? operation.provider.id : ''
    const conflict = providerID !== '' && hasCode(error, PROVIDER_CONFLICT_CODE)
    const active = operationTargetsActiveContext(operation)
    if (active) {
      draft.clientSecret = ''
      feedback.value = conflict ? 'conflict' : 'error'
    }
    if (conflict) {
      if (active) suspendedDraftSync.add(providerID)
      try {
        await query.refetch()
      } finally {
        suspendedDraftSync.delete(providerID)
      }
    }
  },
  onSettled(_data, _error, operation) {
    pendingClientSecrets.delete(operation)
  },
})

const feedbackMessage = computed(() => feedback.value === 'success' ? t('oidc.saveSuccess') : feedback.value === 'conflict' ? t('oidc.conflict') : t('oidc.saveFailed'))

watch(providers, (items) => {
  if (creating.value) return
  const current = items.find((provider) => provider.id === selectedID.value) ?? items[0]
  if (current) {
    const selectionChanged = selectedID.value !== current.id
    selectedID.value = current.id
    if (selectionChanged || (loadedProviderUpdatedAt !== current.updatedAt && !suspendedDraftSync.has(current.id))) {
      fillDraft(current)
    }
  } else {
    selectedID.value = ''
    loadedProviderUpdatedAt = ''
  }
}, { immediate: true })

function fillDraft(provider: OIDCProvider) {
  Object.assign(draft, { key: provider.key, displayName: provider.displayName, issuerUrl: provider.issuerUrl, clientId: provider.clientId, clientSecret: '', allowedDomains: provider.allowedEmailDomains.join(', '), enabled: provider.enabled })
  loadedProviderUpdatedAt = provider.updatedAt
}

function selectProvider(provider: OIDCProvider) {
  creating.value = false
  selectedID.value = provider.id
  feedback.value = ''
  fillDraft(provider)
}

function beginCreate() {
  creating.value = true
  selectedID.value = ''
  feedback.value = ''
  Object.assign(draft, { key: '', displayName: '', issuerUrl: '', clientId: '', clientSecret: '', allowedDomains: '', enabled: true })
}

function cancelCreate() {
  creating.value = false
  draft.clientSecret = ''
  const first = providers.value[0]
  if (first) selectProvider(first)
}

function save() {
  if (!draft.key.trim() || !draft.displayName.trim() || !draft.issuerUrl.trim() || !draft.clientId.trim() || !splitDomains(draft.allowedDomains).length || (creating.value && !draft.clientSecret)) {
    feedback.value = 'error'
    return
  }
  feedback.value = ''
  const { clientSecret, ...values } = draft
  if (creating.value) {
    const operation: ProviderOperation = { type: 'create', values: { ...values } }
    pendingClientSecrets.set(operation, clientSecret)
    mutation.mutate(operation)
  } else if (selectedProvider.value) {
    const operation: ProviderOperation = { type: 'update', provider: selectedProvider.value, values: { ...values } }
    if (clientSecret) pendingClientSecrets.set(operation, clientSecret)
    mutation.mutate(operation)
  }
}

function confirmDelete() {
  if (selectedProvider.value) mutation.mutate({ type: 'delete', provider: selectedProvider.value })
}

function splitDomains(value: string) {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))]
}

function hasCode(error: unknown, code: number) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === code
}

function operationTargetsActiveContext(operation: ProviderOperation) {
  if (operation.type === 'create') return creating.value
  return !creating.value && selectedID.value === operation.provider.id
}
</script>

<style scoped>
.identity-page { display: grid; gap: 22px; min-width: 0; }
.identity-page__header { display: flex; align-items: end; justify-content: space-between; gap: 20px; }
.identity-page__header p { margin: 0 0 5px; color: rgb(var(--v-theme-primary)); font-size: .78rem; font-weight: 700; text-transform: uppercase; }
.identity-page__header h1 { margin: 0; font-size: 1.75rem; }
.identity-page__header span { display: block; margin-top: 7px; color: rgb(var(--v-theme-on-surface-variant)); }
.identity-page__workspace { display: grid; grid-template-columns: minmax(190px, 260px) minmax(0, 1fr); gap: 24px; border-top: 1px solid var(--moeurl-outline); padding-top: 20px; }
.identity-page__providers { display: grid; align-content: start; gap: 6px; }
.identity-page__provider { display: flex; justify-content: space-between; gap: 10px; width: 100%; padding: 12px; border: 0; border-left: 3px solid transparent; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.identity-page__provider--active { border-left-color: rgb(var(--v-theme-primary)); background: var(--moeurl-surface-soft); }
.identity-page__provider small { color: rgb(var(--v-theme-on-surface-variant)); }
.identity-page__empty { display: grid; gap: 6px; color: rgb(var(--v-theme-on-surface-variant)); }
.identity-page__editor { display: grid; gap: 18px; min-width: 0; }
.identity-page__editor-title { display: flex; align-items: start; justify-content: space-between; gap: 20px; }
.identity-page__editor-title h2 { margin: 0; font-size: 1.25rem; }
.identity-page__editor-title p { margin: 6px 0 0; overflow-wrap: anywhere; color: rgb(var(--v-theme-on-surface-variant)); font-size: .82rem; }
.identity-page__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 14px; }
.identity-page__fields > :nth-child(3), .identity-page__fields > :nth-child(6) { grid-column: 1 / -1; }
.identity-page__actions { display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px; align-items: center; }
@media (max-width: 760px) {
  .identity-page__header { align-items: stretch; flex-direction: column; }
  .identity-page__workspace { grid-template-columns: 1fr; }
  .identity-page__providers { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .identity-page__fields { grid-template-columns: 1fr; }
  .identity-page__fields > :nth-child(3), .identity-page__fields > :nth-child(6) { grid-column: auto; }
}
</style>
