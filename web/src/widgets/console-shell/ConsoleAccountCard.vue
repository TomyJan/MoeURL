<template>
  <div class="console-account-card" data-testid="console-account">
    <span class="console-account-card__avatar">{{ avatarText }}</span>
    <span class="console-account-card__body">
      <strong>{{ displayName }}</strong>
      <small>{{ username }}</small>
    </span>
    <v-btn size="small" variant="text" :loading="logoutPending" @click="$emit('logout')">{{ t('nav.logout') }}</v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  displayName: string
  logoutPending?: boolean
  username: string
}>()

defineEmits<{
  logout: []
}>()

const { t } = useI18n()
const avatarText = computed(() => (props.displayName || props.username || 'M').slice(0, 1).toUpperCase())
</script>

<style scoped>
.console-account-card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-card);
  background: color-mix(in srgb, rgb(var(--v-theme-surface)) 78%, transparent);
}

.console-account-card__avatar {
  display: inline-grid;
  flex: 0 0 auto;
  width: 42px;
  height: 42px;
  place-items: center;
  border-radius: 18px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 800;
}

.console-account-card__body {
  display: grid;
  flex: 1;
  min-width: 0;
  line-height: 1.25;
}

.console-account-card__body strong,
.console-account-card__body small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.console-account-card__body small {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
