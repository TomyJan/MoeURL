<template>
  <section class="home-intro" :aria-label="t('homeIntro.ariaLabel')">
    <div class="home-intro__heading">
      <p>{{ t('homeIntro.headingEyebrow') }}</p>
      <h2>{{ t('homeIntro.headingTitle') }}</h2>
    </div>
    <div class="home-intro__feature-band">
      <article v-for="item in primaryItems" :key="item.key" class="home-intro__feature">
        <span class="home-intro__mark">{{ item.mark }}</span>
        <div>
          <h3>{{ t(`homeIntro.${item.key}.title`) }}</h3>
          <p>{{ t(`homeIntro.${item.key}.description`) }}</p>
        </div>
      </article>
    </div>
    <div class="home-intro__grid">
      <article v-for="item in secondaryItems" :key="item.key" class="home-intro__item">
        <span class="home-intro__mark">{{ item.mark }}</span>
        <h3>{{ t(`homeIntro.${item.key}.title`) }}</h3>
        <p>{{ t(`homeIntro.${item.key}.description`) }}</p>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const primaryItems = [
  { key: 'permission', mark: '01' },
  { key: 'selfHosted', mark: '02' },
]
const secondaryItems = [
  { key: 'management', mark: '03' },
  { key: 'modern', mark: '04' },
]
</script>

<style scoped>
.home-intro {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 24px;
  width: min(1060px, calc(100% - 64px));
  margin: 0 auto;
  padding: 68px 0 72px;
  border-top: 1px solid var(--moeurl-outline);
}

.home-intro__heading {
  display: grid;
  max-width: 620px;
  gap: 12px;
  margin-bottom: 12px;
}

.home-intro__heading p {
  margin: 0;
  color: rgb(var(--v-theme-primary));
  font-size: 0.82rem;
  font-weight: 600;
}

.home-intro__heading h2 {
  margin: 0;
  font-size: clamp(1.5rem, 3vw, 2rem);
  font-weight: 650;
  letter-spacing: -0.025em;
  line-height: 1.35;
}

.home-intro__feature-band {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.home-intro__feature {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 16px;
  min-height: 168px;
  padding: clamp(22px, 3vw, 30px);
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: var(--moeurl-surface-elevated);
}

.home-intro__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.home-intro__item {
  display: grid;
  gap: 10px;
  min-height: 144px;
  padding: 20px 6px;
}

.home-intro__mark {
  display: inline-grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 9%, transparent);
  color: rgb(var(--v-theme-primary));
  font-size: 0.82rem;
  font-weight: 600;
}

.home-intro__item h3 {
  margin: 0;
  font-size: 1.08rem;
  font-weight: 600;
}

.home-intro__feature h3 {
  margin: 0;
  font-size: 1.16rem;
  font-weight: 600;
  margin-bottom: 10px;
}

.home-intro__feature p,
.home-intro__item p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.92rem;
  line-height: 1.85;
}

@media (max-width: 620px) {
  .home-intro {
    width: calc(100% - 32px);
    padding-block: 44px;
    gap: 16px;
  }

  .home-intro__feature-band,
  .home-intro__grid {
    grid-template-columns: 1fr;
  }

  .home-intro__feature {
    min-height: 0;
    padding: 22px 18px;
  }
}
</style>
