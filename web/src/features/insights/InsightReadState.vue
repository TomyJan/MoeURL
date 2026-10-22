<template>
  <v-alert v-if="denied" type="warning" variant="tonal">{{ t('insights.noAccess') }}</v-alert>
  <v-alert v-else-if="error" type="error" variant="tonal" class="insight-read-state">
    <span>{{ t('insights.loadFailed') }}</span>
    <v-btn size="small" variant="tonal" :loading="fetching" @click="$emit('retry')">{{ t('analytics.retry') }}</v-btn>
  </v-alert>
  <v-progress-linear v-else-if="pending" indeterminate :aria-label="t('insights.loading')" />
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
defineProps<{ denied: boolean; error: boolean; pending: boolean; fetching: boolean }>()
defineEmits<{ retry: [] }>()
const { t } = useI18n()
</script>
<style scoped>
.insight-read-state :deep(.v-alert__content) { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
</style>
