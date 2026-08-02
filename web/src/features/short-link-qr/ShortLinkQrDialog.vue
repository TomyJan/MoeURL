<template>
  <v-dialog :model-value="open" max-width="440" @update:model-value="$emit('update:open', $event)">
    <v-card class="short-link-qr-dialog">
      <v-card-title>{{ t('shortLinkQr.title') }}</v-card-title>
      <v-card-text class="short-link-qr-dialog__body">
        <div class="short-link-qr-dialog__preview">
          <v-progress-linear v-if="generating" indeterminate />
          <v-alert v-else-if="generationError" type="error" variant="tonal">
            {{ t('shortLinkQr.generateFailed') }}
          </v-alert>
          <img
            v-else-if="dataUrl"
            :src="dataUrl"
            :alt="t('shortLinkQr.imageAlt')"
            width="320"
            height="320"
          />
        </div>
        <p class="short-link-qr-dialog__url">{{ url }}</p>
      </v-card-text>
      <v-card-actions class="short-link-qr-dialog__actions">
        <a
          v-if="dataUrl"
          class="short-link-qr-dialog__download"
          :href="dataUrl"
          :download="`moeurl-${slug}.png`"
        >
          {{ t('shortLinkQr.download') }}
        </a>
        <v-btn variant="text" @click="$emit('update:open', false)">{{ t('shortLinkQr.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
  slug: string
  url: string
}>()

defineEmits<{
  'update:open': [open: boolean]
}>()

const { t } = useI18n()
const dataUrl = ref('')
const generating = ref(false)
const generationError = ref(false)
let generationId = 0

watch(
  () => [props.open, props.url] as const,
  async ([open, url]) => {
    const currentGeneration = ++generationId
    dataUrl.value = ''
    generationError.value = false
    generating.value = false
    if (!open || !url) {
      return
    }

    generating.value = true
    try {
      const { default: QRCode } = await import('qrcode')
      const result = await QRCode.toDataURL(url, {
        width: 320,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
      if (currentGeneration === generationId) {
        dataUrl.value = result
      }
    } catch {
      if (currentGeneration === generationId) {
        generationError.value = true
      }
    } finally {
      if (currentGeneration === generationId) {
        generating.value = false
      }
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.short-link-qr-dialog {
  border-radius: 8px;
}

.short-link-qr-dialog__body {
  display: grid;
  justify-items: center;
  gap: 14px;
}

.short-link-qr-dialog__preview {
  display: grid;
  place-items: center;
  width: min(320px, 100%);
  aspect-ratio: 1;
}

.short-link-qr-dialog__preview img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1;
}

.short-link-qr-dialog__url {
  max-width: 100%;
  margin: 0;
  overflow-wrap: anywhere;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.short-link-qr-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px 20px;
}

.short-link-qr-dialog__download {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  font-weight: 800;
  text-decoration: none;
}

.short-link-qr-dialog__download:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent);
}
</style>
