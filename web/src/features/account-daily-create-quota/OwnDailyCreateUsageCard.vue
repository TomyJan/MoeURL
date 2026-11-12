<template>
  <section v-if="visible" class="own-usage console-data-panel" aria-labelledby="own-usage-title">
    <header class="own-usage__header">
      <h2 id="own-usage-title">{{ t('ownDailyCreateUsage.heading') }}</h2>
      <v-btn v-if="state === 'success'" variant="tonal" size="small" @click="refresh">{{ t('ownDailyCreateUsage.refresh') }}</v-btn>
    </header>
    <div v-if="state === 'loading' || state === 'recovering'" data-testid="own-usage-loading" role="status">
      <v-progress-linear indeterminate />
      <p>{{ t('ownDailyCreateUsage.loading') }}</p>
    </div>
    <v-alert v-else-if="state === 'error'" data-testid="own-usage-error" type="error" variant="tonal">
      <p>{{ t('ownDailyCreateUsage.failed') }}</p>
      <v-btn variant="tonal" @click="refresh">{{ t('ownDailyCreateUsage.retry') }}</v-btn>
    </v-alert>
    <v-alert v-else-if="state === 'denied'" data-testid="own-usage-denied" type="warning" variant="tonal">
      <p>{{ t('ownDailyCreateUsage.denied') }}</p>
      <v-btn variant="tonal" @click="recover">{{ t('ownDailyCreateUsage.recover') }}</v-btn>
    </v-alert>
    <template v-else-if="data">
      <p>{{ t('ownDailyCreateUsage.day') }} <time :datetime="data.usageDay">{{ data.usageDay }}</time>（UTC）</p>
      <dl class="own-usage__values">
        <div><dt>{{ t('ownDailyCreateUsage.used') }}</dt><dd data-testid="own-usage-used">{{ data.used }}</dd></div>
        <div><dt>{{ t('ownDailyCreateUsage.limit') }}</dt><dd data-testid="own-usage-limit">{{ data.dailyLimit ?? t('ownDailyCreateUsage.unlimited') }}</dd></div>
        <div><dt>{{ t('ownDailyCreateUsage.remaining') }}</dt><dd data-testid="own-usage-remaining">{{ data.remaining ?? t('ownDailyCreateUsage.unlimited') }}</dd></div>
      </dl>
      <p class="own-usage__hint">{{ t('ownDailyCreateUsage.snapshot') }}</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useOwnDailyCreateUsage } from './useOwnDailyCreateUsage'

const { t } = useI18n()
const { data, state, visible, refresh, recover } = useOwnDailyCreateUsage()
</script>
<style scoped>
.own-usage { min-width: 0; }
.own-usage__header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
.own-usage h2 { margin: 0; font-size: 1.15rem; }
.own-usage__values { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 20px 0; }
.own-usage__values div { min-width: 0; }
.own-usage dt, .own-usage__hint { color: rgb(var(--v-theme-on-surface-variant)); }
.own-usage dd { margin: 8px 0 0; font-size: 1.4rem; font-weight: 600; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.own-usage p { line-height: 1.6; }
@media (max-width: 620px) { .own-usage__values { grid-template-columns: 1fr; gap: 16px; } }
</style>
