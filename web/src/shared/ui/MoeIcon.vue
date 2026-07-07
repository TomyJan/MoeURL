<template>
  <svg class="moe-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
    <template v-if="name === 'globe'">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </template>

    <template v-else-if="name === 'home'">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </template>

    <template v-else-if="name === 'menu'">
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </template>

    <template v-else-if="name === 'monitor'">
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </template>

    <template v-else-if="name === 'moon'">
      <path d="M20 15.3A8.3 8.3 0 0 1 8.7 4a7 7 0 1 0 11.3 11.3Z" />
    </template>

    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.2" />
      <path d="M12 19.8V22" />
      <path d="m4.9 4.9 1.6 1.6" />
      <path d="m17.5 17.5 1.6 1.6" />
      <path d="M2 12h2.2" />
      <path d="M19.8 12H22" />
      <path d="m4.9 19.1 1.6-1.6" />
      <path d="m17.5 6.5 1.6-1.6" />
    </template>

    <template v-else>
      <circle cx="12" cy="12" r="7" />
      <path d="M9.5 9a2.8 2.8 0 0 1 5 1.7c0 1.7-2.5 2.1-2.5 3.8" />
      <path d="M12 17.5h.01" />
    </template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  name: 'globe' | 'home' | 'menu' | 'monitor' | 'moon' | 'sun'
}>()
</script>

<style scoped>
.moe-icon {
  display: block;
  width: 1em;
  height: 1em;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}
</style>
