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

        <div v-if="canUseIntermediate" class="short-link-settings-dialog__mode">
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
              size="small"
              value="intermediate"
              :disabled="pending"
              :aria-pressed="redirectMode === 'intermediate'"
              @click="redirectMode = 'intermediate'"
            >
              {{ t('shortLinkSettings.intermediate') }}
            </v-btn>
          </v-btn-toggle>
        </div>

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
        />
        <v-alert v-if="errorMessage" type="error" variant="tonal">{{ errorMessage }}</v-alert>
      </v-card-text>
      <v-card-actions class="short-link-settings-dialog__actions">
        <v-btn variant="text" :disabled="pending" @click="close">{{ t('shortLinkSettings.cancel') }}</v-btn>
        <v-btn color="primary" :loading="pending" :disabled="pending" @click="save">
          {{ t('shortLinkSettings.save') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import type { RedirectMode, ShortLink, UpdateShortLinkInput } from '@/entities/short-link/model'
import { futureDateTimeSchema, passwordSchema, targetUrlSchema } from '@/shared/validation/shortLinkAccess'

const props = defineProps<{
  errorMessage?: string
  link: Pick<ShortLink, 'id' | 'targetUrl' | 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt' | 'passwordEnabled'>
  open: boolean
  pending: boolean
}>()

const emit = defineEmits<{
  save: [input: UpdateShortLinkInput]
  'update:open': [open: boolean]
}>()

const { t } = useI18n()
const targetUrl = ref('')
const redirectMode = ref<RedirectMode>('direct')
const intermediateDelaySeconds = ref(5)
const expirationEnabled = ref(false)
const expiresAt = ref('')
const initialExpirationInput = ref('')
const initialExpirationEnabled = ref(false)
const passwordEnabled = ref(false)
const passwordField = useTemplateRef<{ $el: globalThis.Element }>('passwordField')
const targetErrorMessage = ref('')
const expirationErrorMessage = ref('')
const passwordErrorMessage = ref('')
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const currentUser = computed(() => currentUserQuery.data.value?.user)
const canUseIntermediate = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:use_intermediate')))
const canSetExpiration = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_expiration')))
const canSetPassword = computed(() => Boolean(currentUser.value?.permissions.includes('short_link:set_password')))

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
  if (props.pending) {
    return
  }
  targetErrorMessage.value = ''
  expirationErrorMessage.value = ''
  passwordErrorMessage.value = ''

  const targetResult = targetUrlSchema.safeParse(targetUrl.value)
  if (!targetResult.success) {
    targetErrorMessage.value = t('shortLinkSettings.invalidUrl')
    return
  }

  const input: UpdateShortLinkInput = {
    id: props.link.id,
    targetUrl: targetResult.data,
  }
  if (canUseIntermediate.value) {
    input.redirectMode = redirectMode.value
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
  if (canSetPassword.value) {
    if (!passwordEnabled.value) {
      if (props.link.passwordEnabled) {
        input.password = { mode: 'never' }
      }
    } else {
      const passwordElement = passwordInput()
      if (!passwordElement) {
        passwordErrorMessage.value = t('shortLinkSettings.passwordRequired')
        return
      }
      const password = passwordElement.value
      if (!password) {
        if (!props.link.passwordEnabled) {
          passwordErrorMessage.value = t('shortLinkSettings.passwordRequired')
          return
        }
        emit('save', input)
        return
      }
      const passwordResult = passwordSchema.safeParse(password)
      if (!passwordResult.success) {
        passwordErrorMessage.value = t('shortLinkSettings.passwordInvalid')
        return
      }
      input.password = { mode: 'set', value: passwordResult.data }
    }
  }

  emit('save', input)
}

function close() {
  if (props.pending) {
    return
  }
  emit('update:open', false)
}

function handleOpenUpdate(open: boolean) {
  if (props.pending && !open) {
    return
  }
  emit('update:open', open)
}

/** Restores editable access settings from the persisted link snapshot. */
function resetFromLink(link: Pick<ShortLink, 'targetUrl' | 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt' | 'passwordEnabled'>) {
  targetUrl.value = link.targetUrl
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

function passwordInput() {
  const field = passwordField.value?.$el
  if (!field?.matches('[data-testid="short-link-password-input"]')) {
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
