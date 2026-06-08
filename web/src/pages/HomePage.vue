<template>
  <div class="home-page">
    <HomeHeader :display-name="currentUserName" :is-guest="isGuest" @console-click="goConsole" />

    <main class="home-page__hero">
      <section class="home-page__hero-content">
        <p class="home-page__eyebrow">MoeURL</p>
        <h1>{{ t('home.heroTitle') }}</h1>
        <p class="home-page__summary">{{ t('home.heroSummary') }}</p>
        <ShortLinkCreatePanel mode="full" />
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
  min-height: 100vh;
  background:
    radial-gradient(circle at 14% 18%, rgba(240, 169, 79, 0.18), transparent 28%),
    linear-gradient(135deg, rgb(var(--v-theme-background)), var(--moeurl-surface-soft));
}

.home-page__hero {
  display: grid;
  min-height: calc(100vh - 84px);
  place-items: center;
  padding: 32px 16px 24px;
}

.home-page__hero-content {
  display: grid;
  justify-items: center;
  width: min(860px, 100%);
  text-align: center;
}

.home-page__eyebrow {
  margin: 0 0 12px;
  color: rgb(var(--v-theme-secondary));
  font-weight: 800;
}

.home-page__hero h1 {
  max-width: 760px;
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: clamp(2.4rem, 7vw, 5rem);
  line-height: 1.04;
}

.home-page__summary {
  max-width: 620px;
  margin: 18px 0 28px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 1.08rem;
  line-height: 1.7;
}

.home-page__scroll-hint {
  align-self: end;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.9rem;
}
</style>
