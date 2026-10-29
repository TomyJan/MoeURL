<template>
  <v-app>
    <AppToasts />
    <v-main class="app-main">
      <div class="app-route-transition" data-testid="app-route-transition">
        <router-view v-slot="{ Component, route }">
          <Transition name="moe-route" mode="out-in">
            <component :is="Component" :key="route.matched?.[0]?.path || route.path || route.fullPath" />
          </Transition>
        </router-view>
      </div>
      <SiteFooter />
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getPublicConfig } from '@/entities/system/api'
import { me } from '@/entities/auth/api'
import { useAppPreferences } from '@/shared/preferences/useAppPreferences'
import { useAccountPreferences } from '@/shared/preferences/useAccountPreferences'
import { bindSiteTitle, setSiteConfig, useSiteConfig } from '@/shared/site/useSiteConfig'
import SiteFooter from '@/shared/site/SiteFooter.vue'
import AppToasts from '@/shared/feedback/AppToasts.vue'
import { useSiteAppearance } from '@/shared/site/useSiteAppearance'

const preferences = useAppPreferences()
useSiteAppearance()
useQuery({ queryKey: ['auth', 'me'], queryFn: me, retry: false })
useAccountPreferences()
const publicConfigQuery = useQuery({ queryKey: ['system', 'public-config'], queryFn: getPublicConfig, retry: false, staleTime: 60_000 })
const { config } = useSiteConfig()
bindSiteTitle(computed(() => config.value.siteName))
watch(publicConfigQuery.data, (value) => {
  if (value) setSiteConfig(value)
}, { immediate: true })
watch(config, (value) => preferences.applyServerDefaults(value.defaultLanguage, value.defaultTheme), { immediate: true })
</script>
