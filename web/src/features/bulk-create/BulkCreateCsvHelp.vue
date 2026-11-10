<template>
  <details class="bulk-csv-help" data-testid="bulk-create-csv-help">
    <summary>{{ t('bulkCreate.csvFormatTitle') }}</summary>
    <div class="bulk-csv-help__content">
      <p>{{ t('bulkCreate.csvFormatRules') }}</p>
      <pre><code data-testid="bulk-create-csv-example">{{ bulkCreateCsvExample }}</code></pre>
      <p>{{ t('bulkCreate.csvReplaceExamples') }}</p>
      <v-btn variant="tonal" @click="downloadTemplate('targets')">{{ t('bulkCreate.csvDownload') }}</v-btn>
      <pre><code data-testid="bulk-create-csv-titles-example">{{ bulkCreateTitlesCsvExample }}</code></pre>
      <v-btn variant="tonal" @click="downloadTemplate('titles')">{{ t('bulkCreate.csvTitlesDownload') }}</v-btn>
      <p>{{ t('bulkCreate.csvTagsRules') }}</p>
      <pre><code data-testid="bulk-create-csv-metadata-example">{{ bulkCreateMetadataCsvExample }}</code></pre>
      <v-btn variant="tonal" @click="downloadTemplate('metadata')">{{ t('bulkCreate.csvMetadataDownload') }}</v-btn>
      <p>{{ t('bulkCreate.csvCustomSlugsRules') }}</p>
      <pre><code data-testid="bulk-create-csv-custom-slugs-example">{{ bulkCreateCustomSlugsCsvExample }}</code></pre>
      <v-btn variant="tonal" @click="downloadTemplate('custom-slugs')">{{ t('bulkCreate.csvCustomSlugsDownload') }}</v-btn>
      <p v-if="feedback" role="status" data-testid="bulk-create-csv-feedback">{{ t(feedback) }}</p>
    </div>
  </details>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { downloadCsv } from '@/shared/download/csv'
import { bulkCreateCsvExample, bulkCreateCsvTemplate, bulkCreateTitlesCsvExample, bulkCreateTitlesCsvTemplate, bulkCreateMetadataCsvExample, bulkCreateMetadataCsvTemplate, bulkCreateCustomSlugsCsvExample, bulkCreateCustomSlugsCsvTemplate } from './csvTemplate'

const { t } = useI18n()
const feedback = ref('')
/** Downloads only the public template; import and submission state remain owned by the parent. */
function downloadTemplate(mode: 'targets' | 'titles' | 'metadata' | 'custom-slugs') {
  feedback.value = ''
  try {
    downloadCsv(mode === 'custom-slugs' ? bulkCreateCustomSlugsCsvTemplate : mode === 'metadata' ? bulkCreateMetadataCsvTemplate : mode === 'titles' ? bulkCreateTitlesCsvTemplate : bulkCreateCsvTemplate)
    feedback.value = 'bulkCreate.csvDownloadStarted'
  } catch {
    feedback.value = 'bulkCreate.csvDownloadFailed'
  }
}
</script>
<style scoped>
.bulk-csv-help { min-width: 0; }
.bulk-csv-help summary { cursor: pointer; padding-block: 12px; }
.bulk-csv-help__content { display: grid; gap: 12px; padding-block: 4px 12px; }
.bulk-csv-help__content p { margin: 0; }
.bulk-csv-help pre { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; user-select: text; }
.bulk-csv-help :deep(.v-btn) { justify-self: start; max-width: 100%; }
</style>
