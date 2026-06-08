<template>
  <header class="home-header">
    <RouterLink class="home-header__brand" to="/">
      <span class="home-header__logo">M</span>
      <span>MoeURL</span>
    </RouterLink>

    <nav class="home-header__actions">
      <PreferenceSwitcher />
      <v-btn v-if="isGuest" class="home-header__login" to="/login" variant="text">{{ t('nav.login') }}</v-btn>
      <button v-else class="home-header__account" type="button" :aria-label="displayName" @click="$emit('consoleClick')">
        <span class="home-header__avatar" aria-hidden="true">{{ avatarText }}</span>
        <span>{{ displayName }}</span>
      </button>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'

const props = defineProps<{
  displayName: string
  isGuest: boolean
}>()

defineEmits<{
  consoleClick: []
}>()

const { t } = useI18n()
const avatarText = computed(() => (props.displayName || 'M').slice(0, 1).toUpperCase())
</script>

<style scoped>
.home-header {
  position: relative;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 22px 0;
}

.home-header__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: rgb(var(--v-theme-on-background));
  font-weight: 900;
  text-decoration: none;
}

.home-header__logo,
.home-header__avatar {
  display: inline-grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 16px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 800;
}

.home-header__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 78%, transparent);
  border-radius: var(--moeurl-radius-pill);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 58%, transparent);
}

.home-header__account {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 6px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-pill);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 86%, transparent);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.home-header__login {
  border: 1px solid var(--moeurl-outline);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 86%, transparent);
  color: rgb(var(--v-theme-on-surface));
}

@media (max-width: 620px) {
  .home-header {
    width: min(100% - 20px, 1120px);
    gap: 10px;
    padding-block: 16px;
  }

  .home-header__account span:last-child {
    display: none;
  }

  .home-header__actions {
    gap: 6px;
  }
}
</style>
