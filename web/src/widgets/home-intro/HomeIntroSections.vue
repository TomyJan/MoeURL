<template>
  <section class="home-intro" aria-label="MoeURL introduction">
    <article v-for="item in items" :key="item.key" class="home-intro__item">
      <span class="home-intro__mark">{{ item.mark }}</span>
      <h2>{{ t(`homeIntro.${item.key}.title`) }}</h2>
      <p>{{ t(`homeIntro.${item.key}.description`) }}</p>
    </article>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const items = [
  { key: 'permission', mark: '01' },
  { key: 'selfHosted', mark: '02' },
  { key: 'management', mark: '03' },
  { key: 'modern', mark: '04' },
]
</script>

<style scoped>
.home-intro {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 18px;
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 36px 0 72px;
}

.home-intro__item {
  display: grid;
  gap: 10px;
  min-height: 180px;
  padding: 24px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-card);
  background: rgb(var(--v-theme-surface));
}

.home-intro__mark {
  color: rgb(var(--v-theme-secondary));
  font-size: 0.82rem;
  font-weight: 800;
}

.home-intro__item h2 {
  margin: 0;
  font-size: 1.08rem;
}

.home-intro__item p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.7;
}

@media (max-width: 900px) {
  .home-intro {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .home-intro {
    grid-template-columns: 1fr;
  }
}
</style>
