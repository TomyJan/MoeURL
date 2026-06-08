<template>
  <div class="home-page">
    <HomeHeader :display-name="currentUserName" :is-guest="isGuest" @console-click="goConsole" />

    <main class="home-page__hero">
      <section class="home-page__hero-panel" data-testid="home-hero-panel">
        <div class="home-page__copy">
          <p class="home-page__eyebrow">MoeURL</p>
          <h1>{{ t('home.heroTitle') }}</h1>
        </div>
        <div class="home-page__tool">
          <p class="home-page__tool-caption">{{ t('home.heroSummary') }}</p>
          <ShortLinkCreatePanel mode="full" />
        </div>
        <div class="home-page__signals" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <span class="home-page__scroll-hint">{{ t('home.scrollHint') }}</span>
    </main>

    <HomeIntroSections />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'

import { me } from '@/entities/auth/api'
import ShortLinkCreatePanel from '@/features/short-link-create/ShortLinkCreatePanel.vue'
import HomeHeader from '@/widgets/home-header/HomeHeader.vue'
import HomeIntroSections from '@/widgets/home-intro/HomeIntroSections.vue'

const { t } = useI18n()
const router = useRouter()
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const currentUser = computed(() => currentUserQuery.data.value?.user)
const currentUserName = computed(() => currentUser.value?.nickname || currentUser.value?.username || 'guest')
const isGuest = computed(() => currentUser.value?.group === 'guest' || !currentUser.value)

function goConsole() {
  void router.push('/link')
}
</script>

<style scoped>
.home-page {
  position: relative;
  overflow: hidden;
  min-height: 100vh;
  background:
    radial-gradient(circle at 50% 18%, var(--moeurl-hero-glow), transparent 30rem),
    linear-gradient(145deg, rgb(var(--v-theme-background)), var(--moeurl-surface-soft));
}

.home-page::before,
.home-page::after {
  position: absolute;
  z-index: 0;
  border: 1px solid var(--moeurl-outline);
  content: "";
  pointer-events: none;
}

.home-page::before {
  top: 118px;
  left: max(22px, calc(50% - 620px));
  width: 150px;
  height: 150px;
  border-radius: 54px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 16%, transparent);
  transform: rotate(-10deg);
}

.home-page::after {
  right: max(18px, calc(50% - 660px));
  bottom: 120px;
  width: 220px;
  height: 220px;
  border-radius: 76px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent);
  transform: rotate(12deg);
}

.home-page__hero {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: calc(100vh - 86px);
  grid-template-rows: 1fr auto;
  justify-items: center;
  padding: 34px 16px 26px;
}

.home-page__hero-panel {
  position: relative;
  display: grid;
  justify-items: center;
  align-self: center;
  width: min(880px, 100%);
  padding: clamp(20px, 3.5vw, 34px);
  border: 1px solid var(--moeurl-outline);
  border-radius: clamp(34px, 6vw, 56px);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--moeurl-surface-glass) 92%, white 8%), var(--moeurl-surface-glass)),
    var(--moeurl-surface-glass);
  box-shadow: var(--moeurl-shadow-strong);
  text-align: center;
  backdrop-filter: blur(26px);
}

.home-page__copy {
  display: grid;
  justify-items: center;
}

.home-page__eyebrow {
  margin: 0 0 12px;
  padding: 7px 14px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.82rem;
  font-weight: 900;
}

.home-page__hero h1 {
  max-width: 610px;
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: clamp(1.95rem, 4.2vw, 3.35rem);
  line-height: 1.1;
}

.home-page__summary {
  max-width: 620px;
  margin: 16px 0 22px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 1.08rem;
  line-height: 1.7;
}

.home-page__tool {
  display: grid;
  gap: 12px;
  width: min(820px, 100%);
  margin-top: clamp(18px, 3vw, 26px);
}

.home-page__tool-caption {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 1rem;
  line-height: 1.7;
}

.home-page__signals {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}

.home-page__signals span {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 72%, transparent);
}

.home-page__signals span:nth-child(2) {
  background: rgb(var(--v-theme-secondary));
}

.home-page__signals span:nth-child(3) {
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface-variant)) 42%, transparent);
}

.home-page__scroll-hint {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  align-self: end;
  margin-top: 26px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.9rem;
}

.home-page__scroll-hint::before {
  width: 26px;
  height: 1px;
  background: currentColor;
  content: "";
}

@media (max-width: 680px) {
  .home-page::before,
  .home-page::after {
    opacity: 0.45;
  }

  .home-page__hero {
    min-height: calc(100vh - 76px);
    padding-top: 18px;
  }

  .home-page__hero-panel {
    padding: 18px;
    border-radius: 34px;
  }
}
</style>
