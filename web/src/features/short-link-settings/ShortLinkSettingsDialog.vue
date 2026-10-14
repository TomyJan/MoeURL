<template>
  <v-dialog :model-value="open" :persistent="pending" max-width="640" @update:model-value="handleOpenUpdate">
    <v-card class="short-link-settings-dialog">
      <v-card-title>{{ t('shortLinkSettings.title') }}</v-card-title>
      <v-card-text class="short-link-settings-dialog__body">
        <v-text-field
          v-model="targetUrl"
          :disabled="pending"
          :error-messages="targetErrorMessage"
          :label="t('shortLinkSettings.targetUrl')"
          variant="outlined"
        />

        <div v-if="canConfigureRedirect" class="short-link-settings-dialog__mode">
          <span>{{ t('shortLinkSettings.redirectMode') }}</span>
          <v-btn-toggle :model-value="redirectMode" mandatory divided :aria-label="t('shortLinkSettings.redirectMode')">
            <v-btn
              size="small"
              value="direct"
              :disabled="pending"
              :aria-pressed="redirectMode === 'direct'"
              @click="redirectMode = 'direct'"
            >
              {{ t('shortLinkSettings.direct') }}
            </v-btn>
            <v-btn
              v-if="canUseIntermediate || redirectMode === 'intermediate'"
              size="small"
              value="intermediate"
              :disabled="pending || !canUseIntermediate"
              :aria-pressed="redirectMode === 'intermediate'"
              @click="redirectMode = 'intermediate'"
            >
              {{ t('shortLinkSettings.intermediate') }}
            </v-btn>
            <v-btn
              v-if="canUseConfirmation || redirectMode === 'confirmation'"
              size="small"
              value="confirmation"
              :disabled="pending || !canUseConfirmation"
              :aria-pressed="redirectMode === 'confirmation'"
              @click="redirectMode = 'confirmation'"
            >
              {{ t('shortLinkSettings.confirmation') }}
            </v-btn>
          </v-btn-toggle>
        </div>

        <template v-if="canSetMetadata">
          <v-text-field v-model="metadataTitle" :label="t('linkMetadata.title')" :error-messages="metadataTitleError" :disabled="pending" variant="outlined" />
          <v-textarea v-model="metadataTags" :label="t('linkMetadata.tags')" :error-messages="metadataTagsError" :disabled="pending" rows="3" variant="outlined" />
        </template>

        <v-slider
          v-if="canUseIntermediate && redirectMode === 'intermediate'"
          v-model="intermediateDelaySeconds"
          :disabled="pending"
          :label="t('shortLinkSettings.intermediateDelay')"
          :min="3"
          :max="10"
          :step="1"
          show-ticks="always"
          thumb-label
        />

        <v-switch
          v-if="canSetExpiration"
          v-model="expirationEnabled"
          color="primary"
          density="comfortable"
          hide-details
          :disabled="pending"
          :label="t('shortLinkSettings.expirationEnabled')"
        />
        <v-text-field
          v-if="canSetExpiration && expirationEnabled"
          v-model="expiresAt"
          type="datetime-local"
          variant="outlined"
          :disabled="pending"
          :error-messages="expirationErrorMessage"
          :label="t('shortLinkSettings.expiresAt')"
        />
        <v-switch
          v-if="canSetPassword"
          v-model="passwordEnabled"
          color="primary"
          density="comfortable"
          hide-details
          :disabled="pending"
          :label="t('shortLinkSettings.passwordEnabled')"
        />
        <v-text-field
          v-if="canSetPassword && passwordEnabled"
          ref="passwordField"
          data-testid="short-link-password-input"
          type="password"
          autocomplete="new-password"
          variant="outlined"
          :disabled="pending"
          :error-messages="passwordErrorMessage"
          :label="t('shortLinkSettings.password')"
          @input="clearPasswordError"
          @update:model-value="clearPasswordError"
        />
        <p v-if="link.maxVisits !== null">{{ t('visitLimit.usage', { used: link.visitsUsed, maximum: link.maxVisits, remaining: link.visitsRemaining }) }}</p>
        <p v-if="link.exhausted">{{ t('visitLimit.exhausted') }}</p>
        <v-switch
          v-if="canSetMaxVisits"
          v-model="limitEnabled"
          :label="t('visitLimit.enabled')"
          :disabled="pending"
          color="primary"
          hide-details
        />
        <v-text-field
          v-if="canSetMaxVisits && limitEnabled"
          v-model="maxVisits"
          :label="t('visitLimit.maximum')"
          :error-messages="limitErrorMessage"
          :disabled="pending"
          inputmode="numeric"
          variant="outlined"
        />
        <p v-if="canSetMaxVisits && limitEnabled">{{ t('visitLimit.hint') }}</p>
        <v-alert v-if="canSetMaxVisits && lowerLimitExhausts" type="warning" variant="tonal">{{ t('visitLimit.lowerWarning') }}</v-alert>
        <v-alert v-if="canSetMaxVisits && initialMaxVisits !== null && !limitEnabled" type="warning" variant="tonal">{{ t('visitLimit.clearWarning') }}</v-alert>
        <ActionToast v-if="errorMessage" type="error">{{ errorMessage }}</ActionToast>
      </v-card-text>
      <v-card-actions class="short-link-settings-dialog__actions">
        <v-btn variant="text" :disabled="pending" @click="close">{{ t('shortLinkSettings.cancel') }}</v-btn>
        <v-btn color="primary" :loading="pending" :disabled="pending || !permissionsReady" @click="save">
          {{ t('shortLinkSettings.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import type { RedirectMode, ShortLink, UpdateShortLinkInput } from '@/entities/short-link/model'
import { visitLimitInputSchema } from '@/entities/short-link/schema'
import { useRedirectModePermissions } from '@/shared/short-link/useRedirectModePermissions'
import { futureDateTimeSchema, passwordSchema, targetUrlSchema } from '@/shared/validation/shortLinkAccess'
import { metadataDraftSchema } from '@/shared/validation/shortLinkMetadata'

const props = defineProps<{
  errorMessage?: string
  link: Pick<ShortLink, 'id' | 'targetUrl' | 'title' | 'tags' | 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt' | 'passwordEnabled' | 'maxVisits' | 'visitsUsed' | 'visitsRemaining' | 'exhausted'>
  open: boolean
  pending: boolean
}>()

const emit = defineEmits<{
  save: [input: UpdateShortLinkInput]
  'update:open': [open: boolean]
}>()

const { t } = useI18n()
const targetUrl = ref('')
const initialTargetUrl = ref('')
const metadataTitle = ref('')
const metadataTags = ref('')
const initialMetadataTitle = ref('')
const initialMetadataTags = ref('')
const metadataTitleError = ref('')
const metadataTagsError = ref('')
const redirectMode = ref<RedirectMode>('direct')
const intermediateDelaySeconds = ref(5)
const expirationEnabled = ref(false)
const expiresAt = ref('')
const initialExpirationInput = ref('')
const initialExpirationEnabled = ref(false)
const passwordEnabled = ref(false)
const limitEnabled = ref(false)
const maxVisits = ref('')
const initialMaxVisits = ref<number | null>(null)
const limitErrorMessage = ref('')
const lowerLimitExhausts = computed(() => {
  const result = visitLimitInputSchema.safeParse(maxVisits.value)
  return limitEnabled.value && result.success && result.data !== initialMaxVisits.value && result.data <= props.link.visitsUsed
})
const passwordField = useTemplateRef<{ $el: globalThis.Element }>('passwordField')
const targetErrorMessage = ref('')
const expirationErrorMessage = ref('')
const passwordErrorMessage = ref('')
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const currentUser = computed(() => currentUserQuery.data.value?.user)
const permissionsReady = computed(() => currentUserQuery.data.value !== undefined && !currentUserQuery.isError?.value)
const { canUseIntermediate, canUseConfirmation, canSubmitRedirectMode } = useRedirectModePermissions(currentUser)
const canSetExpiration = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_expiration')))
const canSetPassword = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_password')))
const canSetMaxVisits = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_max_visits')))
const canSetMetadata = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_metadata')))
const canConfigureRedirect = computed(() =>
  canUseIntermediate.value || canUseConfirmation.value || props.link.redirectMode !== 'direct',
)

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetFromLink(props.link)
    }
  },
  { immediate: true },
)

watch(
  [() => props.pending, () => props.open],
  ([pending, open], [wasPending, wasOpen]) => {
    if ((wasPending && !pending) || (wasOpen && !open)) {
      clearPasswordInput()
    }
  },
)

/** Validates editable fields and emits the permitted access-setting changes. */
function save() {
  if (props.pending || !permissionsReady.value) {
    return
  }
  targetErrorMessage.value = ''
  expirationErrorMessage.value = ''
  passwordErrorMessage.value = ''

  const input: UpdateShortLinkInput = { id: props.link.id }
  metadataTitleError.value = ''
  metadataTagsError.value = ''
  if (canSetMetadata.value && (metadataTitle.value !== initialMetadataTitle.value || metadataTags.value !== initialMetadataTags.value)) {
    const metadata = metadataDraftSchema.safeParse({ title: metadataTitle.value, tagsText: metadataTags.value })
    if (!metadata.success) {
      for (const issue of metadata.error.issues) {
        if (issue.path[0] === 'title') metadataTitleError.value = t('linkMetadata.titleInvalid')
        else metadataTagsError.value = t('linkMetadata.tagsInvalid')
      }
      return
    }
    input.metadata = metadata.data
  }
  if (targetUrl.value !== initialTargetUrl.value) {
    const targetResult = targetUrlSchema.safeParse(targetUrl.value)
    if (!targetResult.success) {
      targetErrorMessage.value = t('shortLinkSettings.invalidUrl')
      return
    }
    input.targetUrl = targetResult.data
  }
  if (canSubmitRedirectMode(redirectMode.value, canConfigureRedirect.value)) {
    input.redirectMode = redirectMode.value
  }
  if (canUseIntermediate.value && redirectMode.value === 'intermediate') {
    input.intermediateDelaySeconds = intermediateDelaySeconds.value
  }
  if (canSetExpiration.value) {
    if (!expirationEnabled.value) {
      input.expiration = { mode: 'never' }
    } else {
      const expirationWasEdited =
        expiresAt.value !== initialExpirationInput.value || expirationEnabled.value !== initialExpirationEnabled.value
      if (expirationWasEdited) {
        const expirationResult = futureDateTimeSchema.safeParse(expiresAt.value)
        if (!expirationResult.success) {
          expirationErrorMessage.value = expiresAt.value.trim()
            ? t('shortLinkSettings.expirationFuture')
            : t('shortLinkSettings.expirationRequired')
          return
        }
        input.expiration = { mode: 'at', expiresAt: new Date(expirationResult.data).toISOString() }
      }
    }
  }
  if (!applyPasswordInput(input)) {
    return
  }

  limitErrorMessage.value = ''
  if (canSetMaxVisits.value) {
    if (limitEnabled.value) {
      const limit = visitLimitInputSchema.safeParse(maxVisits.value)
      if (!limit.success) {
        limitErrorMessage.value = t('visitLimit.invalid')
        return
      }
      if (limit.data !== initialMaxVisits.value) input.visitLimit = { mode: 'limited', maxVisits: limit.data }
    } else if (initialMaxVisits.value !== null) {
      input.visitLimit = { mode: 'unlimited' }
    }
  }

  emit('save', input)
  clearPasswordInput()
}

/** Applies an explicit password change without retaining plaintext in component state. */
function applyPasswordInput(input: UpdateShortLinkInput): boolean {
  if (!canSetPassword.value) {
    return true
  }
  if (!passwordEnabled.value) {
    if (props.link.passwordEnabled) {
      input.password = { mode: 'never' }
    }
    return true
  }

  const passwordElement = passwordInput()
  if (!passwordElement) {
    passwordErrorMessage.value = t('shortLinkSettings.passwordRequired')
    return false
  }
  const password = passwordElement.value
  if (!password) {
    if (props.link.passwordEnabled) {
      return true
    }
    passwordErrorMessage.value = t('shortLinkSettings.passwordRequired')
    return false
  }
  const passwordResult = passwordSchema.safeParse(password)
  if (!passwordResult.success) {
    passwordErrorMessage.value = t('shortLinkSettings.passwordInvalid')
    return false
  }
  input.password = { mode: 'set', value: passwordResult.data }
  return true
}

/** Closes the dialog unless an update is still pending. */
function close() {
  if (props.pending) {
    return
  }
  emit('update:open', false)
}

/** Applies external dialog state changes while protecting an in-flight save. */
function handleOpenUpdate(open: boolean) {
  if (props.pending && !open) {
    return
  }
  emit('update:open', open)
}

/** Restores editable access settings from the persisted link snapshot. */
function resetFromLink(link: typeof props.link) {
  metadataTitle.value = link.title
  metadataTags.value = link.tags.join('\n')
  initialMetadataTitle.value = metadataTitle.value
  initialMetadataTags.value = metadataTags.value
  metadataTitleError.value = ''
  metadataTagsError.value = ''
  initialMaxVisits.value = link.maxVisits
  limitEnabled.value = link.maxVisits !== null
  maxVisits.value = link.maxVisits === null ? '' : String(link.maxVisits)
  limitErrorMessage.value = ''
  targetUrl.value = link.targetUrl
  initialTargetUrl.value = link.targetUrl
  redirectMode.value = link.redirectMode
  intermediateDelaySeconds.value = link.intermediateDelaySeconds
  expirationEnabled.value = link.expiresAt !== null
  expiresAt.value = toLocalDateTime(link.expiresAt)
  initialExpirationInput.value = expiresAt.value
  initialExpirationEnabled.value = expirationEnabled.value
  passwordEnabled.value = link.passwordEnabled === true
  targetErrorMessage.value = ''
  expirationErrorMessage.value = ''
  passwordErrorMessage.value = ''
  void nextTick(clearPasswordInput)
}

/** Resolves the transient native password input without copying it into reactive state. */
function passwordInput() {
  const field = passwordField.value?.$el
  if (!(field instanceof globalThis.HTMLElement) || !field.matches('[data-testid="short-link-password-input"]')) {
    return null
  }
  return field.querySelector<globalThis.HTMLInputElement>('input')
}

/** Clears plaintext password data from the rendered input when present. */
function clearPasswordInput() {
  const input = passwordInput()
  if (input) {
    input.value = ''
    input.dispatchEvent(new globalThis.Event('input', { bubbles: true }))
  }
}

/** Clears stale password validation feedback after the password controls change. */
function clearPasswordError() {
  passwordErrorMessage.value = ''
}

/** Converts an ISO timestamp to the local value expected by datetime-local inputs. */
function toLocalDateTime(value: string | null) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}
</script>

<style scoped>
.short-link-settings-dialog {
  border-radius: 8px;
}

.short-link-settings-dialog__body {
  display: grid;
  gap: 14px;
}

.short-link-settings-dialog__mode {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.88rem;
  font-weight: 760;
}

.short-link-settings-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px 20px;
}

@media (max-width: 480px) {
  .short-link-settings-dialog__mode {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
