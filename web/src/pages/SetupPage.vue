<template>
  <main class="auth-page auth-page--setup" data-testid="auth-page-setup">
    <RouterLink class="auth-page__brand" to="/">
      <span>M</span>
      <strong>{{ config.siteName }}</strong>
    </RouterLink>

    <section class="auth-page__panel auth-page__panel--wide" data-testid="auth-panel">
      <aside class="auth-page__story">
        <h1>{{ t('page.setup') }}</h1>
        <p>{{ t('setup.summary') }}</p>
      </aside>

      <div class="auth-page__form">
        <v-alert v-if="isLoading" class="auth-page__state" color="primary" variant="tonal">{{ t('setup.loading') }}</v-alert>
        <v-alert v-else-if="isError || !data" class="auth-page__state" data-testid="setup-status-error" type="error" variant="tonal">
          <span>{{ t('setup.loadFailed') }}</span>
          <v-btn variant="text" @click="retryStatus">{{ t('setup.retry') }}</v-btn>
        </v-alert>
        <div v-else-if="data?.initialized || initialized" class="auth-page__state" data-testid="setup-completion">
          <p>{{ t('setup.initialized') }}</p>
          <div class="auth-page__actions">
            <RouterLink class="auth-page__completion-link auth-page__completion-link--primary" to="/login">{{ t('setup.goToLogin') }}</RouterLink>
            <RouterLink class="auth-page__completion-link" to="/">{{ t('setup.goHome') }}</RouterLink>
          </div>
        </div>

        <form v-else class="setup-wizard" data-testid="setup-wizard" @submit.prevent="submit">
          <div class="auth-page__form-heading">
            <h2>{{ t('setup.title') }}</h2>
          </div>

          <section class="setup-wizard__step" data-testid="setup-step-card" aria-labelledby="setup-admin-title">
            <div class="setup-wizard__step-head">
              <span class="setup-wizard__step-index">01</span>
              <h3 id="setup-admin-title">{{ t('setup.steps.admin') }}</h3>
            </div>
            <div class="auth-page__field-grid auth-page__field-grid--three">
              <v-text-field v-model="form.adminUsername" :error-messages="fieldErrors.adminUsername" data-testid="setup-admin-username" :label="t('setup.adminUsername')" variant="outlined" />
              <v-text-field v-model="form.adminPassword" :error-messages="fieldErrors.adminPassword" autocomplete="new-password" data-testid="setup-admin-password" :label="t('setup.adminPassword')" type="password" variant="outlined" />
              <v-text-field v-model="form.adminNickname" :error-messages="fieldErrors.adminNickname" data-testid="setup-admin-nickname" :label="t('setup.adminNickname')" variant="outlined" />
              <div v-if="data?.setupTokenRequired" class="setup-wizard__token-field">
                <v-text-field v-model="form.setupToken" autocomplete="off" data-testid="setup-token" :label="t('setup.setupToken')" type="password" variant="outlined" />
                <p data-testid="setup-token-help">{{ t('setup.setupTokenHelp') }}</p>
              </div>
            </div>
          </section>

          <section class="setup-wizard__step" data-testid="setup-step-card" aria-labelledby="setup-domain-title">
            <div class="setup-wizard__step-head">
              <span class="setup-wizard__step-index">02</span>
              <h3 id="setup-domain-title">{{ t('setup.steps.domain') }}</h3>
            </div>
            <div class="auth-page__field-grid">
              <v-text-field v-model="form.siteName" :error-messages="fieldErrors.siteName" data-testid="setup-site-name" :label="t('setup.siteName')" variant="outlined" />
              <v-text-field v-model="form.systemDomain" :error-messages="fieldErrors.systemDomain" data-testid="setup-system-domain" :label="t('setup.systemDomain')" variant="outlined" />
              <v-text-field v-model="form.shortLinkDomain" :error-messages="fieldErrors.shortLinkDomain" data-testid="setup-short-link-domain" :label="t('setup.shortLinkDomain')" variant="outlined" />
            </div>
          </section>

          <section class="setup-wizard__step" data-testid="setup-step-card" aria-labelledby="setup-preference-title">
            <div class="setup-wizard__step-head">
              <span class="setup-wizard__step-index">03</span>
              <h3 id="setup-preference-title">{{ t('setup.steps.preference') }}</h3>
            </div>
            <div class="auth-page__field-grid">
              <v-select v-model="form.defaultLanguage" :label="t('setup.defaultLanguage')" :items="languageItems" variant="outlined" />
              <v-select v-model="form.defaultTheme" :label="t('setup.defaultTheme')" :items="themeItems" variant="outlined" />
            </div>
          </section>

          <ActionToast v-if="mutation.isError.value" type="error">
            {{ errorMessage }}
          </ActionToast>

          <div class="auth-page__actions">
            <v-btn class="auth-page__submit" color="primary" data-testid="setup-submit" :loading="mutation.isPending.value" type="submit">
              {{ t('setup.submit') }}
            </v-btn>
            <p>{{ t('setup.hint') }}</p>
          </div>
        </form>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { getInitStatus, setupSystem, SetupInputSchema } from '@/entities/system/api'
import type { SetupInput } from '@/entities/system/api'
import { ApiClientError } from '@/shared/api/client'
import { useSiteConfig } from '@/shared/site/useSiteConfig'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { toast } from 'vue-sonner'

const INVALID_SETUP_TOKEN_ERROR_CODE = 900102
const { config } = useSiteConfig()
const queryClient = useQueryClient()

const { t } = useI18n()
const { data, isError, isLoading, refetch } = useQuery({
  queryKey: ['init-status'],
  queryFn: getInitStatus,
})
const initialized = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const form = reactive<SetupInput>({
  adminUsername: '',
  adminPassword: '',
  adminNickname: '',
  siteName: 'MoeURL',
  systemDomain: globalThis.location.host,
  shortLinkDomain: globalThis.location.origin,
  defaultLanguage: 'zh-CN',
  defaultTheme: 'system',
  setupToken: '',
})

const languageItems = computed(() => [
  { title: t('setup.languages.zhCn'), value: 'zh-CN' },
  { title: t('setup.languages.en'), value: 'en' },
])
const themeItems = computed(() => [
  { title: t('preferences.system'), value: 'system' },
  { title: t('preferences.light'), value: 'light' },
  { title: t('preferences.dark'), value: 'dark' },
])
const mutation = useMutation({
  mutationFn: setupSystem,
  /** Marks the setup flow complete from the server-authoritative result. */
  async onSuccess(result) {
    initialized.value = result.initialized
    await queryClient.invalidateQueries({ queryKey: ['system', 'public-config'] })
  },
  /** Removes the deployment credential without resetting retained mutation errors. */
  onSettled(_result, _error, variables) {
    form.setupToken = ''
    delete variables.setupToken
  },
})
const errorMessage = computed(() => {
  const error = mutation.error.value
  if (error instanceof ApiClientError && error.code === INVALID_SETUP_TOKEN_ERROR_CODE) {
    return t('setup.setupTokenInvalid')
  }
  return t('setup.failed')
})

/** Submits a snapshot of the system initialization form. */
function submit() {
  if (!data.value || isError.value || mutation.isPending.value) {
    return
  }
  const input = { ...form }
  if (!data.value.setupTokenRequired) {
    delete input.setupToken
  }
  const validated = SetupInputSchema.safeParse(input)
  fieldErrors.value = {}
  if (!validated.success) {
    for (const issue of validated.error.issues) {
      const field = String(issue.path[0])
      fieldErrors.value[field] = field === 'adminPassword'
        ? t('setup.passwordMinLength')
        : field === 'siteName' ? t('setup.siteNameInvalid') : t('feedback.required')
    }
    toast.error(t('feedback.invalidForm'))
    return
  }
  mutation.mutate(input)
}

/** Retries loading the server-authoritative initialization status. */
function retryStatus() {
  void refetch()
}
</script>

<style scoped>
.auth-page {
  position: relative;
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  padding: 112px 32px 52px;
  background:
    radial-gradient(ellipse at 10% 20%, var(--moeurl-hero-glow), transparent 60%),
    radial-gradient(ellipse at 90% 85%, color-mix(in srgb, rgb(var(--v-theme-secondary)) 5%, transparent), transparent 55%),
    rgb(var(--v-theme-background));
}

.auth-page__brand {
  position: absolute;
  top: 28px;
  left: max(32px, calc(50% - 580px));
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 64px);
  min-width: 0;
  color: rgb(var(--v-theme-on-background));
  text-decoration: none;
  font-size: 1.18rem;
  letter-spacing: -0.025em;
}

.auth-page__brand span {
  display: grid;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 12px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 650;
}

.auth-page__brand strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 650;
}

.auth-page__panel {
  position: relative;
  z-index: 1;
  display: grid;
  min-width: 0;
  width: min(960px, 100%);
  gap: 28px;
}

.auth-page__panel--wide {
  width: min(960px, 100%);
}

.auth-page__story {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  padding: 0;
  background: transparent;
}

.auth-page__story h1,
.auth-page__form-heading h2 {
  color: rgb(var(--v-theme-on-background));
}

.auth-page__story h1 {
  flex: 0 0 auto;
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.2rem);
  font-weight: 650;
  letter-spacing: -0.035em;
  line-height: 1.3;
}

.auth-page__story p {
  max-width: 440px;
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.9rem;
  line-height: 1.8;
}

.auth-page__form {
  display: grid;
  min-width: 0;
  align-content: center;
  gap: 14px;
  padding: clamp(24px, 3vw, 32px);
  border: 1px solid var(--moeurl-outline);
  border-radius: 24px;
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.auth-page__state {
  padding: 20px;
  border-radius: 12px;
}

.auth-page__state > p {
  margin: 0 0 20px;
  font-size: 1.08rem;
  font-weight: 600;
}

.auth-page__completion-link {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  min-height: 44px;
  padding: 10px 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 12px;
  color: rgb(var(--v-theme-primary));
  font-weight: 550;
  text-decoration: none;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.auth-page__completion-link:hover {
  border-color: rgb(var(--v-theme-primary));
  background: var(--moeurl-surface-soft);
}

.auth-page__completion-link--primary {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.auth-page__completion-link--primary:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 90%, rgb(var(--v-theme-on-background)));
}

.setup-wizard {
  display: grid;
  gap: 22px;
}

.auth-page__form-heading {
  margin-bottom: 0;
}

.auth-page__form-heading h2 {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 650;
  line-height: 1.4;
}

.setup-wizard__step {
  display: grid;
  min-width: 0;
  gap: 20px;
  padding: 22px 0 0;
  border-top: 1px solid var(--moeurl-outline);
}

.setup-wizard__step-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.setup-wizard__step-head h3 {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.96rem;
  font-weight: 600;
}

.setup-wizard__step-index {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 9px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 9%, transparent);
  color: rgb(var(--v-theme-primary));
  font-size: 0.74rem;
  font-weight: 600;
}

.auth-page__field-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 18px;
}

.auth-page__field-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.setup-wizard__token-field {
  min-width: 0;
  grid-column: 1 / -1;
}

.setup-wizard__token-field p {
  margin: -12px 0 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.84rem;
  line-height: 1.7;
}

.auth-page__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
}

.auth-page__actions p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.84rem;
  line-height: 1.7;
}

.auth-page__submit {
  min-height: 46px;
  min-width: 132px;
  border-radius: 12px;
}

@media (max-width: 760px) {
  .auth-page {
    padding: 100px 20px 32px;
  }

  .auth-page__brand {
    top: 22px;
    left: 20px;
    gap: 9px;
    max-width: calc(100% - 40px);
  }

  .auth-page__panel {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .auth-page__story {
    display: grid;
    gap: 12px;
    padding: 0;
  }

  .auth-page__story h1 {
    font-size: 1.8rem;
  }

  .auth-page__story p {
    margin: 0;
  }

  .auth-page__form {
    padding: 24px 20px;
    border-radius: 20px;
  }

  .auth-page__field-grid {
    grid-template-columns: 1fr;
  }

  .auth-page__field-grid--three {
    grid-template-columns: 1fr;
  }

  .auth-page__actions {
    display: grid;
  }

  .auth-page__submit {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-page__completion-link {
    transition: none;
  }
}
</style>
