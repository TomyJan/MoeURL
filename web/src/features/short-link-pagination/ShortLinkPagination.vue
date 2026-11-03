<template>
  <nav class="short-link-pagination" :aria-label="t('pagination.label')" :aria-busy="pending">
    <span v-if="total !== undefined" data-testid="short-link-pagination-summary" aria-live="polite">{{ t('pagination.summary', { page, pages: Math.max(1, Math.ceil(total / 20)), total }) }}</span>
    <div class="short-link-pagination__actions">
      <v-btn variant="text" :aria-label="t('pagination.previous')" :disabled="blocked || page <= 1" @click="$emit('change', page - 1)">{{ t('pagination.previous') }}</v-btn>
      <v-btn v-if="failed" variant="tonal" :aria-label="t('pagination.retry')" :disabled="blocked || pending" @click="$emit('retry')">{{ t('pagination.retry') }}</v-btn>
      <v-btn variant="text" :aria-label="t('pagination.next')" :disabled="blocked || pending || total === undefined || page * 20 >= total" @click="$emit('change', page + 1)">{{ t('pagination.next') }}</v-btn>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ page: number; total?: number; pending: boolean; blocked: boolean; failed: boolean }>()
defineEmits<{ change: [page: number]; retry: [] }>()
const { t } = useI18n()
</script>

<style scoped>
.short-link-pagination { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 12px; font-size: 0.875rem; }
.short-link-pagination__actions { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
