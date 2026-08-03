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

      <div v-else-if="preview" class="redirect-page__state">
        <p class="redirect-page__eyebrow">{{ t('redirect.eyebrow') }}</p>
        <h1>{{ t('redirect.title') }}</h1>
        <p class="redirect-page__target-label">{{ t('redirect.targetHost') }}</p>
        <strong class="redirect-page__target">{{ preview.targetHost }}</strong>
        <div class="redirect-page__countdown" aria-live="off">
          <strong>{{ remainingSeconds }}</strong>
          <span>{{ t('redirect.seconds') }}</span>
        </div>
        <v-alert v-if="continueFailed" type="error" variant="tonal">
          {{ t('redirect.continueFailed') }}
        </v-alert>
        <div class="redirect-page__actions">
          <v-btn color="primary" size="large" :loading="navigating" @click="continueToTarget">
            {{ t('redirect.continue') }}
          </v-btn>
          <v-btn variant="text" :to="{ path: '/' }">{{ t('redirect.backHome') }}</v-btn>
        </div>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { getPublicShortLinkPreview } from '@/entities/short-link/api'
import type { PublicShortLinkPreview } from '@/entities/short-link/model'
import { ApiClientError } from '@/shared/api/client'

type PreviewFailureState = '' | 'disabled' | 'expired' | 'loadFailed' | 'notIntermediate' | 'unavailable'

const { t } = useI18n()
const route = useRoute()
const preview = ref<PublicShortLinkPreview | null>(null)
const remainingSeconds = ref(0)
const loading = ref(true)
const failureState = ref<PreviewFailureState>('')
const continueFailed = ref(false)
const navigating = ref(false)
let countdownTimer: ReturnType<typeof globalThis.setInterval> | null = null

onMounted(loadPreview)
onBeforeUnmount(clearCountdown)

async function loadPreview() {
  clearCountdown()
  preview.value = null
  loading.value = true
  failureState.value = ''
  continueFailed.value = false
  navigating.value = false

  const requestedFailureState = failureStateFromReason(route.query.reason)
  if (requestedFailureState) {
    loading.value = false
    failureState.value = requestedFailureState
    return
  }

  const slug = route.params.slug
  if (typeof slug !== 'string' || !slug) {
    loading.value = false
    failureState.value = 'unavailable'
    return
  }

  try {
    const result = await getPublicShortLinkPreview(slug)
    preview.value = result
    remainingSeconds.value = result.intermediateDelaySeconds
    startCountdown()
  } catch (error) {
    failureState.value = classifyPreviewError(error)
  } finally {
    loading.value = false
  }
}

function failureStateFromReason(reason: unknown): PreviewFailureState {
  if (reason === 'disabled') {
    return 'disabled'
  }
  if (reason === 'expired') {
    return 'expired'
  }
  if (reason === 'not-intermediate') {
    return 'notIntermediate'
  }
  return ''
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
    return 'notIntermediate'
  }
  return 'loadFailed'
}

function startCountdown() {
  countdownTimer = globalThis.setInterval(() => {
    if (remainingSeconds.value > 1) {
      remainingSeconds.value -= 1
      return
    }
    remainingSeconds.value = 0
    continueToTarget()
  }, 1_000)
}

function continueToTarget() {
  const slug = route.params.slug
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

.redirect-page__target {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-primary));
  font-size: clamp(1.1rem, 3vw, 1.55rem);
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
