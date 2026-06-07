<template>
  <v-app>
    <v-app-bar border="b" elevation="0">
      <v-app-bar-title>MoeURL</v-app-bar-title>
      <v-btn to="/" variant="text">{{ t('nav.home') }}</v-btn>
      <v-btn v-if="canReadOwnLinks" to="/links" variant="text">{{ t('nav.links') }}</v-btn>
      <v-btn v-if="canAccessAdmin" to="/admin/links" variant="text">{{ t('nav.admin') }}</v-btn>
      <v-btn v-if="canAccessAdmin" to="/admin/users" variant="text">{{ t('nav.users') }}</v-btn>
      <v-select
        v-model="language"
        class="toolbar-select"
        density="compact"
        hide-details
        :items="languageItems"
        variant="outlined"
      />
      <v-select v-model="themeMode" class="toolbar-select" density="compact" hide-details :items="themeItems" variant="outlined" />
      <span class="current-user">{{ currentUserName }}</span>
      <v-btn v-if="isGuest" to="/login" variant="text">{{ t('nav.login') }}</v-btn>
      <v-btn v-else variant="text" :loading="logoutMutation.isPending.value" @click="submitLogout">{{ t('nav.logout') }}</v-btn>
    </v-app-bar>

    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { useTheme } from 'vuetify/framework'

import { me, logout } from '@/entities/auth/api'
import { queryClient } from '@/app/query'
import {
  loadPreferences,
  resolveVuetifyTheme,
  saveLanguagePreference,
  saveThemePreference,
} from '@/shared/preferences/preferences'
import type { LanguagePreference, ThemePreference } from '@/shared/preferences/preferences'

const { locale, t } = useI18n()
const theme = useTheme()
const preferences = loadPreferences()
const language = ref<LanguagePreference>(preferences.language)
const themeMode = ref<ThemePreference>(preferences.theme)
const currentUserQuery = useQuery({
  queryKey: ['auth', 'me'],
  queryFn: me,
})
const currentUser = computed(() => currentUserQuery.data.value?.user)
const currentUserName = computed(() => currentUser.value?.nickname || currentUser.value?.username || 'guest')
const isGuest = computed(() => currentUser.value?.group === 'guest' || !currentUser.value)
const canReadOwnLinks = computed(() => currentUser.value?.permissions.includes('short_link:read_own') ?? false)
const canAccessAdmin = computed(() => currentUser.value?.permissions.includes('admin:access') ?? false)
const logoutMutation = useMutation({
  mutationFn: logout,
  onSuccess() {
    queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
  },
})

const languageItems = [
  { title: '简体中文', value: 'zh-CN' },
  { title: 'English', value: 'en' },
]
const themeItems = [
  { title: '跟随系统', value: 'system' },
  { title: '浅色', value: 'light' },
  { title: '深色', value: 'dark' },
]

locale.value = language.value
theme.global.name.value = resolveVuetifyTheme(themeMode.value)

watch(language, (value) => {
  locale.value = value
  saveLanguagePreference(value)
})

watch(themeMode, (value) => {
  theme.global.name.value = resolveVuetifyTheme(value)
  saveThemePreference(value)
})

function submitLogout() {
  logoutMutation.mutate()
}
</script>

<style scoped>
.toolbar-select {
  max-width: 128px;
}

.current-user {
  margin-inline: 12px;
  white-space: nowrap;
}
</style>
