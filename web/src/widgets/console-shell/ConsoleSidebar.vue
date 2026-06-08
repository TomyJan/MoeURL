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

      <RouterLink class="console-sidebar__home" data-testid="console-sidebar-home" to="/">
        <span class="console-sidebar__home-mark" aria-hidden="true">↗</span>
        <span>{{ t('console.backHome') }}</span>
      </RouterLink>
    </div>

    <nav class="console-sidebar__nav">
      <section v-for="group in navGroups" :key="group.labelKey" class="console-sidebar__nav-group">
        <p class="console-sidebar__nav-label">{{ t(group.labelKey) }}</p>
        <template v-for="item in group.items" :key="item.to || item.labelKey">
          <v-btn
            v-if="item.to"
            :to="item.to"
            class="console-sidebar__nav-item"
            :class="{ 'console-sidebar__nav-item--child': item.level === 2 }"
            variant="text"
          >
            {{ t(item.labelKey) }}
          </v-btn>
          <div v-else class="console-sidebar__nav-subgroup">
            <p>
              <span class="console-sidebar__nav-caret" aria-hidden="true" />
              {{ t(item.labelKey) }}
            </p>
            <v-btn
              v-for="child in item.children"
              :key="child.to"
              :to="child.to"
              class="console-sidebar__nav-item console-sidebar__nav-item--child"
              variant="text"
            >
              {{ t(child.labelKey) }}
            </v-btn>
          </div>
        </template>
      </section>
    </nav>

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
  Navigation is intentionally grouped here instead of using a flat router list.
  It mirrors the v0.0.3 product IA: workspace first, management second, then
  nested management subjects.
-->
<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

import PreferenceSwitcher from '@/shared/preferences/PreferenceSwitcher.vue'
import ConsoleAccountCard from './ConsoleAccountCard.vue'

export interface ConsoleNavItem {
  children?: ConsoleNavItem[]
  labelKey: string
  level?: 1 | 2
  to?: string
}

export interface ConsoleNavGroup {
  items: ConsoleNavItem[]
  labelKey: string
}

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
  grid-template-rows: auto auto 1fr auto auto;
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
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 28px;
  background: color-mix(in srgb, var(--moeurl-surface-soft) 82%, var(--moeurl-surface-elevated) 18%);
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
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 20px;
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
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 4px 2px;
}

.console-sidebar__nav-group,
.console-sidebar__nav-subgroup {
  display: grid;
  gap: 4px;
}

.console-sidebar__nav-label,
.console-sidebar__nav-subgroup p {
  margin: 0;
  padding: 0 10px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.71rem;
  font-weight: 900;
  text-transform: uppercase;
}

.console-sidebar__nav-subgroup {
  position: relative;
  margin: 4px 0 0;
  padding: 3px 0 3px 12px;
  background: transparent;
}

.console-sidebar__nav-subgroup::before {
  position: absolute;
  top: 10px;
  bottom: 10px;
  left: 7px;
  width: 1px;
  border-radius: 999px;
  background: var(--moeurl-outline-strong);
  content: "";
}

.console-sidebar__nav-subgroup p {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 26px;
  padding-left: 12px;
  text-transform: none;
}

.console-sidebar__nav-caret {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentcolor;
  border-bottom: 1.5px solid currentcolor;
  transform: rotate(45deg) translateY(-1px);
}

.console-sidebar__nav-item {
  justify-content: flex-start;
  min-height: 38px;
  border-radius: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 760;
}

.console-sidebar__nav-item::before {
  width: 3px;
  height: 16px;
  margin-inline-end: 6px;
  border-radius: 999px;
  background: transparent;
  content: "";
}

.console-sidebar__nav-item--child {
  min-height: 34px;
  margin-left: 8px;
  padding-inline-start: 6px;
  font-size: 0.9rem;
}

.console-sidebar__nav-item.router-link-active,
.console-sidebar__nav-item[aria-current="page"] {
  background: color-mix(in srgb, var(--moeurl-surface-strong) 48%, transparent);
  color: rgb(var(--v-theme-primary));
  font-weight: 860;
}

.console-sidebar__nav-item.router-link-active::before,
.console-sidebar__nav-item[aria-current="page"]::before {
  background: rgb(var(--v-theme-secondary));
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
