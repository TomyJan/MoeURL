<template>
  <section v-if="eligible" class="time-zone-preference" data-testid="time-zone-preference-panel">
    <h2>{{ t('timeZonePreference.title') }}</h2>
    <p>{{ t('timeZonePreference.description') }}</p>
    <v-alert v-if="unsupported" type="warning" variant="tonal">{{ t('timeZonePreference.unsupported') }}</v-alert>
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-if="readError" type="error" variant="tonal">
      {{ t('timeZonePreference.loadFailed') }}
      <v-btn :disabled="busy" variant="text" @click="reload(false)">{{ t('timeZonePreference.retry') }}</v-btn>
    </v-alert>
    <v-alert v-if="conflict" type="warning" variant="tonal">
      {{ t('timeZonePreference.conflict') }}
      <v-btn :disabled="busy" variant="text" @click="reload(true)">{{ t('timeZonePreference.reload') }}</v-btn>
    </v-alert>
    <form data-testid="time-zone-preference-form" @submit.prevent="submit">
      <v-autocomplete v-model:search="search" :model-value="draft" :items="items" :label="t('timeZonePreference.zone')" :hint="t('timeZonePreference.searchHint')" persistent-hint :no-data-text="t('timeZonePreference.noMatches')" :error-messages="invalid ? t('timeZonePreference.invalid') : undefined" :disabled="!original" :auto-select-first="false" variant="outlined" @update:model-value="edit" />
      <p data-testid="time-zone-preference-selection">{{ t('timeZonePreference.selected', { zone: draft || t('timeZonePreference.device') }) }}</p>
      <v-btn data-testid="time-zone-preference-save" type="submit" color="primary" :disabled="locked" :loading="pending">{{ t('timeZonePreference.save') }}</v-btn>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { timeZoneCatalog, timeZonePresets, timeZoneSchema, updateTimeZonePreference, type TimeZonePreference } from '@/entities/time-zone-preference/api'
import { useTimeZonePreference } from '@/shared/preferences/useTimeZonePreference'
import { ApiClientError } from '@/shared/api/client'

const props = defineProps<{ userId: string; active: boolean }>()
const { t } = useI18n()
const { scope, isCurrent, query, preference, readError, unsupported, publish } = useTimeZonePreference(computed(() => props.active && !!props.userId))
const original = shallowRef<TimeZonePreference>()
const draft = ref('')
const search = ref('')
const editRevision = ref(0)
const pending = ref(false)
const reloading = ref(false)
const conflict = ref(false)
const invalid = ref(false)
const mounted = ref(true)
const eligible = computed(() => mounted.value && props.active && !!props.userId && scope.value.userId === props.userId)
const busy = computed(() => pending.value || reloading.value || query.isFetching.value)
const dirty = computed(() => !!original.value && draft.value !== (original.value.timeZone ?? ''))
const locked = computed(() => !eligible.value || !original.value || busy.value || readError.value || conflict.value || invalid.value)
const items = computed(() => [{ title: t('timeZonePreference.device'), value: '' }, ...timeZoneCatalog.map(value => ({ title: (timeZonePresets as readonly string[]).includes(value) ? t('timeZonePreference.zones.' + value) + ' · ' + value : value, value }))])
const draftSchema = z.union([z.literal(''), timeZoneSchema])
onBeforeUnmount(() => { mounted.value = false })
// Temporary authentication errors pause this editor without changing its owner.
watch([scope, () => props.userId], () => {
  original.value = undefined; draft.value = ''; search.value = ''; editRevision.value++; pending.value = false; reloading.value = false; conflict.value = false; invalid.value = false
}, { flush: 'sync' })
watch([preference, eligible], ([value]) => {
  if (value && eligible.value && !dirty.value && !pending.value && !reloading.value && !conflict.value) adopt(value)
}, { immediate: true })

/** Counts user edits independently from authoritative snapshot adoption. */
function edit(value: unknown) {
  // Clearing the search field is not an explicit selection of the device option.
  if (value === null) return
  const selected = draftSchema.safeParse(value)
  if (!selected.success) { invalid.value = true; return }
  draft.value = selected.data; editRevision.value++; invalid.value = false
}
/** Adopts a successful server snapshot with its original CAS precision. */
function adopt(value: TimeZonePreference) { original.value = value; draft.value = value.timeZone ?? ''; search.value = ''; conflict.value = false; invalid.value = false }

/** Failed reloads preserve drafts; edits made after a reload started also win. */
async function reload(discard: boolean) {
  if (!eligible.value || busy.value) return
  const owner = scope.value
  const revision = editRevision.value
  reloading.value = true
  try {
    const result = await query.refetch({ throwOnError: true })
    if (!isCurrent(owner) || !eligible.value || !result.data || result.data.userId !== owner.userId || result.data.epoch !== owner.epoch) return
    if (discard && revision !== editRevision.value) {
      original.value = result.data.preference
      conflict.value = false
    } else if (revision === editRevision.value && (discard || !dirty.value)) adopt(result.data.preference)
  } catch {
    // The scoped query failure exposes retry without replacing the local snapshot.
  } finally { if (isCurrent(owner) && mounted.value) reloading.value = false }
}

/** Updates the saved revision, but never replaces a draft edited during the request. */
async function submit() {
  if (locked.value) return
  const owner = scope.value
  const revision = editRevision.value
  const input = { timeZone: draft.value || null, expectedUpdatedAt: original.value!.updatedAt }
  pending.value = true
  try {
    const saved = await updateTimeZonePreference(input)
    if (!isCurrent(owner) || !eligible.value) return
    publish(owner, saved)
    original.value = saved
    conflict.value = false
    if (revision === editRevision.value) adopt(saved)
    toast.success(t('timeZonePreference.saved'))
  } catch (error) {
    if (!isCurrent(owner) || !eligible.value) return
    conflict.value = error instanceof ApiClientError && error.code === 300104
    toast.error(t(conflict.value ? 'timeZonePreference.conflict' : error instanceof ApiClientError && error.code === 120001 ? 'timeZonePreference.unavailable' : 'timeZonePreference.saveFailed'))
  } finally { if (isCurrent(owner) && mounted.value) pending.value = false }
}
</script>

<style scoped>
.time-zone-preference { display: grid; min-width: 0; align-content: start; gap: 14px; padding: 22px; border: 1px solid var(--moeurl-outline); border-radius: var(--moeurl-radius-panel); background: var(--moeurl-surface-elevated); box-shadow: var(--moeurl-shadow); }
.time-zone-preference h2 { margin: 0; font-size: 1.18rem; }
.time-zone-preference p { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.7; overflow-wrap: anywhere; }
.time-zone-preference form { display: grid; min-width: 0; gap: 12px; justify-items: start; }
.time-zone-preference form > :first-child { width: 100%; }
@media (max-width: 620px) { .time-zone-preference { padding: 18px; } }
</style>
