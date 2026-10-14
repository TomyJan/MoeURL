<template>
  <div class="console-account-card" data-testid="console-account">
    <span class="console-account-card__avatar">{{ avatarText }}</span>
    <span class="console-account-card__body">
      <strong>{{ displayName }}</strong>
      <small>{{ username }}</small>
    </span>
    <div class="console-account-card__actions">
      <v-btn size="small" variant="text" to="/profile">{{ t('nav.profile') }}</v-btn>
      <v-btn size="small" variant="text" :loading="logoutPending" @click="$emit('logout')">{{ t('nav.logout') }}</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { useAvatarText } from '@/shared/user/useAvatarText'

const props = defineProps<{
  displayName: string
  logoutPending?: boolean
  username: string
}>()

defineEmits<{
  logout: []
}>()

const { t } = useI18n()
const avatarText = useAvatarText(toRef(props, 'displayName'))
</script>

<style scoped>
.console-account-card {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding-top: 16px;
  border-top: 1px solid var(--moeurl-outline);
}

.console-account-card__avatar {
  display: inline-grid;
  flex: 0 0 auto;
  width: 34px;
  height: 34px;
  place-items: center;
  border-radius: 18px;
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 18%, transparent);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
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

.console-account-card__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: space-between;
}

.console-account-card__actions > .v-btn {
  min-width: 0;
}
</style>
