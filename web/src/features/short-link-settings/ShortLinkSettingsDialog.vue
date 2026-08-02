<template>
  <v-dialog :model-value="open" max-width="640" @update:model-value="handleOpenUpdate">
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

        <div class="short-link-settings-dialog__mode">
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
          v-if="redirectMode === 'intermediate'"
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
          v-model="expirationEnabled"
          color="primary"
          density="comfortable"
          hide-details
          :disabled="pending"
          :label="t('shortLinkSettings.expirationEnabled')"
        />
        <v-text-field
          v-if="expirationEnabled"
          v-model="expiresAt"
          type="datetime-local"
          variant="outlined"
          :disabled="pending"
          :error-messages="expirationErrorMessage"
          :label="t('shortLinkSettings.expiresAt')"
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
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'

import type { RedirectMode, ShortLink, UpdateShortLinkInput } from '@/entities/short-link/model'

const props = defineProps<{
  errorMessage?: string
  link: Pick<ShortLink, 'id' | 'targetUrl' | 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt'>
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
const targetErrorMessage = ref('')
const expirationErrorMessage = ref('')
const targetUrlSchema = z.string().trim().pipe(z.url())
const futureDateTimeSchema = z.string().trim().min(1).refine((value) => {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
})

watch(
  () => [props.open, props.link] as const,
  ([open, link]) => {
    if (open) {
      resetFromLink(link)
    }
  },
  { immediate: true },
)

function save() {
  if (props.pending) {
    return
  }
  targetErrorMessage.value = ''
  expirationErrorMessage.value = ''

  const targetResult = targetUrlSchema.safeParse(targetUrl.value)
  if (!targetResult.success) {
    targetErrorMessage.value = t('shortLinkSettings.invalidUrl')
    return
  }

  let expiration: UpdateShortLinkInput['expiration'] = { mode: 'never' }
  if (expirationEnabled.value) {
    const expirationResult = futureDateTimeSchema.safeParse(expiresAt.value)
    if (!expirationResult.success) {
      expirationErrorMessage.value = expiresAt.value.trim()
        ? t('shortLinkSettings.expirationFuture')
        : t('shortLinkSettings.expirationRequired')
      return
    }
    expiration = { mode: 'at', expiresAt: new Date(expirationResult.data).toISOString() }
  }

  emit('save', {
    id: props.link.id,
    targetUrl: targetResult.data,
    redirectMode: redirectMode.value,
    intermediateDelaySeconds: intermediateDelaySeconds.value,
    expiration,
  })
}

function close() {
  emit('update:open', false)
}

function handleOpenUpdate(open: boolean) {
  emit('update:open', open)
}

function resetFromLink(link: Pick<ShortLink, 'targetUrl' | 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt'>) {
  targetUrl.value = link.targetUrl
  redirectMode.value = link.redirectMode
  intermediateDelaySeconds.value = link.intermediateDelaySeconds
  expirationEnabled.value = link.expiresAt !== null
  expiresAt.value = toLocalDateTime(link.expiresAt)
  targetErrorMessage.value = ''
  expirationErrorMessage.value = ''
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
