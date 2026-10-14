<template>
  <header class="home-header">
    <RouterLink class="home-header__brand" to="/">
      <span class="home-header__logo">M</span>
      <span>{{ config.siteName }}</span>
    </RouterLink>

    <nav class="home-header__actions">
      <PreferenceSwitcher density="compact" placement="inline" />
      <v-btn v-if="isGuest" class="home-header__login" to="/login" variant="text">{{ t('nav.login') }}</v-btn>
      <button v-else class="home-header__account" type="button" :aria-label="displayName" @click="$emit('accountClick')">
        <span class="home-header__avatar" aria-hidden="true">{{ avatarText }}</span>
        <span>{{ displayName }}</span>
      </button>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'
import { useAvatarText } from '@/shared/user/useAvatarText'
import { useSiteConfig } from '@/shared/site/useSiteConfig'

const props = defineProps<{
  displayName: string
  isGuest: boolean
}>()

defineEmits<{
  accountClick: []
}>()

const { t } = useI18n()
const displayName = toRef(props, 'displayName')
const avatarText = useAvatarText(displayName)
const { config } = useSiteConfig()
</script>

<style scoped>
.home-header {
  position: relative;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  width: min(1160px, calc(100% - 64px));
  margin: 0 auto;
  padding: 26px 0;
}

.home-header__brand {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: rgb(var(--v-theme-on-background));
  font-size: 1.18rem;
  font-weight: 650;
  letter-spacing: -0.025em;
  text-decoration: none;
}

.home-header__brand span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-header__logo,
.home-header__avatar {
  display: inline-grid;
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 12px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 650;
}

.home-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 12px;
  padding: 0;
  border: 0;
  border-radius: 12px;
  background: transparent;
}

.home-header__account {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 240px;
  padding: 4px 12px 4px 4px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 12px;
  background: var(--moeurl-surface-elevated);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.home-header__account span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-header__account:hover {
  border-color: rgb(var(--v-theme-primary));
  background: var(--moeurl-surface-soft);
}

.home-header__account:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 4px;
}

.home-header__login {
  border: 1px solid var(--moeurl-outline);
  border-radius: 12px;
  background: var(--moeurl-surface-elevated);
  color: rgb(var(--v-theme-on-surface));
}

@media (max-width: 620px) {
  .home-header {
    width: calc(100% - 32px);
    gap: 10px;
    padding-block: 16px;
  }

  .home-header__account span:last-child {
    display: none;
  }

  .home-header__actions {
    gap: 6px;
  }

  .home-header__account {
    padding: 3px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .home-header__account {
    transition: none;
  }
}
</style>
