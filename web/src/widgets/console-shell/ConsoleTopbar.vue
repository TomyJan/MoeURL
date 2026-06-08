<template>
  <header class="console-topbar">
    <button class="console-topbar__menu" type="button" :aria-label="t('console.openMenu')" @click="$emit('openMenu')">
      <span />
      <span />
      <span />
    </button>
    <RouterLink class="console-topbar__brand" to="/">MoeURL</RouterLink>
    <v-btn color="primary" variant="flat" @click="$emit('createShortLink')">{{ t('console.newShortLink') }}</v-btn>
    <span class="console-topbar__avatar">{{ avatarText }}</span>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  displayName: string
}>()

defineEmits<{
  createShortLink: []
  openMenu: []
}>()

const { t } = useI18n()
const avatarText = computed(() => (props.displayName || 'M').slice(0, 1).toUpperCase())
</script>

<style scoped>
.console-topbar {
  display: none;
  align-items: center;
  gap: 10px;
  margin: 10px 10px 8px;
  padding: 10px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 28px;
  background: var(--moeurl-surface-glass);
  box-shadow: var(--moeurl-shadow);
  backdrop-filter: blur(20px);
}

.console-topbar__menu {
  display: inline-grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border: 1px solid var(--moeurl-outline);
  border-radius: 18px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 76%, transparent);
  cursor: pointer;
}

.console-topbar__menu span {
  display: block;
  width: 16px;
  height: 2px;
  border-radius: 999px;
  background: rgb(var(--v-theme-on-surface));
}

.console-topbar__brand {
  flex: 1;
  color: rgb(var(--v-theme-on-background));
  font-weight: 900;
  text-decoration: none;
}

.console-topbar__avatar {
  display: inline-grid;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 18px;
  background:
    linear-gradient(145deg, rgb(var(--v-theme-primary)), color-mix(in srgb, rgb(var(--v-theme-primary)) 76%, black 24%));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 800;
}

@media (max-width: 900px) {
  .console-topbar {
    display: flex;
  }
}
</style>
