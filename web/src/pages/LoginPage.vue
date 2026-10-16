<template>
  <main class="auth-page auth-page--login" data-testid="auth-page-login">
    <RouterLink class="auth-page__brand" to="/">
      <span>M</span>
      <strong>{{ config.siteName }}</strong>
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
        <template v-if="localLoginEnabled">
          <v-text-field v-model="username" :label="t('auth.username')" variant="outlined" />
          <v-text-field v-model="password" :label="t('auth.password')" type="password" variant="outlined" />
        </template>
        <template v-if="localLoginEnabled || localLoginRejected">
          <ActionToast
            v-if="loginErrorSnackbarOpen"
            data-testid="auth-error-toast"
            type="error"
          >
            {{ loginErrorMessage }}
            <v-btn variant="text" @click="setLoginErrorSnackbarOpen(false)">
              {{ t('auth.dismissError') }}
            </v-btn>
          </ActionToast>
        </template>
        <v-btn v-if="localLoginEnabled" class="auth-page__submit" color="primary" :loading="mutation.isPending.value" type="submit">
          {{ t('auth.loginSubmit') }}
        </v-btn>
        <div v-if="methodsQuery.isPending.value" class="auth-page__oidc-loading" role="progressbar" />
        <v-alert v-else-if="methodsQuery.isError.value" type="error" variant="tonal">
          {{ t('auth.oidcErrors.providerUnavailable') }}
          <v-btn type="button" variant="text" @click="methodsQuery.refetch()">{{ t('oidc.retry') }}</v-btn>
        </v-alert>
        <div v-else-if="oidcProviders.length" class="auth-page__oidc" data-testid="oidc-login-methods">
          <div class="auth-page__divider"><span>{{ t('auth.orContinueWith') }}</span></div>
          <v-btn
            v-for="provider in oidcProviders"
            :key="provider.key"
            block
            :href="oidcStartURL(provider.key, loginRedirectTarget)"
            prepend-icon="mdi-shield-account-outline"
            type="button"
            variant="outlined"
          >
            {{ provider.displayName }}
          </v-btn>
        </div>
        <ActionToast v-if="oidcErrorMessage" type="error">
          {{ oidcErrorMessage }}
        </ActionToast>
      </form>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useMutation, useQuery } from '@tanstack/vue-query'

import { login } from '@/entities/auth/api'
import { getLoginMethods, oidcStartURL } from '@/entities/oidc/api'
import { queryClient } from '@/app/query'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { useSiteConfig } from '@/shared/site/useSiteConfig'
import ActionToast from '@/shared/feedback/ActionToast.vue'

const { t } = useI18n()
const { config } = useSiteConfig()
const router = useRouter()
const route = useRoute()
const username = ref('')
const password = ref('')
const loginErrorSnackbarOpen = ref(false)
const INVALID_CREDENTIAL_ERROR_CODE = 110101
const LOGIN_RATE_LIMITED_ERROR_CODE = 110103
const LOGIN_METHOD_UNAVAILABLE_ERROR_CODE = 110104
const methodsQuery = useQuery({ queryKey: ['auth', 'methods'], queryFn: getLoginMethods, retry: false })
const oidcProviders = computed(() => methodsQuery.data.value?.oidc ?? [])
const mutation = useMutation({
  mutationFn: login,
  /** Starts a fresh identity epoch on every successful login, including the same account. */
  onSuccess(data) {
    void revokeAccountIdentity(queryClient)
    queryClient.setQueryData(['auth', 'me'], data)
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    void router.push(loginRedirectTarget.value)
  },
})
const localLoginRejected = computed(() => hasBusinessErrorCode(mutation.error.value, LOGIN_METHOD_UNAVAILABLE_ERROR_CODE))
const localLoginEnabled = computed(
  () => !methodsQuery.isError.value && !localLoginRejected.value && methodsQuery.data.value?.local.enabled === true,
)

/** Refreshes authentication methods after the server rejects a stale local-login form. */
async function refreshLoginMethodsAfterPolicyChange() {
  const result = await methodsQuery.refetch()
  if (!result.isError) {
    mutation.reset()
  }
}

watch(
  () => [mutation.isError.value, mutation.error.value] as const,
  ([isError, error]) => {
    loginErrorSnackbarOpen.value = isError
    if (isError && hasBusinessErrorCode(error, LOGIN_METHOD_UNAVAILABLE_ERROR_CODE)) {
      void refreshLoginMethodsAfterPolicyChange()
    }
  },
  { immediate: true },
)

const loginErrorMessage = computed(() => {
  const error = mutation.error.value
  if (isInvalidCredentialError(error)) {
    return t('auth.loginFailed')
  }
  if (hasBusinessErrorCode(error, LOGIN_RATE_LIMITED_ERROR_CODE)) {
    return t('auth.loginRateLimited')
  }
  if (hasBusinessErrorCode(error, LOGIN_METHOD_UNAVAILABLE_ERROR_CODE)) {
    return t('auth.localLoginUnavailable')
  }
  return t('auth.loginFailed')
})

const loginRedirectTarget = computed(() => {
  const redirect = route.query.redirect
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
})

const oidcErrorMessage = computed(() => {
  const code = route.query.oidcError
  const keys: Record<string, string> = {
    provider_unavailable: 'auth.oidcErrors.providerUnavailable',
    login_failed: 'auth.oidcErrors.loginFailed',
    identity_not_allowed: 'auth.oidcErrors.identityNotAllowed',
    user_disabled: 'auth.oidcErrors.userDisabled',
  }
  return typeof code === 'string' && Object.hasOwn(keys, code) ? t(keys[code]!) : ''
})

/** Submits the current credentials to the login mutation. */
function submit() {
  if (!localLoginEnabled.value) return
  mutation.mutate({ username: username.value, password: password.value })
}

/** Dismisses the login error notification without changing the mutation result. */
function setLoginErrorSnackbarOpen(value: boolean) {
  loginErrorSnackbarOpen.value = value
}

/** Reports whether an API failure represents invalid login credentials. */
function isInvalidCredentialError(error: unknown) {
  return hasBusinessErrorCode(error, INVALID_CREDENTIAL_ERROR_CODE)
}

/** Reports whether an API failure has the requested stable business code. */
function hasBusinessErrorCode(error: unknown, code: number) {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === code
}
</script>

<style scoped>
.auth-page {
  position: relative;
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  padding: 112px 32px 64px;
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
  width: min(960px, 100%);
  grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
  gap: clamp(32px, 7vw, 90px);
  align-items: center;
}

.auth-page__story {
  display: grid;
  align-content: center;
  padding: 0;
  background: transparent;
}

.auth-page__story h1,
.auth-page__form-heading h2 {
  color: rgb(var(--v-theme-on-background));
}

.auth-page__story h1 {
  max-width: 10em;
  margin: 0;
  font-size: clamp(2rem, 3.8vw, 2.7rem);
  font-weight: 650;
  letter-spacing: -0.04em;
  line-height: 1.3;
  text-wrap: balance;
}

.auth-page__story p {
  max-width: 25rem;
  margin: 20px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.94rem;
  line-height: 1.9;
}

.auth-page__form {
  display: grid;
  min-width: 0;
  align-content: center;
  gap: 14px;
  padding: 32px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 24px;
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.auth-page__form-heading {
  margin-bottom: 14px;
}

.auth-page__form-heading h2 {
  margin: 0;
  font-size: 1.45rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.3;
}

.auth-page__submit {
  min-height: 46px;
  border-radius: 12px;
}

.auth-page__oidc {
  display: grid;
  gap: 10px;
}

.auth-page__oidc :deep(.v-btn__content) {
  white-space: normal;
  overflow-wrap: anywhere;
}

.auth-page__oidc :deep(.v-btn) {
  height: auto;
  min-height: 44px;
  padding-block: 10px;
}

.auth-page__oidc-loading {
  height: 52px;
}

.auth-page__divider {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
}

.auth-page__divider::before,
.auth-page__divider::after {
  flex: 1;
  height: 1px;
  background: var(--moeurl-outline);
  content: '';
}

@media (max-width: 760px) {
  .auth-page {
    padding: 100px 20px 40px;
  }

  .auth-page__brand {
    top: 22px;
    left: 20px;
    gap: 9px;
    max-width: calc(100% - 40px);
  }

  .auth-page__panel {
    grid-template-columns: 1fr;
    max-width: 440px;
    gap: 28px;
  }

  .auth-page__story {
    align-content: start;
    padding: 0;
  }

  .auth-page__story h1 {
    max-width: none;
    font-size: 2rem;
  }

  .auth-page__story p {
    margin-top: 10px;
    font-size: 0.9rem;
    line-height: 1.75;
  }

  .auth-page__form {
    padding: 24px;
    border-radius: 20px;
  }

  .auth-page__form-heading h2 {
    font-size: 1.34rem;
  }

  .auth-page__submit {
    width: 100%;
  }
}
</style>
