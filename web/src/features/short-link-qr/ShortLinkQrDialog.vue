<template>
  <v-dialog :model-value="open" :aria-label="t('shortLinkQr.title')" max-width="440" @update:model-value="$emit('update:open', $event)">
    <v-card class="short-link-qr-dialog">
      <v-card-title>{{ t('shortLinkQr.title') }}</v-card-title>
      <v-card-text class="short-link-qr-dialog__body py-0">
        <div class="short-link-qr-dialog__presets" role="group" :aria-label="t('shortLinkQr.appearance')">
          <v-btn
            v-for="preset in qrAppearancePresets"
            :key="preset.key"
            type="button"
            :variant="selectedPreset.key === preset.key ? 'tonal' : 'outlined'"
            :aria-pressed="selectedPreset.key === preset.key"
            @click="selectedPreset = preset"
          >
            <span class="short-link-qr-dialog__swatch" :style="{ backgroundColor: preset.dark }" aria-hidden="true" />
            {{ t(preset.labelKey) }}
          </v-btn>
        </div>
        <div class="short-link-qr-dialog__presets" role="group" :aria-label="t('shortLinkQr.correction')">
          <v-btn
            v-for="level in qrCorrectionLevels"
            :key="level.key"
            type="button"
            :variant="selectedCorrection === level.key ? 'tonal' : 'outlined'"
            :aria-pressed="selectedCorrection === level.key"
            @click="selectedCorrection = level.key"
          >
            {{ t(level.labelKey) }}
          </v-btn>
        </div>
        <p class="short-link-qr-dialog__hint">{{ t('shortLinkQr.correctionHint') }}</p>
        <div class="short-link-qr-dialog__preview" aria-live="polite">
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
        <p v-if="svgGenerating" role="status">{{ t('shortLinkQr.svgGenerating') }}</p>
        <v-alert v-else-if="svgError" type="error" variant="tonal">
          {{ t('shortLinkQr.svgGenerateFailed') }}
        </v-alert>
      </v-card-text>
      <v-card-actions class="short-link-qr-dialog__actions">
        <v-menu v-model="sizeMenuOpen">
          <template #activator="{ props: menuProps }">
            <v-btn ref="sizeActivator" v-bind="menuProps" variant="text">{{ t('shortLinkQr.exportSize') }}: {{ selectedSize }} px</v-btn>
          </template>
          <v-list role="menu" :aria-label="t('shortLinkQr.exportSize')">
            <v-list-item
              v-for="width in qrExportSizes"
              :key="width"
              tag="button"
              role="menuitemradio"
              :aria-checked="selectedSize === width"
              :active="selectedSize === width"
              @click="selectSize(width)"
            >
              {{ width }} px
            </v-list-item>
          </v-list>
        </v-menu>
        <a
          v-if="dataUrl"
          class="short-link-qr-dialog__download"
          :href="dataUrl"
          :download="`moeurl-${slug}.png`"
        >
          {{ t('shortLinkQr.download') }}
        </a>
        <a
          v-if="svgDataUrl"
          class="short-link-qr-dialog__download"
          :href="svgDataUrl"
          :download="`moeurl-${slug}.svg`"
        >
          {{ t('shortLinkQr.downloadSvg') }}
        </a>
        <v-btn variant="text" @click="$emit('update:open', false)">{{ t('shortLinkQr.close') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { qrAppearancePresets } from './appearance-presets'
import { qrCorrectionLevels, type QrCorrectionLevel } from './error-correction-levels'
import { qrExportSizes, type QrExportSize } from './export-sizes'

const props = defineProps<{
  open: boolean
  slug: string
  url: string
}>()

defineEmits<{
  'update:open': [open: boolean]
}>()

const { t } = useI18n()
const selectedPreset = ref<(typeof qrAppearancePresets)[number]>(qrAppearancePresets[0])
const selectedCorrection = ref<QrCorrectionLevel>('M')
const selectedSize = ref<QrExportSize>(320)
const sizeMenuOpen = ref(false)
const sizeActivator = ref<{ $el: HTMLButtonElement }>()
const dataUrl = ref('')
const generating = ref(false)
const generationError = ref(false)
const svgDataUrl = ref('')
const svgGenerating = ref(false)
const svgError = ref(false)
let generationId = 0

/** Returns focus during this mounted selection, without a delayed focus on a later identity. */
function selectSize(width: QrExportSize) {
  selectedSize.value = width
  sizeMenuOpen.value = false
  sizeActivator.value!.$el.focus()
}

onBeforeUnmount(() => { generationId++ })

/** Prepares a separate download without delaying or invalidating the PNG. */
async function generateSvg(encoder: typeof import('qrcode'), url: string, dark: string, correction: QrCorrectionLevel, width: QrExportSize, currentGeneration: number) {
  svgGenerating.value = true
  try {
    const svg = await encoder.toString(url, {
      type: 'svg', width, margin: 4, errorCorrectionLevel: correction,
      color: { dark, light: '#FFFFFF' },
    })
    if (currentGeneration === generationId) {
      svgDataUrl.value = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    }
  } catch {
    if (currentGeneration === generationId) {
      svgError.value = true
    }
  } finally {
    if (currentGeneration === generationId) {
      svgGenerating.value = false
    }
  }
}

watch(
  () => [props.open, props.slug, props.url] as const,
  () => {
    selectedPreset.value = qrAppearancePresets[0]
    selectedCorrection.value = 'M'
    selectedSize.value = 320
    sizeMenuOpen.value = false
  },
  { flush: 'sync' },
)

watch(
  () => [props.open, props.slug, props.url, selectedPreset.value, selectedCorrection.value, selectedSize.value] as const,
  async ([open, , url, preset, correction, width]) => {
    const currentGeneration = ++generationId
    dataUrl.value = ''
    generationError.value = false
    generating.value = false
    svgDataUrl.value = ''
    svgError.value = false
    svgGenerating.value = false
    if (!open || !url) {
      return
    }

    generating.value = true
    try {
      const { default: QRCode } = await import('qrcode')
      const result = await QRCode.toDataURL(url, {
        width,
        margin: 4,
        errorCorrectionLevel: correction,
        color: { dark: preset.dark, light: '#FFFFFF' },
      })
      if (currentGeneration === generationId) {
        dataUrl.value = result
        void generateSvg(QRCode, url, preset.dark, correction, width, currentGeneration)
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
  scroll-padding-block: 8px;
}

.short-link-qr-dialog__body {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.short-link-qr-dialog__preview {
  display: grid;
  place-items: center;
  width: min(320px, 100%, 36dvh);
  aspect-ratio: 1;
}

.short-link-qr-dialog__presets {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
}

.short-link-qr-dialog__swatch {
  width: 12px;
  height: 12px;
  margin-inline-end: 8px;
  border-radius: 50%;
}

.short-link-qr-dialog__hint {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.short-link-qr-dialog__preview img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  background: #fff;
}

@media (max-width: 600px) {
  .short-link-qr-dialog__body {
    gap: 6px;
  }

  .short-link-qr-dialog__preview {
    width: min(320px, 100%, 26dvh);
  }
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
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 24px 16px;
}

.short-link-qr-dialog__download {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  text-decoration: none;
}

.short-link-qr-dialog__download:hover {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent);
}
</style>
