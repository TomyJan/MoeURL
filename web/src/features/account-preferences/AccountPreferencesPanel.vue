<template>
  <section class="account-preferences" data-testid="account-preferences-panel">
    <h2>{{ t('accountPreferences.title') }}</h2>
    <p>{{ t('accountPreferences.description') }}</p>
    <v-progress-linear v-if="query.isPending.value && eligible" indeterminate :aria-label="t('accountPreferences.loading')" />
    <v-alert v-if="query.isError.value" type="error" variant="tonal">
      {{ t('accountPreferences.loadFailed') }}
      <v-btn data-testid="account-preferences-retry" :disabled="!eligible || busy" variant="text" @click="reload(false)">{{ t('accountPreferences.retry') }}</v-btn>
    </v-alert>
    <v-alert v-if="conflict" type="warning" variant="tonal">
      {{ t('accountPreferences.conflict') }}
      <v-btn data-testid="account-preferences-reload" :disabled="!eligible || busy" variant="text" @click="reload(true)">{{ t('accountPreferences.reload') }}</v-btn>
    </v-alert>
    <form class="account-preferences__form" data-testid="account-preferences-form" @submit.prevent="submit">
      <v-select v-model="draftLanguage" :items="languageItems" :label="t('accountPreferences.language')" :error-messages="errors.language" :disabled="locked" variant="outlined" />
      <v-select v-model="draftTheme" :items="themeItems" :label="t('accountPreferences.theme')" :error-messages="errors.theme" :disabled="locked" variant="outlined" />
      <div class="account-preferences__actions">
        <v-btn data-testid="account-preferences-save" type="submit" color="primary" :disabled="locked" :loading="pending">{{ t('accountPreferences.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useForm } from 'vee-validate'
import { z } from 'zod'
import { updateAccountPreferences, type AccountPreferences } from '@/entities/user/preferences'
import { ApiClientError } from '@/shared/api/client'
import { useAccountPreferences } from '@/shared/preferences/useAccountPreferences'

const props = defineProps<{ userId: string; active: boolean }>()
const { t } = useI18n()
const { query, scope, isCurrent, queryKey, client, preferences, markSaved } = useAccountPreferences()
const original = shallowRef<AccountPreferences>()
const schema = z.object({ language: z.enum(['browser', 'zh-CN', 'en']), theme: z.enum(['browser', 'system', 'light', 'dark']) })
const { values, errors, defineField, resetForm, setErrors } = useForm<z.infer<typeof schema>>({ initialValues: { language: 'browser', theme: 'browser' } })
const [draftLanguage] = defineField('language')
const [draftTheme] = defineField('theme')
const pending = ref(false)
const reloading = ref(false)
const conflict = ref(false)
const mounted = ref(true)
const eligible = computed(() => mounted.value && props.active && !!props.userId && props.userId === scope.value.userId)
const busy = computed(() => pending.value || reloading.value || query.isFetching.value)
const locked = computed(() => !eligible.value || !original.value || query.isError.value || busy.value)
const dirty = computed(() => !!original.value && (draftLanguage.value !== (original.value.language ?? 'browser') || draftTheme.value !== (original.value.theme ?? 'browser')))
const languageItems = computed(() => [
  { title: t('accountPreferences.browser'), value: 'browser' },
  { title: '简体中文', value: 'zh-CN' }, { title: 'English', value: 'en' },
])
const themeItems = computed(() => [
  { title: t('accountPreferences.browser'), value: 'browser' },
  { title: t('preferences.system'), value: 'system' },
  { title: t('preferences.light'), value: 'light' },
  { title: t('preferences.dark'), value: 'dark' },
])
onBeforeUnmount(() => { mounted.value = false })
watch(scope, () => { original.value = undefined; conflict.value = false }, { flush: 'sync' })
watch(query.data, (value) => {
  if (value && eligible.value && !dirty.value && !conflict.value) adopt(value)
}, { immediate: true })

/** Replaces the editor snapshot only after a successful authoritative load or save. */
function adopt(value: AccountPreferences) {
  original.value = value
  resetForm({ values: { language: value.language ?? 'browser', theme: value.theme ?? 'browser' } })
  conflict.value = false
}

/** Reloads the current account; a failed conflict recovery retains the draft and original version. */
async function reload(discardDraft: boolean) {
  if (!eligible.value || busy.value) return
  const requestScope = scope.value
  reloading.value = true
  try {
    const result = await query.refetch({ throwOnError: true })
    if (isCurrent(requestScope) && eligible.value && result.data && (discardDraft || !dirty.value)) adopt(result.data)
  } catch {
    // The query retains a persistent error and retry action without exposing server details.
  } finally {
    reloading.value = false
  }
}

/** Saves once against the editing snapshot and discards responses from revoked identity epochs. */
async function submit() {
  if (locked.value) return
  const parsed = schema.safeParse(values)
  if (!parsed.success) {
    setErrors({ language: t('accountPreferences.invalidRequest'), theme: t('accountPreferences.invalidRequest') })
    toast.error(t('accountPreferences.invalidRequest'))
    return
  }
  const requestScope = scope.value
  const key = queryKey.value
  pending.value = true
  try {
    const value = await updateAccountPreferences({
      language: draftLanguage.value === 'browser' ? null : draftLanguage.value,
      theme: draftTheme.value === 'browser' ? null : draftTheme.value,
      expectedUpdatedAt: original.value!.updatedAt,
    })
    if (!isCurrent(requestScope) || !eligible.value) return
    markSaved()
    void client.cancelQueries({ queryKey: key, exact: true })
    client.setQueryData(key, value)
    adopt(value)
    preferences.applyAccountPreferences(value)
    toast.success(t('accountPreferences.saved'))
  } catch (error) {
    if (!isCurrent(requestScope) || !eligible.value) return
    conflict.value = error instanceof ApiClientError && error.code === 300104
    const message = conflict.value ? 'conflict' : error instanceof ApiClientError && error.code === 120001 ? 'unavailable' : 'saveFailed'
    toast.error(t(`accountPreferences.${message}`))
  } finally {
    pending.value = false
  }
}
</script>

<style scoped>
.account-preferences { display: grid; min-width: 0; align-content: start; gap: 14px; padding: 22px; border: 1px solid var(--moeurl-outline); border-radius: var(--moeurl-radius-panel); background: var(--moeurl-surface-elevated); box-shadow: var(--moeurl-shadow); }
.account-preferences h2 { margin: 0; font-size: 1.18rem; }
.account-preferences p { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.7; overflow-wrap: anywhere; }
.account-preferences__form { display: grid; min-width: 0; gap: 12px; }
.account-preferences__actions { display: flex; flex-wrap: wrap; }
@media (max-width: 620px) { .account-preferences { padding: 18px; } }
</style>
