<template>
  <section class="domain-preference" data-testid="domain-preference-panel">
    <h2>{{ t('domainPreference.title') }}</h2>
    <p>{{ t('domainPreference.description') }}</p>
    <v-progress-linear v-if="query.isPending.value && eligible" indeterminate />
    <v-alert v-if="query.isError.value" type="error" variant="tonal">
      {{ t('domainPreference.loadFailed') }}
      <v-btn :disabled="busy || !eligible" variant="text" @click="reload(false)">{{ t('domainPreference.retry') }}</v-btn>
    </v-alert>
    <v-alert v-if="domains.isError.value" type="error" variant="tonal">
      {{ t('shortLinkCreate.domainLoadFailed') }}
      <v-btn :disabled="busy || !eligible" variant="text" @click="domains.refetch()">{{ t('shortLinkCreate.retryDomains') }}</v-btn>
    </v-alert>
    <p v-if="unavailable" role="status">{{ t('domainPreference.unavailable') }}</p>
    <v-alert v-if="conflict" type="warning" variant="tonal">
      {{ t('domainPreference.conflict') }}
      <v-btn :disabled="busy || !eligible" variant="text" @click="reload(true)">{{ t('domainPreference.reload') }}</v-btn>
    </v-alert>
    <form data-testid="domain-preference-form" @submit.prevent="submit">
      <v-select v-model="draftDomain" :items="items" :label="t('domainPreference.domain')" :error-messages="errors.domain" :disabled="locked" variant="outlined" />
      <v-btn data-testid="domain-preference-save" type="submit" color="primary" :disabled="locked" :loading="pending">{{ t('domainPreference.save') }}</v-btn>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQueryClient } from '@tanstack/vue-query'
import { useForm } from 'vee-validate'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { updateDomainPreference, type DomainPreference } from '@/entities/user/domain-preference'
import { useAvailableDomainChoices, useDomainPreference } from '@/shared/preferences/useDomainPreference'
import { ApiClientError } from '@/shared/api/client'

const props = defineProps<{ userId: string; active: boolean }>()
const { t } = useI18n()
const client = useQueryClient()
const { query, scope, isCurrent, queryKey } = useDomainPreference()
const domains = useAvailableDomainChoices()
const original = shallowRef<DomainPreference>()
const schema = z.object({ domain: z.union([z.literal(''), z.uuid()]) })
const { values, errors, defineField, resetForm, setErrors } = useForm<z.infer<typeof schema>>({ initialValues: { domain: '' } })
const [draftDomain] = defineField('domain')
const pending = ref(false)
const reloading = ref(false)
const conflict = ref(false)
const mounted = ref(true)
const eligible = computed(() => mounted.value && props.active && !!props.userId && scope.value.userId === props.userId)
const busy = computed(() => pending.value || reloading.value || query.isFetching.value)
const locked = computed(() => !eligible.value || !original.value || query.isError.value || busy.value)
const dirty = computed(() => !!original.value && draftDomain.value !== (original.value.domainId ?? ''))
const available = computed(() => domains.isSuccess.value ? domains.data.value!.items : [])
const unavailable = computed(() => !!original.value?.domainId && domains.isSuccess.value && !available.value.some((item) => item.id === original.value?.domainId))
const items = computed(() => [{ title: t('domainPreference.useSystem'), value: '' }, ...available.value.map((item) => ({ title: `${item.displayName} (${item.host})`, value: item.id }))])
onBeforeUnmount(() => { mounted.value = false })
watch(scope, () => {
  original.value = undefined
  conflict.value = false
  pending.value = false
  reloading.value = false
  resetForm({ values: { domain: '' } })
}, { flush: 'sync' })
watch(query.data, (value) => { if (value && eligible.value && !dirty.value && !conflict.value) adopt(value) }, { immediate: true })

/** Adopts only authoritative successful reads or saves, preserving full version precision. */
function adopt(value: DomainPreference) {
  original.value = value
  resetForm({ values: { domain: value.domainId ?? '' } })
  conflict.value = false
}

/** Discards conflict drafts only after a successful explicit reload for this exact epoch. */
async function reload(discard: boolean) {
  if (!eligible.value || busy.value) return
  const requestScope = scope.value
  reloading.value = true
  try {
    const result = await query.refetch({ throwOnError: true })
    if (isCurrent(requestScope) && eligible.value && result.data && (discard || !dirty.value)) adopt(result.data)
  } catch {
    // Persistent query failure keeps the draft and exposes the retry action.
  } finally { if (isCurrent(requestScope)) reloading.value = false }
}

/** Saves this resource once; stale-epoch responses cannot write caches or display feedback. */
async function submit() {
  if (locked.value) return
  const parsed = schema.safeParse(values)
  if (!parsed.success || (parsed.data.domain !== '' && !available.value.some((item) => item.id === parsed.data.domain))) {
    setErrors({ domain: t('domainPreference.invalid') })
    return
  }
  const requestScope = scope.value
  const key = queryKey.value
  pending.value = true
  try {
    const value = await updateDomainPreference({ domainId: parsed.data.domain || null, expectedUpdatedAt: original.value!.updatedAt })
    if (!isCurrent(requestScope) || !eligible.value) return
    void client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData(key, value)
    adopt(value)
    toast.success(t('domainPreference.saved'))
  } catch (error) {
    if (!isCurrent(requestScope) || !eligible.value) return
    conflict.value = error instanceof ApiClientError && error.code === 300104
    toast.error(t(conflict.value ? 'domainPreference.conflict' : error instanceof ApiClientError && error.code === 120001 ? 'domainPreference.unavailable' : 'domainPreference.saveFailed'))
  } finally { if (isCurrent(requestScope)) pending.value = false }
}
</script>

<style scoped>
.domain-preference { display: grid; min-width: 0; align-content: start; gap: 14px; padding: 22px; border: 1px solid var(--moeurl-outline); border-radius: var(--moeurl-radius-panel); background: var(--moeurl-surface-elevated); box-shadow: var(--moeurl-shadow); }
.domain-preference h2 { margin: 0; font-size: 1.18rem; }
.domain-preference p { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.7; overflow-wrap: anywhere; }
.domain-preference form { display: grid; min-width: 0; gap: 12px; justify-items: start; }
.domain-preference form > :first-child { width: 100%; }
@media (max-width: 620px) { .domain-preference { padding: 18px; } }
</style>
