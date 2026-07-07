<template>
  <v-app>
    <v-main>
      <div class="app-route-transition" data-testid="app-route-transition">
        <router-view v-slot="{ Component, route }">
          <Transition name="moe-route" mode="out-in">
            <component :is="Component" :key="route.matched?.[0]?.path || route.path || route.fullPath" />
          </Transition>
        </router-view>
      </div>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { useAppPreferences } from '@/shared/preferences/useAppPreferences'

useAppPreferences()
</script>
