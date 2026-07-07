<template>
  <main class="auth-page auth-page--login" data-testid="auth-page-login">
    <RouterLink class="auth-page__brand" to="/">
      <span>M</span>
      <strong>MoeURL</strong>
    </RouterLink>

    <section class="auth-page__panel" data-testid="auth-panel">
      <aside class="auth-page__story">
        <h1>{{ t('auth.consoleEntry') }}</h1>
        <p>{{ t('auth.consoleSummary') }}</p>
      </aside>

      <form class="auth-page__form" @submit.prevent="submit">
        <div class="auth-page__form-heading">
          <h2>{{ t('page.login') }}</h2>
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
            {{ loginErrorMessage }}
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
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useMutation } from '@tanstack/vue-query'

import { login } from '@/entities/auth/api'
import { queryClient } from '@/app/query'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const mutation = useMutation({
  mutationFn: login,
  onSuccess(data) {
    queryClient.setQueryData(['auth', 'me'], data)
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    void router.push(loginRedirectTarget.value)
  },
})

const loginErrorMessage = computed(() => {
  const error = mutation.error.value
  if (isInvalidCredentialError(error)) {
    return t('auth.loginFailed')
  }
  return error instanceof Error ? error.message : t('auth.loginFailed')
})

const loginRedirectTarget = computed(() => {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/'
})

function submit() {
  mutation.mutate({ username: username.value, password: password.value })
}

function isInvalidCredentialError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 110101
}
</script>

<style scoped>
.auth-page {
  position: relative;
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 82px 24px 44px;
  background:
    radial-gradient(circle at 50% 8%, var(--moeurl-hero-glow), transparent 28rem),
    linear-gradient(180deg, rgb(var(--v-theme-background)), var(--moeurl-surface-soft));
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
  width: min(900px, 100%);
  grid-template-columns: minmax(0, 0.72fr) minmax(360px, 1fr);
  gap: clamp(24px, 5vw, 64px);
  align-items: center;
}

.auth-page__story {
  display: grid;
  align-content: center;
  min-height: 320px;
  padding: 0;
  background: transparent;
}

.auth-page__story h1,
.auth-page__form-heading h2 {
  color: rgb(var(--v-theme-on-background));
}

.auth-page__story h1 {
  max-width: 8em;
  margin: 0;
  font-size: clamp(2rem, 4.6vw, 3rem);
  line-height: 1.08;
}

.auth-page__story p {
  max-width: 25rem;
  margin: 14px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 1.02rem;
  line-height: 1.8;
}

.auth-page__form {
  display: grid;
  align-content: center;
  gap: 16px;
  min-height: 360px;
  padding: clamp(24px, 4vw, 40px);
  border: 1px solid var(--moeurl-outline);
  border-radius: clamp(28px, 5vw, 42px);
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
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
  border-radius: var(--moeurl-radius-pill);
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
    gap: 18px;
  }

  .auth-page__story {
    min-height: auto;
    align-content: start;
    padding: 0 4px;
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
