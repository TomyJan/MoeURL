<template>
  <aside class="console-sidebar">
    <RouterLink class="console-sidebar__brand" to="/">
      <span class="console-sidebar__logo">M</span>
      <span>MoeURL</span>
    </RouterLink>

    <v-btn class="console-sidebar__action" color="primary" variant="flat" @click="$emit('createShortLink')">
      {{ t('console.newShortLink') }}
    </v-btn>

    <nav class="console-sidebar__nav">
      <v-btn v-for="item in navItems" :key="item.to" :to="item.to" class="console-sidebar__nav-item" variant="text">
        {{ t(item.labelKey) }}
      </v-btn>
    </nav>

    <ConsoleAccountCard
      class="console-sidebar__account"
      :display-name="displayName"
      :logout-pending="logoutPending"
      :username="username"
      @logout="$emit('logout')"
    />
  </aside>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import ConsoleAccountCard from './ConsoleAccountCard.vue'

export interface ConsoleNavItem {
  labelKey: string
  to: string
}

defineProps<{
  displayName: string
  logoutPending?: boolean
  navItems: ConsoleNavItem[]
  username: string
}>()

defineEmits<{
  createShortLink: []
  logout: []
}>()

const { t } = useI18n()
</script>

<style scoped>
.console-sidebar {
  position: sticky;
  top: 18px;
  display: grid;
  min-height: calc(100vh - 36px);
  grid-template-rows: auto auto 1fr auto;
  gap: 18px;
  padding: 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-page);
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 88%, transparent);
  box-shadow: var(--moeurl-shadow);
}

.console-sidebar__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: rgb(var(--v-theme-on-surface));
  font-weight: 900;
  text-decoration: none;
}

.console-sidebar__logo {
  display: inline-grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 16px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.console-sidebar__action {
  width: 100%;
}

.console-sidebar__nav {
  display: grid;
  align-content: start;
  gap: 8px;
}

.console-sidebar__nav-item {
  justify-content: flex-start;
}

.console-sidebar__account {
  align-self: end;
}
</style>
