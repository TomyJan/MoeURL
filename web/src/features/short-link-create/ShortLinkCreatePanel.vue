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
        <v-select
          v-if="availableDomains.length > 1"
          v-model="domainChoice"
          :items="domainOptions"
          :label="t('shortLinkCreate.domainLabel')"
          :disabled="mutation.isPending.value || domainQuery.isError.value"
          variant="outlined"
        />
        <div v-if="domainQuery.isError.value && canCreateWithPermissions" role="alert">
          {{ t('shortLinkCreate.domainLoadFailed') }}
          <v-btn variant="text" @click="domainQuery.refetch()">{{ t('shortLinkCreate.retryDomains') }}</v-btn>
        </div>
        <p v-else-if="domainQuery.data.value && availableDomains.length === 0 && canCreateWithPermissions" role="status">
          {{ t('shortLinkCreate.noAvailableDomains') }}
        </p>
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
              <template v-if="canCustomizeSlug">
                <v-text-field
                  v-model="customSlug"
                  :label="t('shortLinkCreate.customSlug')"
                  :error-messages="customSlugError"
                  :disabled="mutation.isPending.value || !canCreateShortLink"
                  autocapitalize="none"
                  autocomplete="off"
                  spellcheck="false"
                  variant="outlined"
                />
                <p class="short-link-create-panel__slug-hint">{{ t('shortLinkCreate.customSlugHint') }}</p>
                <p v-if="customSlugPreview" class="short-link-create-panel__slug-preview" data-testid="custom-slug-preview">{{ customSlugPreview }}</p>
              </template>
              <template v-if="canSetMetadata">
                <v-text-field v-model="metadataTitle" :label="t('linkMetadata.title')" :error-messages="metadataTitleError" :disabled="mutation.isPending.value" variant="outlined" />
                <v-textarea v-model="metadataTags" :label="t('linkMetadata.tags')" :error-messages="metadataTagsError" :disabled="mutation.isPending.value" rows="3" variant="outlined" />
              </template>
              <div v-if="canConfigureRedirect" class="short-link-create-panel__mode-control">
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
                    v-if="canUseIntermediate"
                    size="small"
                    :aria-pressed="redirectMode === 'intermediate'"
                    :disabled="mutation.isPending.value"
                    value="intermediate"
                  >
                    {{ t('shortLinkCreate.redirectModes.intermediate') }}
                  </v-btn>
                  <v-btn
                    v-if="canUseConfirmation"
                    size="small"
                    :aria-pressed="redirectMode === 'confirmation'"
                    :disabled="mutation.isPending.value"
                    value="confirmation"
                  >
                    {{ t('shortLinkCreate.redirectModes.confirmation') }}
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
                v-if="canSetMaxVisits"
                v-model="limitEnabled"
                :label="t('visitLimit.enabled')"
                :disabled="mutation.isPending.value"
                color="primary"
                hide-details
              />
              <v-text-field
                v-if="canSetMaxVisits && limitEnabled"
                v-model="maxVisits"
                :label="t('visitLimit.maximum')"
                :error-messages="limitErrorMessage"
                :disabled="mutation.isPending.value"
                inputmode="numeric"
                variant="outlined"
              />
              <p v-if="canSetMaxVisits && limitEnabled">{{ t('visitLimit.hint') }}</p>
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
        <ActionToast v-if="copyErrorMessage" type="error">
          {{ copyErrorMessage }}
        </ActionToast>
        <ActionToast v-if="mutation.error.value && !passwordErrorMessage" type="error">{{ creationErrorMessage }}</ActionToast>
        <ActionToast v-if="customSlugError && canCustomizeSlug" type="error">{{ customSlugError }}</ActionToast>
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
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { toast } from 'vue-sonner'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import { availableDomainQueryKey, listAvailableDomains } from '@/entities/domain/api'
import { createShortLink } from '@/entities/short-link/api'
import type { CreateShortLinkInput, RedirectMode } from '@/entities/short-link/model'
import { visitLimitInputSchema } from '@/entities/short-link/schema'
import ShortLinkQrDialog from '@/features/short-link-qr/ShortLinkQrDialog.vue'
import { runShortLinkMutation } from '@/shared/short-link/runShortLinkMutation'
import { useRedirectModePermissions } from '@/shared/short-link/useRedirectModePermissions'
import { futureDateTimeSchema, passwordSchema, targetUrlSchema } from '@/shared/validation/shortLinkAccess'
import { metadataDraftSchema } from '@/shared/validation/shortLinkMetadata'
import { customSlugSchema } from '@/shared/validation/customSlug'
import { ApiClientError } from '@/shared/api/client'

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
const customSlug = ref('')
const customSlugError = ref('')
const metadataTitle = ref('')
const metadataTags = ref('')
const metadataTitleError = ref('')
const metadataTagsError = ref('')
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
const limitEnabled = ref(false)
const maxVisits = ref('')
const limitErrorMessage = ref('')
const selectedDomainId = ref('')
const passwordField = useTemplateRef<{ $el: globalThis.Element }>('passwordField')
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const domainQuery = useQuery({ queryKey: availableDomainQueryKey, queryFn: listAvailableDomains, retry: false })
const currentUser = computed(() => currentUserQuery.data.value?.user)
const hasResolvedCurrentUser = computed(() => currentUserQuery.data.value !== undefined)
const canCreateWithPermissions = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:create') &&
  (currentUser.value?.permissions.includes('domain:use_default') || currentUser.value?.permissions.includes('domain:use_assigned'))))
const availableDomains = computed(() => domainQuery.data.value?.items ?? [])
const canUseDefaultDomain = computed(() => Boolean(currentUser.value?.permissions.includes('domain:use_default')))
const domainOptions = computed(() => availableDomains.value.map((item) => ({ title: `${item.displayName} (${item.host})`, value: item.isDefault && canUseDefaultDomain.value ? '' : item.id })))
const fallbackDomainId = computed(() => {
  if (canUseDefaultDomain.value && availableDomains.value.some((item) => item.isDefault)) return ''
  // The selector and submission path are only active when at least one domain is available.
  return (availableDomains.value.find((item) => item.isDefault) ?? availableDomains.value[0])!.id
})
const domainChoice = computed({
  get: () => availableDomains.value.some((item) => item.id === selectedDomainId.value) ? selectedDomainId.value : fallbackDomainId.value,
  set: (id: string) => { selectedDomainId.value = id },
})
const canCreateShortLink = computed(() => canCreateWithPermissions.value && !currentUserQuery.isError?.value && !domainQuery.isError.value && availableDomains.value.length > 0)
const { canUseIntermediate, canUseConfirmation, canSubmitRedirectMode } = useRedirectModePermissions(currentUser)
const canSetExpiration = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_expiration')))
const canSetPassword = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_password')))
const canSetMaxVisits = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_max_visits')))
const canSetMetadata = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_metadata')))
const canCustomizeSlug = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:custom_slug')))
const canConfigureRedirect = computed(() => canUseIntermediate.value || canUseConfirmation.value)
const canConfigureAccess = computed(() => canConfigureRedirect.value || canSetExpiration.value || canSetPassword.value || canSetMaxVisits.value || canSetMetadata.value || canCustomizeSlug.value)
const showPermissionRequired = computed(() => hasResolvedCurrentUser.value && !canCreateWithPermissions.value)
const customSlugPreview = computed(() => {
  if (!canCustomizeSlug.value || !canCreateShortLink.value) return ''
  const slug = customSlugSchema.safeParse(customSlug.value)
  if (!slug.success) return ''
  const domain = availableDomains.value.find((item) => item.id === domainChoice.value)
    // A valid default choice always resolves a default item; assigned choices resolve by ID.
    ?? availableDomains.value.find((item) => item.isDefault)!
  const origin = domain.host.includes('://') ? domain.host : `https://${domain.host}`
  return `${origin.replace(/\/+$/, '')}/${slug.data}`
})

watch([canUseIntermediate, canUseConfirmation], () => {
  if (!canSubmitRedirectMode(redirectMode.value)) {
    redirectMode.value = 'direct'
  }
})
watch(availableDomains, (items) => {
  if (selectedDomainId.value && !items.some(({ id }) => id === selectedDomainId.value)) selectedDomainId.value = ''
})

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
      return Promise.reject(new Error('password validation failed'))
    }
    return runShortLinkMutation(
      createShortLink,
      input,
      passwordResult?.success ? { mode: 'set', value: passwordResult.data } : undefined,
      passwordRequested,
    )
  },
  /** Stores the generated link and refreshes list consumers after creation. */
  onSuccess(result) {
    toast.success(t('feedback.created'))
    createdUrl.value = result.shortLink.url
    createdSlug.value = result.shortLink.slug
    qrOpen.value = false
    resetInputFields()
    void queryClient.invalidateQueries({ queryKey: ['short-link'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-short-link'] })
  },
  /** Removes any residual plaintext password after every mutation outcome. */
  onSettled() {
    clearPasswordInput()
  },
})

const errorMessage = computed(() => {
  if (validationErrorMessage.value) {
    return validationErrorMessage.value
  }
  if (passwordErrorMessage.value) {
    return ''
  }
  return ''
})

const creationErrorMessage = computed(() => {
  const error = mutation.error.value
  if (error instanceof ApiClientError) {
    if (error.code === 200101) return t('shortLinkCreate.customSlugConflict')
    if (error.code === 200102) return t('shortLinkCreate.customSlugReserved')
  }
  return t('shortLinkCreate.failed')
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

/** Validates visible fields and builds a permission-scoped creation request. */
function submitValidatedInput(): boolean {
  customSlugError.value = ''
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
  if (canCustomizeSlug.value && customSlug.value !== '') {
    const slug = customSlugSchema.safeParse(customSlug.value)
    if (!slug.success) {
      customSlugError.value = t('shortLinkCreate.customSlugInvalid')
      advancedOpen.value = true
      return false
    }
    input.customSlug = slug.data
  }
  metadataTitleError.value = ''
  metadataTagsError.value = ''
  if (canSetMetadata.value) {
    const metadata = metadataDraftSchema.safeParse({ title: metadataTitle.value, tagsText: metadataTags.value })
    if (!metadata.success) {
      advancedOpen.value = true
      for (const issue of metadata.error.issues) {
        if (issue.path[0] === 'title') metadataTitleError.value = t('linkMetadata.titleInvalid')
        else metadataTagsError.value = t('linkMetadata.tagsInvalid')
      }
      return false
    }
    input.metadata = metadata.data
  }
  limitErrorMessage.value = ''
  if (canSetMaxVisits.value && limitEnabled.value) {
    const limit = visitLimitInputSchema.safeParse(maxVisits.value)
    if (!limit.success) {
      limitErrorMessage.value = t('visitLimit.invalid')
      return false
    }
    input.maxVisits = limit.data
  }
  if (domainChoice.value) input.domainId = domainChoice.value
  if (canSubmitRedirectMode(redirectMode.value)) {
    input.redirectMode = redirectMode.value
  }
  if (canUseIntermediate.value && redirectMode.value === 'intermediate') {
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

/** Clears both the creation form and its generated-link result. */
function resetForm() {
  resetInputFields()
  createdUrl.value = ''
  createdSlug.value = ''
  qrOpen.value = false
}

/** Clears creation inputs after a successful request while preserving the generated result. */
function resetInputFields() {
  customSlug.value = ''
  customSlugError.value = ''
  metadataTitle.value = ''
  metadataTags.value = ''
  metadataTitleError.value = ''
  metadataTagsError.value = ''
  limitEnabled.value = false
  maxVisits.value = ''
  limitErrorMessage.value = ''
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
  selectedDomainId.value = ''
}

/** Resolves the transient native password input without copying it into reactive state. */
function passwordInput() {
  const field = passwordField.value?.$el
  if (!(field instanceof globalThis.HTMLElement) || !field.matches('[data-testid="short-link-create-password-input"]')) {
    return null
  }
  return field.querySelector<globalThis.HTMLInputElement>('input')
}

/** Clears plaintext password data from the rendered input when present. */
function clearPasswordInput() {
  const input = passwordInput()
  if (input) {
    input.value = ''
  }
}

/** Copies a generated short-link URL and reports the outcome through shared notifications. */
async function copyUrl(url: string) {
  copyErrorMessage.value = ''
  try {
    const writeText = navigator.clipboard?.writeText
    if (!writeText) {
      throw new Error('clipboard unavailable')
    }
    await writeText.call(navigator.clipboard, url)
    toast.success(t('feedback.copied'))
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
  border-radius: var(--moeurl-radius-panel);
  background: var(--moeurl-surface-elevated);
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
  font-weight: 650;
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
  font-weight: 600;
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
  font-weight: 600;
}

.short-link-create-panel__slug-hint,
.short-link-create-panel__slug-preview {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}

.short-link-create-panel__slug-preview {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.short-link-create-panel__error {
  margin: 0;
  color: rgb(var(--v-theme-error));
  font-size: 0.88rem;
  font-weight: 600;
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
  border-radius: var(--moeurl-radius-control);
}

.short-link-create-panel--compact .short-link-create-panel__shell {
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

.short-link-create-panel__result {
  display: grid;
  place-items: center;
  margin: 16px auto 0;
  padding: 16px;
  width: min(560px, 100%);
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-primary)) 24%, transparent);
  border-radius: var(--moeurl-radius-panel);
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
  font-weight: 600;
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
