<template>
  <aside class="console-sidebar">
    <RouterLink class="console-sidebar__brand" to="/">
      <span class="console-sidebar__logo">M</span>
      <span class="console-sidebar__brand-text">
        <strong>MoeURL</strong>
        <small>short links</small>
      </span>
    </RouterLink>

    <div class="console-sidebar__quick">
      <v-btn class="console-sidebar__action" color="primary" variant="flat" @click="$emit('createShortLink')">
        <span aria-hidden="true">+</span>
        {{ t('console.newShortLink') }}
      </v-btn>
    </div>

    <ConsoleNavList class="console-sidebar__nav" :nav-groups="navGroups" />

    <RouterLink class="console-sidebar__home" data-testid="console-sidebar-home" to="/">
      <span class="console-sidebar__home-mark" aria-hidden="true">↗</span>
      <span>{{ t('console.backHome') }}</span>
    </RouterLink>

    <PreferenceSwitcher class="console-sidebar__preferences" density="compact" placement="sidebar" />

    <ConsoleAccountCard
      class="console-sidebar__account"
      :display-name="displayName"
      :logout-pending="logoutPending"
      :username="username"
      @logout="$emit('logout')"
    />
  </aside>
</template>

<!--
  Navigation is intentionally grouped instead of using a flat router list.
  It mirrors the v0.0.3 product IA: workspace first, management second, then
  nested management subjects.
-->
<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'
import ConsoleAccountCard from './ConsoleAccountCard.vue'
import ConsoleNavList from './ConsoleNavList.vue'
import type { ConsoleNavGroup } from './ConsoleNavList.vue'

defineProps<{
  displayName: string
  logoutPending?: boolean
  navGroups: ConsoleNavGroup[]
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
  top: 20px;
  display: grid;
  min-height: calc(100vh - 40px);
  grid-template-rows: auto auto 1fr auto auto auto;
  gap: 16px;
  padding: 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-page);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 96%, var(--moeurl-surface-soft) 4%);
  box-shadow: 0 18px 42px color-mix(in srgb, rgb(var(--v-theme-primary)) 3%, transparent);
}

.console-sidebar__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
}

.console-sidebar__brand-text {
  display: grid;
  line-height: 1.1;
}

.console-sidebar__brand-text strong {
  font-weight: 950;
}

.console-sidebar__brand-text small {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
  font-weight: 700;
}

.console-sidebar__logo {
  display: inline-grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 17px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, var(--moeurl-surface-strong));
  color: rgb(var(--v-theme-primary));
  font-weight: 900;
}

.console-sidebar__quick {
  display: grid;
  padding: 0;
  background: transparent;
}

.console-sidebar__action {
  width: 100%;
  min-height: 44px;
  border-radius: var(--moeurl-radius-pill);
  box-shadow: 0 12px 24px color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  font-weight: 850;
}

.console-sidebar__action :deep(.v-btn__content) {
  gap: 8px;
}

.console-sidebar__home {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 9px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--moeurl-radius-pill);
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.84rem;
  font-weight: 850;
  text-decoration: none;
}

.console-sidebar__home:hover {
  border-color: color-mix(in srgb, rgb(var(--v-theme-secondary)) 32%, transparent);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 9%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-sidebar__home-mark {
  display: inline-grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border-radius: 10px;
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent);
  color: rgb(var(--v-theme-secondary));
}

.console-sidebar__nav {
  min-height: 0;
}

.console-sidebar__preferences {
  align-self: end;
  padding-top: 12px;
  border-top: 1px solid var(--moeurl-outline);
}

.console-sidebar__account {
  align-self: end;
}

</style>
