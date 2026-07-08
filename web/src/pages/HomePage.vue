<template>
  <div class="home-page">
    <HomeHeader :display-name="currentUserName" :is-guest="isGuest" @console-click="goConsole" />

    <main class="home-page__hero" data-testid="home-hero-panel">
      <section class="home-page__hero-content">
        <div class="home-page__copy">
          <h1>{{ t('home.heroTitle') }}</h1>
          <p class="home-page__summary">{{ t('home.heroSummary') }}</p>
        </div>
        <div class="home-page__tool">
          <ShortLinkCreatePanel mode="full" />
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
    radial-gradient(circle at 50% 12%, var(--moeurl-hero-glow), transparent 30rem),
    radial-gradient(circle at 9% 18%, color-mix(in srgb, rgb(var(--v-theme-primary)) 7%, transparent), transparent 20rem),
    linear-gradient(180deg, rgb(var(--v-theme-background)), var(--moeurl-surface-soft));
}

.home-page__hero {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: calc(100vh - 86px);
  grid-template-rows: 1fr auto;
  justify-items: center;
  padding: 12px 16px 20px;
}

.home-page__hero-content {
  position: relative;
  display: grid;
  justify-items: center;
  align-self: center;
  width: min(900px, 100%);
  padding: clamp(16px, 2.8vw, 26px);
  text-align: center;
}

.home-page__copy {
  display: grid;
  justify-items: center;
}

.home-page__hero h1 {
  max-width: 640px;
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: clamp(1.72rem, 3.2vw, 2.65rem);
  line-height: 1.1;
}

.home-page__summary {
  max-width: 520px;
  margin: 14px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: clamp(0.92rem, 1.2vw, 1.04rem);
  line-height: 1.65;
}

.home-page__tool {
  display: grid;
  gap: 12px;
  width: min(760px, 100%);
  margin-top: clamp(20px, 3vw, 28px);
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
  .home-page__hero {
    min-height: calc(100vh - 76px);
    padding-top: 18px;
  }

  .home-page__hero-content {
    padding: 8px;
  }
}
</style>
