<template>
  <section class="settings-page" data-testid="admin-settings-page">
    <header class="settings-page__header">
      <div>
        <p>{{ t('pageMeta.identityEyebrow') }}</p>
        <h1>{{ t('settings.title') }}</h1>
        <span>{{ t('settings.description') }}</span>
      </div>
    </header>

    <v-progress-linear v-if="query.isPending.value && !query.data.value" indeterminate />
    <v-alert v-else-if="query.isError.value && !query.data.value" type="error" variant="tonal">
      {{ t('settings.loadFailed') }}
      <template #append><v-btn type="button" variant="text" @click="query.refetch()">{{ t('settings.retry') }}</v-btn></template>
    </v-alert>
    <form v-else-if="query.data.value" class="settings-page__form" @submit.prevent="save">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">
        {{ t('settings.loadFailed') }}
        <template #append><v-btn type="button" variant="text" @click="query.refetch()">{{ t('settings.retry') }}</v-btn></template>
      </v-alert>
      <section class="settings-page__section">
        <h2>{{ t('settings.brandTitle') }}</h2>
        <v-text-field v-model="draft.siteName" :label="t('settings.siteName')" variant="outlined" />
        <v-textarea v-model="draft.footerText" :label="t('settings.footerText')" variant="outlined" rows="3" />
        <v-switch v-model="draft.showPoweredBy" :label="t('settings.showPoweredBy')" />
      </section>
      <section class="settings-page__section">
        <h2>{{ t('settings.preferenceTitle') }}</h2>
        <v-select v-model="draft.defaultLanguage" :label="t('settings.defaultLanguage')" :items="languageItems" variant="outlined" />
        <v-select v-model="draft.defaultTheme" :label="t('settings.defaultTheme')" :items="themeItems" variant="outlined" />
      </section>
      <section class="settings-page__section">
        <h2>{{ t('settings.authTitle') }}</h2>
        <v-switch v-model="draft.localLoginEnabled" :label="t('settings.localLoginEnabled')" />
        <p>{{ t('settings.authHint') }}</p>
      </section>
      <v-alert v-if="feedback" :type="feedback === 'success' ? 'success' : 'error'" variant="tonal">{{ feedbackMessage }}</v-alert>
      <div class="settings-page__actions">
        <v-btn v-if="feedback === 'conflict'" type="button" variant="text" @click="reloadLatest">{{ t('settings.reload') }}</v-btn>
        <v-btn color="primary" type="submit" :loading="mutation.isPending.value">{{ t('settings.save') }}</v-btn>
      </div>
    </form>
    <AdminAuthenticationPage />
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { getAdminSettings, updateAdminSettings, type Settings } from '@/entities/system/api'
import { ApiClientError } from '@/shared/api/client'
import { setSiteConfig } from '@/shared/site/useSiteConfig'
import AdminAuthenticationPage from './AdminAuthenticationPage.vue'

const { t } = useI18n()
const queryClient = useQueryClient()
const query = useQuery({ queryKey: ['admin', 'system', 'settings'], queryFn: getAdminSettings, retry: false })
const draft = reactive({ siteName: '', defaultLanguage: 'zh-CN' as 'zh-CN' | 'en', defaultTheme: 'system' as 'system' | 'light' | 'dark', footerText: '', showPoweredBy: true, localLoginEnabled: true })
const expectedUpdatedAt = ref('')
const feedback = ref<'success' | 'conflict' | 'noProvider' | 'error' | ''>('')
let baseline: typeof draft | null = null
let preserveDraftDuringRefresh = false
let conflictLatest: Settings | null = null
const languageItems = computed(() => [{ title: t('setup.languages.zhCn'), value: 'zh-CN' }, { title: t('setup.languages.en'), value: 'en' }])
const themeItems = computed(() => [{ title: t('preferences.system'), value: 'system' }, { title: t('preferences.light'), value: 'light' }, { title: t('preferences.dark'), value: 'dark' }])

watch(query.data, (settings) => {
  if (!settings) return
  if (preserveDraftDuringRefresh || dirty()) return
  fill(settings)
}, { immediate: true })
const mutation = useMutation({
  mutationFn: updateAdminSettings,
  onSuccess(settings) {
    fill(settings)
    conflictLatest = null
    feedback.value = 'success'
    queryClient.setQueryData(['admin', 'system', 'settings'], settings)
    queryClient.setQueryData(['system', 'public-config'], publicProjection(settings))
    void queryClient.invalidateQueries({ queryKey: ['auth', 'methods'] })
    setSiteConfig(publicProjection(settings))
  },
  async onError(error) {
    if (!(error instanceof ApiClientError) || error.code !== 900202) {
      feedback.value = error instanceof ApiClientError && error.code === 900203 ? 'noProvider' : 'error'
      return
    }
    feedback.value = 'conflict'
    preserveDraftDuringRefresh = true
    try {
      const refreshed = await query.refetch()
      if (refreshed.isSuccess) conflictLatest = refreshed.data
    } finally {
      preserveDraftDuringRefresh = false
    }
  },
})
const feedbackMessage = computed(() => feedback.value === 'success' ? t('settings.saveSuccess') : feedback.value === 'conflict' ? t('settings.conflict') : feedback.value === 'noProvider' ? t('settings.noLoginProvider') : t('settings.saveFailed'))

function fill(settings: Settings) {
  Object.assign(draft, { siteName: settings.siteName, defaultLanguage: settings.defaultLanguage, defaultTheme: settings.defaultTheme, footerText: settings.footerText, showPoweredBy: settings.showPoweredBy, localLoginEnabled: settings.localLoginEnabled })
  expectedUpdatedAt.value = settings.updatedAt
  baseline = { ...draft }
}
function dirty() {
  return baseline !== null && Object.keys(draft).some((key) => draft[key as keyof typeof draft] !== baseline?.[key as keyof typeof draft])
}
function save() {
  const siteName = draft.siteName.trim()
  const footerText = draft.footerText.trim()
  if (!siteName || [...siteName].length > 64 || [...footerText].length > 200 || !expectedUpdatedAt.value) {
    feedback.value = 'error'
    return
  }
  feedback.value = ''
  mutation.mutate({ ...draft, siteName, footerText, expectedUpdatedAt: expectedUpdatedAt.value })
}
async function reloadLatest() {
  if (conflictLatest) {
    fill(conflictLatest)
    conflictLatest = null
    feedback.value = ''
    return
  }
  const refreshed = await query.refetch()
  if (refreshed.isSuccess) {
    fill(refreshed.data)
    feedback.value = ''
  }
}
function publicProjection(settings: Settings) {
  return {
    siteName: settings.siteName, defaultLanguage: settings.defaultLanguage, defaultTheme: settings.defaultTheme,
    footerText: settings.footerText, showPoweredBy: settings.showPoweredBy,
  }
}
</script>

<style scoped>
.settings-page { display: grid; gap: 22px; min-width: 0; }
.settings-page__header { display: flex; justify-content: space-between; gap: 20px; }
.settings-page__header p { margin: 0 0 5px; color: rgb(var(--v-theme-primary)); font-size: .78rem; font-weight: 700; text-transform: uppercase; }
.settings-page__header h1 { margin: 0; font-size: 1.75rem; }
.settings-page__header span { display: block; margin-top: 7px; color: rgb(var(--v-theme-on-surface-variant)); }
.settings-page__form { display: grid; gap: 18px; }
.settings-page__section { display: grid; gap: 8px; padding: 18px; border: 1px solid var(--moeurl-outline); border-radius: 18px; background: rgb(var(--v-theme-surface)); }
.settings-page__section h2 { margin: 0 0 4px; font-size: 1.1rem; }
.settings-page__section p { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .9rem; }
.settings-page__actions { display: flex; justify-content: flex-end; }
</style>
