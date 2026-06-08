<template>
  <main class="auth-page auth-page--setup" data-testid="auth-page-setup">
    <RouterLink class="auth-page__brand" to="/">
      <span>M</span>
      <strong>MoeURL</strong>
    </RouterLink>

    <section class="auth-page__panel auth-page__panel--wide" data-testid="auth-panel">
      <aside class="auth-page__story">
        <p class="auth-page__eyebrow">First run setup</p>
        <h1>{{ t('page.setup') }}</h1>
        <p>完成首次初始化后，MoeURL 才会开放控制台和短链管理。</p>
        <div class="auth-page__signal-card" aria-hidden="true">
          <span>boot sequence</span>
          <strong>admin</strong>
          <small>domain + preference</small>
        </div>
      </aside>

      <div class="auth-page__form">
        <v-alert v-if="isLoading" class="auth-page__state" color="primary" variant="tonal">Loading</v-alert>
        <v-alert v-else-if="data?.initialized || initialized" class="auth-page__state" type="success" variant="tonal">
          Initialized
        </v-alert>

        <form v-else class="auth-page__setup-form" @submit.prevent="submit">
          <div class="auth-page__form-heading">
            <span>System owner</span>
            <h2>初始化管理员与站点</h2>
          </div>

          <fieldset class="auth-page__group">
            <legend>管理员账号</legend>
            <div class="auth-page__field-grid auth-page__field-grid--three">
              <v-text-field v-model="form.adminUsername" label="Admin username" variant="outlined" />
              <v-text-field v-model="form.adminPassword" label="Admin password" type="password" variant="outlined" />
              <v-text-field v-model="form.adminNickname" label="Admin nickname" variant="outlined" />
            </div>
          </fieldset>

          <fieldset class="auth-page__group">
            <legend>站点域名</legend>
            <div class="auth-page__field-grid">
              <v-text-field v-model="form.siteName" label="Site name" variant="outlined" />
              <v-text-field v-model="form.systemDomain" label="System domain" variant="outlined" />
              <v-text-field v-model="form.shortLinkDomain" label="Short link domain" variant="outlined" />
            </div>
          </fieldset>

          <fieldset class="auth-page__group">
            <legend>默认偏好</legend>
            <div class="auth-page__field-grid">
              <v-select v-model="form.defaultLanguage" label="Default language" :items="languageItems" variant="outlined" />
              <v-select v-model="form.defaultTheme" label="Default theme" :items="themeItems" variant="outlined" />
            </div>
          </fieldset>

          <v-alert v-if="mutation.isError.value" class="auth-page__alert" type="error" variant="tonal">
            {{ mutation.error.value?.message || '初始化失败' }}
          </v-alert>

          <div class="auth-page__actions">
            <v-btn class="auth-page__submit" color="primary" :loading="mutation.isPending.value" type="submit">
              初始化
            </v-btn>
            <p>初始化会创建管理员账号，并写入站点基础访问域名。</p>
          </div>
        </form>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
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

const languageItems = [
  { title: '简体中文', value: 'zh-CN' },
  { title: 'English', value: 'en' },
]
const themeItems = [
  { title: '跟随系统', value: 'system' },
  { title: '浅色', value: 'light' },
  { title: '深色', value: 'dark' },
]
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
    linear-gradient(115deg, color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent), transparent 36%),
    linear-gradient(245deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 10%, transparent), transparent 34%),
    linear-gradient(145deg, rgb(var(--v-theme-background)), var(--moeurl-surface-soft));
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
  padding: clamp(16px, 2.8vw, 24px);
  border: 1px solid var(--moeurl-outline);
  border-radius: clamp(34px, 6vw, 58px);
  background:
    linear-gradient(145deg, color-mix(in srgb, var(--moeurl-surface-glass) 90%, white 10%), var(--moeurl-surface-glass)),
    var(--moeurl-surface-glass);
  box-shadow: var(--moeurl-shadow-strong);
  backdrop-filter: blur(28px);
}

.auth-page__panel--wide {
  width: min(1180px, 100%);
}

.auth-page__story {
  display: grid;
  align-content: space-between;
  min-height: 620px;
  padding: clamp(28px, 4vw, 42px);
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 72%, transparent);
  border-radius: clamp(28px, 5vw, 44px);
  background:
    linear-gradient(145deg, color-mix(in srgb, rgb(var(--v-theme-primary)) 16%, transparent), transparent 62%),
    color-mix(in srgb, var(--moeurl-surface-elevated) 42%, transparent);
}

.auth-page__story h1,
.auth-page__form-heading h2 {
  color: rgb(var(--v-theme-on-background));
}

.auth-page__eyebrow {
  margin: 0 0 12px;
  padding: 7px 14px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-control);
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

.auth-page__signal-card {
  display: grid;
  gap: 6px;
  width: min(280px, 100%);
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 80%, transparent);
  border-radius: 28px;
  background: color-mix(in srgb, var(--moeurl-surface-glass) 66%, transparent);
}

.auth-page__signal-card span,
.auth-page__signal-card small,
.auth-page__form-heading span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.auth-page__signal-card strong {
  color: rgb(var(--v-theme-primary));
  font-size: 1.8rem;
  line-height: 1;
}

.auth-page__form,
.auth-page__state {
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: 32px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 72%, transparent);
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

.auth-page__setup-form {
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

.auth-page__group {
  min-width: 0;
  margin: 0;
  padding: 14px 14px 0;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 78%, transparent);
  border-radius: 28px;
}

.auth-page__group legend {
  padding: 0 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  font-weight: 900;
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
  border-radius: var(--moeurl-radius-control);
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
    padding: 10px;
    border-radius: 32px;
    gap: 10px;
  }

  .auth-page__story {
    min-height: auto;
    align-content: start;
    padding: 18px;
    border-radius: 26px;
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

  .auth-page__signal-card {
    display: none;
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
