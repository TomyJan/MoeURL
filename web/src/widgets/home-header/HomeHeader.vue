<template>
  <header class="home-header">
    <RouterLink class="home-header__brand" to="/">
      <span class="home-header__logo">M</span>
      <span>MoeURL</span>
    </RouterLink>

    <nav class="home-header__actions">
      <v-btn v-if="isGuest" to="/login" variant="text">{{ t('nav.login') }}</v-btn>
      <button v-else class="home-header__account" type="button" @click="$emit('consoleClick')">
        <span class="home-header__avatar">{{ avatarText }}</span>
        <span>{{ displayName }}</span>
      </button>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

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
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
  padding: 24px 0;
}

.home-header__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: rgb(var(--v-theme-on-background));
  font-weight: 800;
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
  gap: 8px;
}

.home-header__account {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 6px 6px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-control);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}
</style>
