<template>
  <section class="short-link-create-panel" :class="`short-link-create-panel--${mode}`">
    <div class="short-link-create-panel__shell">
      <div v-if="mode === 'full'" class="short-link-create-panel__header">
        <div>
          <p class="short-link-create-panel__eyebrow">{{ t('shortLinkCreate.eyebrow') }}</p>
          <h2>{{ t('shortLinkCreate.title') }}</h2>
        </div>
      </div>

      <div class="short-link-create-panel__form">
        <div class="short-link-create-panel__field-row">
          <v-text-field
            v-model="targetUrl"
            class="short-link-create-panel__input"
            :label="t('shortLinkCreate.targetLabel')"
            :placeholder="t('shortLinkCreate.targetPlaceholder')"
            variant="outlined"
            :disabled="!canCreateShortLink || mutation.isPending.value"
            :error-messages="errorMessage"
            @keyup.enter="submit"
          />
          <v-btn
            class="short-link-create-panel__submit"
            color="primary"
            size="large"
            :disabled="!canCreateShortLink || mutation.isPending.value"
            :loading="mutation.isPending.value"
            @click="submit"
          >
            {{ t('shortLinkCreate.submit') }}
          </v-btn>
        </div>
        <div v-if="canConfigureAccess" class="short-link-create-panel__advanced">
          <v-btn
            class="short-link-create-panel__advanced-toggle"
            size="small"
            variant="text"
            :aria-expanded="advancedOpen"
            :disabled="mutation.isPending.value"
            @click="advancedOpen = !advancedOpen"
          >
            {{ t('shortLinkCreate.advanced') }}
          </v-btn>
          <Transition name="moe-layout">
            <div v-if="advancedOpen" class="short-link-create-panel__advanced-controls">
              <div v-if="canUseIntermediate" class="short-link-create-panel__mode-control">
                <span>{{ t('shortLinkCreate.redirectMode') }}</span>
                <v-btn-toggle
                  v-model="redirectMode"
                  mandatory
                  divided
                  :aria-label="t('shortLinkCreate.redirectMode')"
                  :disabled="mutation.isPending.value"
                >
                  <v-btn
                    size="small"
                    :aria-pressed="redirectMode === 'direct'"
                    :disabled="mutation.isPending.value"
                    value="direct"
                  >
                    {{ t('shortLinkCreate.redirectModes.direct') }}
                  </v-btn>
                  <v-btn
                    size="small"
                    :aria-pressed="redirectMode === 'intermediate'"
                    :disabled="mutation.isPending.value"
                    value="intermediate"
                  >
                    {{ t('shortLinkCreate.redirectModes.intermediate') }}
                  </v-btn>
                </v-btn-toggle>
              </div>
              <v-slider
                v-if="canUseIntermediate && redirectMode === 'intermediate'"
                v-model="intermediateDelaySeconds"
                :label="t('shortLinkCreate.intermediateDelay')"
                :min="3"
                :max="10"
                :step="1"
                :disabled="mutation.isPending.value"
                show-ticks="always"
                thumb-label
              />
              <v-switch
                v-if="canSetExpiration"
                v-model="expirationEnabled"
                color="primary"
                density="comfortable"
                hide-details
                :label="t('shortLinkCreate.expirationEnabled')"
                :disabled="mutation.isPending.value"
              />
              <v-text-field
                v-if="canSetExpiration && expirationEnabled"
                v-model="expiresAt"
                type="datetime-local"
                variant="outlined"
                :label="t('shortLinkCreate.expiresAt')"
                :disabled="mutation.isPending.value"
                :error-messages="expirationErrorMessage"
              />
              <v-switch
                v-if="canSetPassword"
                v-model="passwordEnabled"
                color="primary"
                density="comfortable"
                hide-details
                :label="t('shortLinkCreate.passwordEnabled')"
                :disabled="mutation.isPending.value"
              />
              <v-text-field
                v-if="canSetPassword && passwordEnabled"
                ref="passwordField"
                data-testid="short-link-create-password-input"
                type="password"
                autocomplete="new-password"
                variant="outlined"
                :label="t('shortLinkCreate.password')"
                :disabled="mutation.isPending.value"
                :error-messages="passwordErrorMessage"
              />
            </div>
          </Transition>
        </div>
        <div v-if="showPermissionRequired" class="short-link-create-panel__permission" role="status">
          {{ t('shortLinkCreate.permissionRequired') }}
        </div>
        <p v-if="copyErrorMessage" class="short-link-create-panel__error" role="alert">
          {{ copyErrorMessage }}
        </p>
      </div>

      <Transition name="moe-layout">
        <div v-if="createdUrl" class="short-link-create-panel__result" data-testid="short-link-create-result" role="status">
          <div class="short-link-create-panel__created">
            <strong>{{ t('shortLinkCreate.successTitle') }}</strong>
            <a :href="createdUrl" target="_blank" rel="noreferrer">{{ createdUrl }}</a>
            <div class="short-link-create-panel__actions">
              <v-btn size="small" variant="text" @click="copyUrl(createdUrl)">{{ t('shortLinkCreate.copy') }}</v-btn>
              <v-btn size="small" variant="text" :href="createdUrl" target="_blank" rel="noreferrer">
                {{ t('shortLinkCreate.open') }}
              </v-btn>
              <v-btn size="small" variant="text" @click="qrOpen = true">{{ t('shortLinkCreate.qrCode') }}</v-btn>
              <v-btn size="small" variant="text" @click="resetForm">{{ t('shortLinkCreate.reset') }}</v-btn>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </section>
  <ShortLinkQrDialog
    :open="qrOpen"
    :slug="createdSlug"
    :url="createdUrl"
    @update:open="qrOpen = $event"
  />
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import { createShortLink } from '@/entities/short-link/api'
import type { CreateShortLinkInput, RedirectMode } from '@/entities/short-link/model'
import ShortLinkQrDialog from '@/features/short-link-qr/ShortLinkQrDialog.vue'
import { runShortLinkMutation } from '@/shared/short-link/runShortLinkMutation'
import { futureDateTimeSchema, passwordSchema, targetUrlSchema } from '@/shared/validation/shortLinkAccess'

withDefaults(
  defineProps<{
    mode?: 'compact' | 'full'
  }>(),
  {
    mode: 'compact',
  },
)

const { t } = useI18n()
const queryClient = useQueryClient()
const targetUrl = ref('')
const createdUrl = ref('')
const createdSlug = ref('')
const qrOpen = ref(false)
const validationErrorMessage = ref('')
const copyErrorMessage = ref('')
const expirationErrorMessage = ref('')
const passwordErrorMessage = ref('')
const advancedOpen = ref(false)
const redirectMode = ref<RedirectMode>('direct')
const intermediateDelaySeconds = ref(5)
const expirationEnabled = ref(false)
const expiresAt = ref('')
const passwordEnabled = ref(false)
const passwordField = useTemplateRef<{ $el: globalThis.Element }>('passwordField')
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const currentUser = computed(() => currentUserQuery.data.value?.user)
const hasResolvedCurrentUser = computed(() => currentUserQuery.data.value !== undefined)
const canCreateShortLink = computed(() =>
  Boolean(currentUser.value?.permissions.includes('short_link:create') && currentUser.value?.permissions.includes('domain:use_default')),
)
const canUseIntermediate = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:use_intermediate')))
const canSetExpiration = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_expiration')))
const canSetPassword = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_password')))
const canConfigureAccess = computed(() => canUseIntermediate.value || canSetExpiration.value || canSetPassword.value)
const showPermissionRequired = computed(() => hasResolvedCurrentUser.value && !canCreateShortLink.value)

const mutation = useMutation({
  /** Runs creation through the shared sensitive-input cleanup boundary. */
  mutationFn: (input: Omit<CreateShortLinkInput, 'password'>) => {
    const passwordRequested = canSetPassword.value && passwordEnabled.value
    const passwordElement = passwordRequested ? passwordInput() : null
    const requestPassword = passwordElement?.value
    clearPasswordInput()
    const passwordResult = requestPassword === undefined ? undefined : passwordSchema.safeParse(requestPassword)
    if (passwordRequested && (!passwordResult || !passwordResult.success)) {
      passwordErrorMessage.value = requestPassword
        ? t('shortLinkCreate.passwordInvalid')
        : t('shortLinkCreate.passwordRequired')
      return Promise.reject(new Error(t('shortLinkCreate.failed')))
    }
    return runShortLinkMutation(
      createShortLink,
      input,
      passwordResult?.success ? { mode: 'set', value: passwordResult.data } : undefined,
      passwordRequested,
    )
  },
  onSuccess(result) {
    createdUrl.value = result.shortLink.url
    createdSlug.value = result.shortLink.slug
    qrOpen.value = false
    resetInputFields()
    void queryClient.invalidateQueries({ queryKey: ['short-link'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-short-link'] })
  },
  onSettled() {
    clearPasswordInput()
  },
})

const errorMessage = computed(() => {
  if (validationErrorMessage.value) {
    return validationErrorMessage.value
  }
  if (mutation.error.value) {
    return mutation.error.value instanceof Error ? mutation.error.value.message : t('shortLinkCreate.failed')
  }
  return ''
})

/** Validates the form and submits only access settings allowed by current permissions. */
function submit() {
  if (!canCreateShortLink.value || mutation.isPending.value) {
    return
  }
  const submitted = submitValidatedInput()
  if (!submitted) {
    clearPasswordInput()
  }
}

function submitValidatedInput(): boolean {
  validationErrorMessage.value = ''
  copyErrorMessage.value = ''
  expirationErrorMessage.value = ''
  passwordErrorMessage.value = ''
  const targetUrlResult = targetUrlSchema.safeParse(targetUrl.value)
  if (!targetUrlResult.success) {
    validationErrorMessage.value = t('shortLinkCreate.invalidUrl')
    return false
  }
  let expiration: CreateShortLinkInput['expiration']
  if (canSetExpiration.value) {
    if (!expirationEnabled.value) {
      expiration = { mode: 'never' }
    } else {
      const expirationResult = futureDateTimeSchema.safeParse(expiresAt.value)
      if (!expirationResult.success) {
        expirationErrorMessage.value = expiresAt.value.trim()
          ? t('shortLinkCreate.expirationFuture')
          : t('shortLinkCreate.expirationRequired')
        return false
      }
      expiration = { mode: 'at', expiresAt: new Date(expirationResult.data).toISOString() }
    }
  }

  const input: CreateShortLinkInput = { targetUrl: targetUrlResult.data }
  if (canUseIntermediate.value) {
    input.redirectMode = redirectMode.value
    input.intermediateDelaySeconds = intermediateDelaySeconds.value
  }
  if (expiration) {
    input.expiration = expiration
  }
  if (canSetPassword.value && passwordEnabled.value) {
    if (!passwordInput()) {
      passwordErrorMessage.value = t('shortLinkCreate.passwordRequired')
      return false
    }
  }
  createdUrl.value = ''
  createdSlug.value = ''
  mutation.mutate(input)
  return true
}

function resetForm() {
  resetInputFields()
  createdUrl.value = ''
  createdSlug.value = ''
  qrOpen.value = false
}

/** Clears creation inputs after a successful request while preserving the generated result. */
function resetInputFields() {
  targetUrl.value = ''
  validationErrorMessage.value = ''
  copyErrorMessage.value = ''
  expirationErrorMessage.value = ''
  passwordErrorMessage.value = ''
  redirectMode.value = 'direct'
  intermediateDelaySeconds.value = 5
  expirationEnabled.value = false
  expiresAt.value = ''
  clearPasswordInput()
  passwordEnabled.value = false
}

function passwordInput() {
  const field = passwordField.value?.$el
  if (!(field instanceof globalThis.HTMLElement) || !field.matches('[data-testid="short-link-create-password-input"]')) {
    return null
  }
  return field.querySelector<globalThis.HTMLInputElement>('input')
}

function clearPasswordInput() {
  const input = passwordInput()
  if (input) {
    input.value = ''
  }
}

async function copyUrl(url: string) {
  copyErrorMessage.value = ''
  try {
    const writeText = navigator.clipboard?.writeText
    if (!writeText) {
      throw new Error('clipboard unavailable')
    }
    await writeText.call(navigator.clipboard, url)
  } catch {
    copyErrorMessage.value = t('shortLinkCreate.copyFailed')
  }
}
</script>

<style scoped>
.short-link-create-panel {
  width: 100%;
}

.short-link-create-panel--full {
  width: min(760px, 100%);
}

.short-link-create-panel__shell {
  position: relative;
  overflow: hidden;
  padding: clamp(16px, 2.6vw, 24px);
  border: 1px solid var(--moeurl-outline);
  border-radius: clamp(28px, 4vw, 40px);
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 7%, transparent), transparent 44%),
    var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.short-link-create-panel__header,
.short-link-create-panel__form,
.short-link-create-panel__result {
  position: relative;
  z-index: 1;
}

.short-link-create-panel__header {
  display: grid;
  margin-bottom: 16px;
  text-align: left;
}

.short-link-create-panel__header h2 {
  margin: 4px 0 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: clamp(1.12rem, 2vw, 1.42rem);
  line-height: 1.2;
}

.short-link-create-panel__eyebrow {
  margin: 0;
  color: rgb(var(--v-theme-primary));
  font-size: 0.78rem;
  font-weight: 900;
}

.short-link-create-panel__form {
  display: grid;
  gap: 12px;
}

.short-link-create-panel__permission {
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-secondary)) 22%, transparent);
  border-radius: 20px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 7%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 750;
  text-align: center;
}

.short-link-create-panel__advanced {
  display: grid;
  justify-items: start;
  border-top: 1px solid var(--moeurl-outline);
  padding-top: 8px;
}

.short-link-create-panel__advanced-toggle {
  margin-inline-start: -8px;
}

.short-link-create-panel__advanced-controls {
  display: grid;
  gap: 12px;
  width: 100%;
  padding-top: 8px;
}

.short-link-create-panel__mode-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.88rem;
  font-weight: 760;
}

.short-link-create-panel__error {
  margin: 0;
  color: rgb(var(--v-theme-error));
  font-size: 0.88rem;
  font-weight: 760;
  text-align: center;
}

.short-link-create-panel__field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.short-link-create-panel__input {
  min-width: 0;
}

.short-link-create-panel__submit {
  min-height: 56px;
  padding-inline: 24px;
  border-radius: var(--moeurl-radius-pill);
}

.short-link-create-panel__result {
  display: grid;
  place-items: center;
  margin: 16px auto 0;
  padding: 16px;
  width: min(560px, 100%);
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 24%, transparent);
  border-radius: 26px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 11%, transparent);
}

.short-link-create-panel__created {
  display: grid;
  justify-items: center;
  gap: 8px;
  min-width: 0;
  text-align: center;
}

.short-link-create-panel__created a {
  max-width: 100%;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-primary));
  font-weight: 850;
}

.short-link-create-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 620px) {
  .short-link-create-panel__field-row {
    grid-template-columns: 1fr;
  }

  .short-link-create-panel__submit {
    width: 100%;
  }
}
</style>
