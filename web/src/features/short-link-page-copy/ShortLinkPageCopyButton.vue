<template>
  <div v-if="state.visible.value" class="page-links-copy">
    <v-btn data-testid="short-link-page-copy" variant="tonal" :disabled="state.disabled.value" :loading="state.pending.value" @click="state.copy">
      {{ t('pageLinksCopy.action') }}
    </v-btn>
    <p>{{ t('pageLinksCopy.description') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { PageLinksCopyState } from './usePageLinksCopy'
defineProps<{ state: PageLinksCopyState }>()
const { t } = useI18n()
</script>

<style scoped>
.page-links-copy { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; min-width: 0; max-width: 100%; }
.page-links-copy p { margin: 0; max-width: 260px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.8125rem; text-align: right; }
@media (max-width: 760px) {
  .page-links-copy { align-items: flex-start; }
  .page-links-copy p { text-align: left; }
}
</style>
