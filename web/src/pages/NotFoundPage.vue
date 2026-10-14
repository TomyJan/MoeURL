<template>
  <main class="not-found-page">
    <section class="not-found-page__content">
      <span class="not-found-page__code" aria-hidden="true">404</span>
      <h1>{{ t('page.notFound') }}</h1>
    </section>
  </main>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.not-found-page {
  display: grid;
  flex: 1;
  min-height: 0;
  place-items: center;
  padding: 64px 24px;
  background: rgb(var(--v-theme-background));
}

.not-found-page__content {
  width: min(480px, 100%);
  padding: 48px 24px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 24px;
  background: var(--moeurl-surface-elevated);
  text-align: center;
}

.not-found-page__code {
  color: rgb(var(--v-theme-primary));
  font-size: clamp(3.5rem, 10vw, 5rem);
  font-weight: 550;
  letter-spacing: -0.05em;
  line-height: 1;
}

.not-found-page h1 {
  margin: 24px 0 0;
  color: rgb(var(--v-theme-on-background));
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.4;
}
</style>
