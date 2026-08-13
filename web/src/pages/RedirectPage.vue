<template>
  <main class="redirect-page">
    <header class="redirect-page__header">
      <a href="/" class="redirect-page__brand">MoeURL</a>
    </header>

    <section class="redirect-page__content">
      <template v-if="loading">
        <v-progress-linear indeterminate />
      </template>

      <div v-else-if="failureState" class="redirect-page__state" aria-live="polite">
        <h1>{{ t(`redirect.${failureState}`) }}</h1>
        <v-btn v-if="failureState === 'loadFailed'" color="primary" @click="loadPreview">
          {{ t('redirect.retry') }}
        </v-btn>
        <v-btn variant="text" :to="{ path: '/' }">{{ t('redirect.backHome') }}</v-btn>
      </div>

      <form v-else-if="passwordRequired" class="redirect-page__state" aria-live="polite" @submit.prevent="unlock">
        <p class="redirect-page__eyebrow">{{ t('redirect.protectedEyebrow') }}</p>
        <h1>{{ t('redirect.passwordTitle') }}</h1>
        <v-text-field
          class="redirect-page__password"
          name="password"
          type="password"
          autocomplete="current-password"
          :disabled="unlockPending"
          :label="t('redirect.password')"
          :error-messages="unlockErrorMessage"
          variant="outlined"
        />
        <div class="redirect-page__actions">
          <v-btn
            type="submit"
            color="primary"
            size="large"
            :disabled="unlockDisabled"
            :loading="unlockPending"
          >
            {{ t('redirect.unlock') }}
          </v-btn>
          <v-btn type="button" variant="text" :to="{ path: '/' }">{{ t('redirect.backHome') }}</v-btn>
        </div>
      </form>

      <div v-else-if="preview" class="redirect-page__state">
        <p class="redirect-page__eyebrow">{{ t('redirect.eyebrow') }}</p>
        <h1>{{ t(preview.redirectMode === 'confirmation' ? 'redirect.confirmationTitle' : 'redirect.title') }}</h1>
        <p v-if="preview.redirectMode === 'confirmation'" class="redirect-page__description">
          {{ t('redirect.confirmationDescription') }}
        </p>
        <dl v-if="preview.redirectMode === 'confirmation'" class="redirect-page__metadata">
          <div>
            <dt>{{ t('redirect.shortCode') }}</dt>
            <dd>{{ preview.slug }}</dd>
          </div>
          <div v-if="preview.expiresAt">
            <dt>{{ t('redirect.expiresAt') }}</dt>
            <dd><time :datetime="preview.expiresAt">{{ formatDateTime(preview.expiresAt) }}</time></dd>
          </div>
        </dl>
        <p class="redirect-page__target-label">{{ t('redirect.targetHost') }}</p>
        <strong class="redirect-page__target">{{ preview.targetHost }}</strong>
        <div v-if="preview.redirectMode === 'intermediate'" class="redirect-page__countdown" aria-live="off">
          <strong>{{ remainingSeconds }}</strong>
          <span>{{ t('redirect.seconds') }}</span>
        </div>
        <v-alert v-if="continueFailed" type="error" variant="tonal">
          {{ t('redirect.continueFailed') }}
        </v-alert>
        <div class="redirect-page__actions">
          <v-btn color="primary" size="large" :loading="navigating" @click="continueToTarget">
            {{ t(preview.redirectMode === 'confirmation' ? 'redirect.confirmationContinue' : 'redirect.continue') }}
          </v-btn>
          <v-btn variant="text" :to="{ path: '/' }">{{ t('redirect.backHome') }}</v-btn>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { getPublicShortLinkPreview, unlockShortLink } from '@/entities/short-link/api'
import type { PublicShortLinkPreview } from '@/entities/short-link/model'
import { ApiClientError } from '@/shared/api/client'

type PreviewFailureState = '' | 'disabled' | 'expired' | 'loadFailed' | 'notInteractive' | 'unavailable'
type UnlockErrorState = '' | 'invalidPassword' | 'passwordRequired' | 'rateLimited' | 'unlockFailed'

const { locale, t } = useI18n()
const route = useRoute()
const preview = ref<PublicShortLinkPreview | null>(null)
const remainingSeconds = ref(0)
const loading = ref(true)
const failureState = ref<PreviewFailureState>('')
const continueFailed = ref(false)
const navigating = ref(false)
const passwordRequired = ref(false)
const unlockPending = ref(false)
const unlockErrorState = ref<UnlockErrorState>('')
const rateLimitRemainingSeconds = ref(0)
let countdownTimer: ReturnType<typeof globalThis.setInterval> | null = null
let rateLimitTimer: ReturnType<typeof globalThis.setInterval> | null = null
let previewRequestId = 0
let isMounted = false

const unlockErrorMessage = computed(() => {
  if (!unlockErrorState.value) {
    return ''
  }
  if (unlockErrorState.value === 'rateLimited') {
    return rateLimitRemainingSeconds.value > 0
      ? t('redirect.rateLimited', { seconds: rateLimitRemainingSeconds.value })
      : t('redirect.rateLimitedWithoutDeadline')
  }
  return t(`redirect.${unlockErrorState.value}`)
})

const unlockDisabled = computed(() =>
  unlockPending.value || (unlockErrorState.value === 'rateLimited' && rateLimitRemainingSeconds.value > 0),
)

onMounted(() => {
  isMounted = true
  void loadPreview()
})
onBeforeUnmount(() => {
  isMounted = false
  previewRequestId += 1
  clearCountdown()
  clearRateLimitCountdown()
})
watch(
  () => [route.params.slug, route.query.reason],
  () => void loadPreview(),
)

/** Loads public metadata while preventing stale requests from mutating page state. */
async function loadPreview() {
  const requestId = ++previewRequestId
  clearCountdown()
  clearRateLimitCountdown()
  preview.value = null
  loading.value = true
  failureState.value = ''
  continueFailed.value = route.query.reason === 'continue-failed'
  navigating.value = false
  passwordRequired.value = false
  unlockPending.value = false
  unlockErrorState.value = unlockErrorFromReason(route.query.reason)
  if (unlockErrorState.value === 'rateLimited') {
    startRateLimitCountdown(route.query.retryAt)
  }

  const requestedFailureState = failureStateFromReason(route.query.reason)
  if (requestedFailureState) {
    whenCurrent(requestId, () => {
      loading.value = false
      failureState.value = requestedFailureState
    })
    return
  }

  const slug = route.params.slug
  if (typeof slug !== 'string' || !slug) {
    whenCurrent(requestId, () => {
      loading.value = false
      failureState.value = 'unavailable'
    })
    return
  }

  try {
    const result = await getPublicShortLinkPreview(slug)
    whenCurrent(requestId, () => {
      preview.value = result
      passwordRequired.value = false
      unlockErrorState.value = ''
      clearRateLimitCountdown()
      proceedAfterAccess(continueFailed.value)
    })
  } catch (error) {
    whenCurrent(requestId, () => {
      if (error instanceof ApiClientError && error.code === 200111) {
        passwordRequired.value = true
        failureState.value = ''
      } else {
        failureState.value = classifyPreviewError(error)
      }
    })
  } finally {
    whenCurrent(requestId, () => {
      loading.value = false
    })
  }
}

/** Reports whether an asynchronous preview result still belongs to the mounted page. */
function isCurrentRequest(requestId: number) {
  return isMounted && requestId === previewRequestId
}

/** Applies a preview state update only for the latest mounted request. */
function whenCurrent(requestId: number, update: () => void) {
  if (isCurrentRequest(requestId)) {
    update()
  }
}

/** Maps navigation reasons into the initial preview failure state. */
function failureStateFromReason(reason: unknown): PreviewFailureState {
  if (reason === 'disabled') {
    return 'disabled'
  }
  if (reason === 'expired') {
    return 'expired'
  }
  if (reason === 'not-interactive') {
    return 'notInteractive'
  }
  return ''
}

/** Maps navigation reasons into the initial password-form error state. */
function unlockErrorFromReason(reason: unknown): UnlockErrorState {
  return reason === 'rate-limited' ? 'rateLimited' : ''
}

function classifyPreviewError(error: unknown): PreviewFailureState {
  const code = error instanceof ApiClientError ? error.code : 0
  if (code === 200109) {
    return 'expired'
  }
  if (code === 200104) {
    return 'unavailable'
  }
  if (code === 200105) {
    return 'disabled'
  }
  if (code === 200110) {
    return 'notInteractive'
  }
  return 'loadFailed'
}

/** Starts the intermediate-page countdown and performs a single continuation at zero. */
function startCountdown() {
  clearCountdown()
  countdownTimer = globalThis.setInterval(() => {
    if (remainingSeconds.value > 1) {
      remainingSeconds.value -= 1
      return
    }
    remainingSeconds.value = 0
    continueToTarget()
  }, 1_000)
}

/** Continues direct links, starts intermediate countdowns, and leaves confirmation links idle. */
function proceedAfterAccess(waitForRetry = false) {
  const currentPreview = preview.value
  /* v8 ignore next -- callers establish a preview first; retain a defensive guard for future call sites. */
  if (!currentPreview) {
    return
  }
  if (currentPreview.redirectMode === 'direct') {
    if (!waitForRetry) {
      continueToTarget()
    }
    return
  }
  if (currentPreview.redirectMode === 'confirmation') {
    return
  }
  remainingSeconds.value = currentPreview.intermediateDelaySeconds
  if (!waitForRetry) {
    startCountdown()
  }
}

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** Submits the password and resumes navigation after a scoped grant is issued. */
async function unlock(event: globalThis.Event) {
  const form = event.currentTarget as globalThis.HTMLFormElement
  const slug = preview.value?.slug ?? route.params.slug
  if (
    unlockDisabled.value
    || typeof slug !== 'string'
    || !slug
  ) {
    return
  }
  const password = new globalThis.FormData(form).get('password')
  if (typeof password !== 'string' || !password) {
    unlockErrorState.value = 'passwordRequired'
    return
  }

  const requestIdentity = `${previewRequestId}:${String(route.params.slug)}`
  const isCurrentUnlock = () => isMounted && requestIdentity === `${previewRequestId}:${String(route.params.slug)}`
  unlockPending.value = true
  unlockErrorState.value = ''
  try {
    await unlockShortLink({ slug, password })
    if (!isCurrentUnlock()) {
      return
    }
    /* v8 ignore next -- password-required state has no preview until this authorized fetch completes. */
    if (!preview.value) {
      const authorizedPreview = await getPublicShortLinkPreview(slug)
      if (!isCurrentUnlock()) {
        return
      }
      preview.value = authorizedPreview
    }
    clearRateLimitCountdown()
    passwordRequired.value = false
    form.reset()
    proceedAfterAccess()
  } catch (error) {
    if (!isCurrentUnlock()) {
      return
    }
    const errorState = classifyUnlockError(error)
    unlockErrorState.value = errorState
    if (errorState === 'rateLimited') {
      startRateLimitCountdown(rateLimitRetryAt(error))
    } else {
      clearRateLimitCountdown()
    }
  } finally {
    if (isCurrentUnlock()) {
      unlockPending.value = false
    }
  }
}

/** Maps unlock API failures into user-facing password states. */
function classifyUnlockError(error: unknown): UnlockErrorState {
  const code = error instanceof ApiClientError ? error.code : 0
  if (code === 200111) {
    return 'passwordRequired'
  }
  if (code === 200112) {
    return 'invalidPassword'
  }
  if (code === 200113) {
    return 'rateLimited'
  }
  return 'unlockFailed'
}

/** Navigates through the backend continue endpoint after intermediate-page access. */
function continueToTarget() {
  const slug = preview.value?.slug ?? route.params.slug
  if (navigating.value || typeof slug !== 'string' || !slug) {
    return
  }

  navigating.value = true
  continueFailed.value = false
  clearCountdown()
  try {
    globalThis.location.assign(`/go/${encodeURIComponent(slug)}/continue`)
  } catch {
    navigating.value = false
    continueFailed.value = true
  }
}

function clearCountdown() {
  if (countdownTimer === null) {
    return
  }
  globalThis.clearInterval(countdownTimer)
  countdownTimer = null
}

function rateLimitRetryAt(error: unknown): unknown {
  /* v8 ignore next -- rateLimited is classified only from ApiClientError responses. */
  return error instanceof ApiClientError ? error.meta.retryAt : undefined
}

function startRateLimitCountdown(retryAt: unknown) {
  clearRateLimitCountdown()
  if (typeof retryAt !== 'string') {
    return
  }
  const retryAtMillis = Date.parse(retryAt)
  if (!Number.isFinite(retryAtMillis)) {
    return
  }

  const update = () => {
    rateLimitRemainingSeconds.value = Math.max(0, Math.ceil((retryAtMillis - Date.now()) / 1_000))
    if (rateLimitRemainingSeconds.value === 0) {
      clearRateLimitCountdown()
      /* v8 ignore next -- this timer is owned by the active rate-limited state. */
      if (unlockErrorState.value === 'rateLimited') {
        unlockErrorState.value = ''
      }
    }
  }
  update()
  if (rateLimitRemainingSeconds.value > 0) {
    rateLimitTimer = globalThis.setInterval(update, 1_000)
  }
}

function clearRateLimitCountdown() {
  if (rateLimitTimer !== null) {
    globalThis.clearInterval(rateLimitTimer)
    rateLimitTimer = null
  }
  rateLimitRemainingSeconds.value = 0
}
</script>

<style scoped>
.redirect-page {
  min-height: 100dvh;
  padding: 20px clamp(18px, 4vw, 56px) 40px;
  background:
    linear-gradient(180deg, color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent), transparent 38%),
    rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
}

.redirect-page__header {
  width: min(1080px, 100%);
  margin: 0 auto;
}

.redirect-page__brand {
  color: rgb(var(--v-theme-on-background));
  font-size: 1.08rem;
  font-weight: 900;
  text-decoration: none;
}

.redirect-page__content {
  display: grid;
  place-items: center;
  width: min(760px, 100%);
  min-height: calc(100dvh - 100px);
  margin: 0 auto;
}

.redirect-page__state {
  display: grid;
  justify-items: center;
  gap: 16px;
  width: min(560px, 100%);
  text-align: center;
}

.redirect-page__state h1 {
  max-width: 18ch;
  margin: 0;
  font-size: clamp(1.75rem, 4vw, 3.2rem);
  line-height: 1.12;
}

.redirect-page__eyebrow,
.redirect-page__target-label {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  font-weight: 850;
}

.redirect-page__description {
  max-width: 46ch;
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.65;
}

.redirect-page__metadata {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 24px;
  margin: 0;
}

.redirect-page__metadata div {
  display: grid;
  gap: 4px;
}

.redirect-page__metadata dt {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 800;
}

.redirect-page__metadata dd {
  margin: 0;
  color: rgb(var(--v-theme-on-surface));
  font-weight: 850;
  overflow-wrap: anywhere;
}

.redirect-page__target {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-primary));
  font-size: clamp(1.1rem, 3vw, 1.55rem);
}

.redirect-page__password {
  width: min(360px, 100%);
}

.redirect-page__countdown {
  display: grid;
  place-items: center;
  width: 112px;
  aspect-ratio: 1;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 30%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 86%, transparent);
}

.redirect-page__countdown strong {
  font-size: 2.4rem;
  line-height: 1;
}

.redirect-page__countdown span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 800;
}

.redirect-page__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
}

@media (max-width: 480px) {
  .redirect-page__actions {
    width: 100%;
  }

  .redirect-page__actions > * {
    flex: 1 1 100%;
  }
}
</style>
