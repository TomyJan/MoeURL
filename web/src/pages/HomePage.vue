<template>
  <div class="home-page">
    <HomeHeader :display-name="currentUserName" :is-guest="isGuest" @account-click="goProfile" />

    <main class="home-page__hero" data-testid="home-hero-panel">
      <section class="home-page__hero-content">
        <div class="home-page__copy">
          <h1>{{ copy?.title || t('home.heroTitle') }}</h1>
          <p class="home-page__summary">{{ copy?.summary || t('home.heroSummary') }}</p>
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
import { getPublicHomeContent, publicHomeContentKey } from '@/entities/home-content/api'
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
const contentQuery = useQuery({ queryKey: publicHomeContentKey, queryFn: getPublicHomeContent, retry: false, refetchOnMount: 'always', gcTime: 0 })
const copy = computed(() => contentQuery.isSuccess.value && !contentQuery.isFetching.value ? contentQuery.data.value : undefined)

/** Opens the signed-in user's profile page. */
function goProfile() {
  void router.push('/profile')
}
</script>

<style scoped>
.home-page {
  position: relative;
  flex: 1;
  min-height: 0;
  background:
    radial-gradient(ellipse 65% 460px at 25% 8%, var(--moeurl-hero-glow), transparent),
    radial-gradient(ellipse 50% 400px at 85% 22%, color-mix(in srgb, rgb(var(--v-theme-secondary)) 6%, transparent), transparent),
    rgb(var(--v-theme-background));
}

.home-page__hero {
  position: relative;
  z-index: 1;
  display: grid;
  min-height: min(760px, calc(100svh - 154px));
  grid-template-rows: 1fr auto;
  justify-items: center;
  padding: 42px 24px 24px;
}

.home-page__hero-content {
  position: relative;
  display: grid;
  justify-items: center;
  align-self: center;
  width: min(960px, 100%);
  padding: clamp(8px, 2vw, 24px);
  text-align: center;
}

.home-page__copy {
  display: grid;
  justify-items: center;
  min-width: 0;
  max-width: 100%;
}

.home-page__hero h1 {
  overflow-wrap: anywhere;
  max-width: 780px;
  margin: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: clamp(2.3rem, 4.8vw, 3.4rem);
  font-weight: 650;
  letter-spacing: -0.045em;
  line-height: 1.25;
  text-wrap: balance;
}

.home-page__summary {
  overflow-wrap: anywhere;
  max-width: 560px;
  margin: 20px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: clamp(0.92rem, 1.2vw, 1rem);
  line-height: 1.85;
}

.home-page__tool {
  display: grid;
  gap: 12px;
  width: min(720px, 100%);
  min-width: 0;
  margin-top: clamp(28px, 4vw, 38px);
}

.home-page__scroll-hint {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  align-self: end;
  margin-top: 32px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
}

.home-page__scroll-hint::before {
  width: 26px;
  height: 1px;
  background: currentColor;
  content: "";
}

@media (max-width: 680px) {
  .home-page__hero {
    min-height: calc(100svh - 138px);
    padding: 30px 16px 22px;
  }

  .home-page__hero-content {
    padding: 0;
  }

  .home-page__hero h1 {
    font-size: clamp(2rem, 7.6vw, 2.65rem);
  }

  .home-page__summary {
    max-width: 30rem;
    margin-top: 16px;
  }
}
</style>
