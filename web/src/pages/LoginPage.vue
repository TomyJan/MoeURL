<template>
  <main class="auth-page auth-page--login" data-testid="auth-page-login">
    <RouterLink class="auth-page__brand" to="/">
      <span>M</span>
      <strong>MoeURL</strong>
    </RouterLink>

    <section class="auth-page__panel" data-testid="auth-panel">
      <aside class="auth-page__story">
        <p class="auth-page__eyebrow">{{ t('auth.privateConsole') }}</p>
        <h1>{{ t('page.login') }}</h1>
        <p>{{ t('auth.consoleSummary') }}</p>
        <div class="auth-page__signal-card" aria-hidden="true">
          <strong>MoeURL</strong>
          <span>self-hosted</span>
        </div>
      </aside>

      <form class="auth-page__form" @submit.prevent="submit">
        <div class="auth-page__form-heading">
          <span>MoeURL</span>
          <h2>{{ t('auth.consoleEntry') }}</h2>
        </div>
        <v-text-field v-model="username" :label="t('auth.username')" variant="outlined" />
        <v-text-field v-model="password" :label="t('auth.password')" type="password" variant="outlined" />
        <Transition name="moe-overlay">
          <v-snackbar
            v-if="mutation.isError.value"
            class="auth-page__toast"
            data-testid="auth-error-toast"
            :model-value="true"
            :timeout="5000"
          >
            {{ mutation.error.value?.message || t('auth.loginFailed') }}
          </v-snackbar>
        </Transition>
        <v-btn class="auth-page__submit" color="primary" :loading="mutation.isPending.value" type="submit">
          {{ t('auth.loginSubmit') }}
        </v-btn>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRouter } from 'vue-router'
import { useMutation } from '@tanstack/vue-query'

import { login } from '@/entities/auth/api'
import { queryClient } from '@/app/query'

const { t } = useI18n()
const router = useRouter()
const username = ref('')
const password = ref('')
const mutation = useMutation({
  mutationFn: login,
  onSuccess(data) {
    queryClient.setQueryData(['auth', 'me'], data)
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    void router.push('/')
  },
})

function submit() {
  mutation.mutate({ username: username.value, password: password.value })
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
    linear-gradient(115deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 8%, transparent), transparent 36%),
    linear-gradient(245deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 10%, transparent), transparent 34%),
    linear-gradient(145deg, rgb(var(--v-theme-background)), var(--moeurl-surface-soft));
}

.auth-page__brand {
  position: fixed;
  top: 28px;
  left: max(24px, calc(50% - 580px));
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
  width: min(1060px, 100%);
  grid-template-columns: minmax(0, 0.78fr) minmax(360px, 1fr);
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

.auth-page__story {
  display: grid;
  align-content: space-between;
  min-height: 476px;
  padding: clamp(28px, 4vw, 42px);
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 72%, transparent);
  border-radius: clamp(28px, 5vw, 44px);
  background:
    linear-gradient(145deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 12%, transparent), transparent 62%),
    color-mix(in srgb, var(--moeurl-surface-elevated) 42%, transparent);
}

.auth-page__story h1,
.auth-page__form-heading h2 {
  color: rgb(var(--v-theme-on-background));
}

.auth-page__eyebrow {
  width: fit-content;
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
  font-size: clamp(2rem, 5vw, 3.2rem);
  line-height: 1.08;
}

.auth-page__story p {
  max-width: 25rem;
  margin: 14px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 1.02rem;
  line-height: 1.8;
}

.auth-page__signal-card {
  display: grid;
  gap: 6px;
  width: min(230px, 100%);
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
  font-size: 1.45rem;
  line-height: 1;
}

.auth-page__form {
  display: grid;
  align-content: center;
  gap: 14px;
  padding: clamp(20px, 4vw, 36px);
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: clamp(28px, 5vw, 42px);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 72%, transparent);
}

.auth-page__form-heading {
  margin-bottom: 8px;
}

.auth-page__form-heading h2 {
  margin: 6px 0 0;
  font-size: clamp(1.45rem, 3vw, 2rem);
  line-height: 1.15;
}

.auth-page__toast {
  border-radius: 24px;
}

.auth-page__submit {
  min-height: 52px;
  border-radius: var(--moeurl-radius-control);
}

@media (max-width: 620px) {
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
    padding: 16px;
    border-radius: 26px;
  }

  .auth-page__form-heading h2 {
    font-size: 1.34rem;
  }

  .auth-page__submit {
    width: 100%;
  }
}
</style>
