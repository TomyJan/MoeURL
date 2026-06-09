<template>
  <main class="auth-page auth-page--setup" data-testid="auth-page-setup">
    <RouterLink class="auth-page__brand" to="/">
      <span>M</span>
      <strong>MoeURL</strong>
    </RouterLink>

    <section class="auth-page__panel auth-page__panel--wide" data-testid="auth-panel">
      <aside class="auth-page__story">
        <p class="auth-page__eyebrow">{{ t('setup.eyebrow') }}</p>
        <h1>{{ t('page.setup') }}</h1>
        <p>{{ t('setup.summary') }}</p>
      </aside>

      <div class="auth-page__form">
        <v-alert v-if="isLoading" class="auth-page__state" color="primary" variant="tonal">{{ t('setup.loading') }}</v-alert>
        <v-alert v-else-if="data?.initialized || initialized" class="auth-page__state" type="success" variant="tonal">
          {{ t('setup.initialized') }}
        </v-alert>

        <form v-else class="setup-wizard" data-testid="setup-wizard" @submit.prevent="submit">
          <div class="auth-page__form-heading">
            <span>{{ t('setup.mark') }}</span>
            <h2>{{ t('setup.title') }}</h2>
          </div>

          <section class="setup-wizard__step" data-testid="setup-step-card" aria-labelledby="setup-admin-title">
            <div class="setup-wizard__step-head">
              <span class="setup-wizard__step-index">01</span>
              <h3 id="setup-admin-title">{{ t('setup.steps.admin') }}</h3>
            </div>
            <div class="auth-page__field-grid auth-page__field-grid--three">
              <v-text-field v-model="form.adminUsername" :label="t('setup.adminUsername')" variant="outlined" />
              <v-text-field v-model="form.adminPassword" :label="t('setup.adminPassword')" type="password" variant="outlined" />
              <v-text-field v-model="form.adminNickname" :label="t('setup.adminNickname')" variant="outlined" />
            </div>
          </section>

          <section class="setup-wizard__step" data-testid="setup-step-card" aria-labelledby="setup-domain-title">
            <div class="setup-wizard__step-head">
              <span class="setup-wizard__step-index">02</span>
              <h3 id="setup-domain-title">{{ t('setup.steps.domain') }}</h3>
            </div>
            <div class="auth-page__field-grid">
              <v-text-field v-model="form.siteName" :label="t('setup.siteName')" variant="outlined" />
              <v-text-field v-model="form.systemDomain" :label="t('setup.systemDomain')" variant="outlined" />
              <v-text-field v-model="form.shortLinkDomain" :label="t('setup.shortLinkDomain')" variant="outlined" />
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

          <v-alert v-if="mutation.isError.value" class="auth-page__alert" type="error" variant="tonal">
            {{ mutation.error.value?.message || t('setup.failed') }}
          </v-alert>

          <div class="auth-page__actions">
            <v-btn class="auth-page__submit" color="primary" :loading="mutation.isPending.value" type="submit">
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
import { useMutation, useQuery } from '@tanstack/vue-query'

import { getInitStatus, setupSystem } from '@/entities/system/api'
import type { SetupInput } from '@/entities/system/api'

const { t } = useI18n()
const { data, isLoading } = useQuery({
  queryKey: ['init-status'],
  queryFn: getInitStatus,
})
const initialized = ref(false)
const form = reactive<SetupInput>({
  adminUsername: '',
  adminPassword: '',
  adminNickname: '',
  siteName: 'MoeURL',
  systemDomain: '127.0.0.1:8080',
  shortLinkDomain: '127.0.0.1:8080',
  defaultLanguage: 'zh-CN',
  defaultTheme: 'system',
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
  onSuccess(result) {
    initialized.value = result.initialized
  },
})

function submit() {
  mutation.mutate({ ...form })
}
</script>

<style scoped>
.auth-page {
  position: relative;
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 104px 24px 54px;
  background:
    radial-gradient(circle at 50% 8%, var(--moeurl-hero-glow), transparent 28rem),
    linear-gradient(180deg, rgb(var(--v-theme-background)), var(--moeurl-surface-soft));
}

.auth-page__brand {
  position: fixed;
  top: 28px;
  left: max(24px, calc(50% - 640px));
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: rgb(var(--v-theme-on-background));
  text-decoration: none;
}

.auth-page__brand span {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 15px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 900;
}

.auth-page__panel {
  position: relative;
  z-index: 1;
  display: grid;
  width: min(1180px, 100%);
  grid-template-columns: minmax(300px, 0.62fr) minmax(0, 1fr);
  gap: clamp(18px, 3vw, 28px);
  align-items: center;
}

.auth-page__panel--wide {
  width: min(1180px, 100%);
}

.auth-page__story {
  display: grid;
  align-content: center;
  min-height: 520px;
  padding: 0;
  background: transparent;
}

.auth-page__story h1,
.auth-page__form-heading h2 {
  color: rgb(var(--v-theme-on-background));
}

.auth-page__eyebrow {
  margin: 0 0 12px;
  padding: 7px 14px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-pill);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.auth-page__story h1 {
  max-width: 8em;
  margin: 0;
  font-size: clamp(2rem, 5vw, 3.1rem);
  line-height: 1.08;
}

.auth-page__story p {
  max-width: 520px;
  margin: 14px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 1.02rem;
  line-height: 1.8;
}

.auth-page__form-heading span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.auth-page__form,
.auth-page__state {
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: 32px;
  background: var(--moeurl-surface-elevated);
}

.auth-page__form {
  display: grid;
  align-content: center;
  gap: 14px;
  padding: clamp(18px, 3vw, 28px);
}

.auth-page__state {
  padding: 18px;
}

.setup-wizard {
  display: grid;
  gap: 14px;
}

.auth-page__form-heading {
  margin-bottom: 2px;
}

.auth-page__form-heading h2 {
  margin: 6px 0 0;
  font-size: clamp(1.35rem, 3vw, 1.8rem);
  line-height: 1.15;
}

.setup-wizard__step {
  display: grid;
  min-width: 0;
  gap: 12px;
  padding: 16px 16px 0;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 82%, transparent);
  border-radius: 28px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--moeurl-surface-elevated) 88%, rgb(var(--v-theme-primary)) 5%), var(--moeurl-surface-elevated));
  box-shadow: 0 12px 26px color-mix(in srgb, rgb(var(--v-theme-primary)) 3%, transparent);
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
  font-weight: 900;
}

.setup-wizard__step-index {
  display: inline-grid;
  width: 34px;
  height: 28px;
  place-items: center;
  border-radius: var(--moeurl-radius-pill);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 15%, transparent);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.74rem;
  font-weight: 950;
}

.auth-page__field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 14px;
}

.auth-page__field-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.auth-page__alert {
  border-radius: 24px;
}

.auth-page__actions {
  display: flex;
  align-items: center;
  gap: 16px;
}

.auth-page__actions p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.92rem;
}

.auth-page__submit {
  min-height: 52px;
  min-width: 132px;
  border-radius: var(--moeurl-radius-pill);
}

@media (max-width: 760px) {
  .auth-page {
    align-items: start;
    padding: 82px 12px 34px;
  }

  .auth-page__brand {
    top: 18px;
    left: 18px;
    gap: 9px;
    font-size: 1.18rem;
  }

  .auth-page__brand span {
    width: 44px;
    height: 44px;
    border-radius: 17px;
  }

  .auth-page__panel {
    grid-template-columns: 1fr;
    gap: 18px;
  }

  .auth-page__story {
    min-height: auto;
    align-content: start;
    padding: 0 4px;
  }

  .auth-page__eyebrow {
    width: fit-content;
    margin-bottom: 10px;
    padding: 6px 11px;
    font-size: 0.68rem;
  }

  .auth-page__story h1 {
    font-size: 1.95rem;
  }

  .auth-page__story p {
    margin-top: 10px;
    font-size: 0.88rem;
    line-height: 1.6;
  }

  .auth-page__form {
    padding: 12px;
    border-radius: 26px;
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
</style>
