<template>
  <section class="domain-mode">
    <h2>{{ t('domainRedirectManagement.title') }}</h2>
    <p>{{ t('domainRedirectManagement.description') }}</p>
    <form @submit.prevent="submit">
      <v-btn-toggle v-model="mode" mandatory divided :aria-label="t('domainRedirectManagement.title')" :disabled="disabled">
        <v-btn v-for="option in modes" :key="option" :value="option" :disabled="disabled" :aria-pressed="mode === option">{{ t(`shortLinkCreate.redirectModes.${option}`) }}</v-btn>
      </v-btn-toggle>
      <p v-if="stale" role="alert">{{ t('domainRedirectManagement.conflict') }}</p>
      <div class="domain-mode__actions">
        <v-btn v-if="stale" type="button" variant="text" :disabled="disabled" @click="$emit('reload')">{{ t('domainRedirectManagement.reload') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="disabled" @click="adopt(original)">{{ t('domainRedirectManagement.cancel') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="disabled || stale || !dirty" :loading="pending">{{ t('domainRedirectManagement.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { RedirectMode } from '@/entities/short-link/model'
import type { DomainRedirectDefaultSetting, SetDomainRedirectDefaultInput } from '@/entities/domain/redirect-default'

const props = defineProps<{ setting: DomainRedirectDefaultSetting; disabled: boolean; pending: boolean; conflict: boolean }>()
const emit = defineEmits<{ save: [SetDomainRedirectDefaultInput]; dirty: [boolean]; reload: [] }>()
const { t } = useI18n()
const modes: RedirectMode[] = ['direct', 'intermediate', 'confirmation']
const original = shallowRef(props.setting)
const mode = ref(props.setting.redirectMode)
const stale = ref(props.conflict)
const dirty = computed(() => mode.value !== original.value.redirectMode)
watch(dirty, (value) => emit('dirty', value), { immediate: true, flush: 'sync' })
watch(() => props.conflict, (value) => { if (value) stale.value = true }, { flush: 'sync' })
watch(() => props.setting, (setting) => {
  if (dirty.value && setting.updatedAt !== original.value.updatedAt) stale.value = true
  else if (!dirty.value && !stale.value) adopt(setting)
})
/** Cancel never replaces a conflicted snapshot with unrelated background data. */
function adopt(setting: DomainRedirectDefaultSetting) { original.value = setting; mode.value = setting.redirectMode }
/** Emits only the original setting's exact shared revision and chosen mode. */
function submit() {
  if (props.disabled || stale.value || !dirty.value) return
  emit('save', { id: original.value.domainId, redirectMode: mode.value, expectedUpdatedAt: original.value.updatedAt })
}
</script>

<style scoped>
.domain-mode { display: grid; gap: 12px; padding: 18px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 18px; background: rgb(var(--v-theme-surface)); min-width: 0; }
.domain-mode h2, .domain-mode p { margin: 0; }
.domain-mode p { color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.6; }
.domain-mode form { display: grid; gap: 12px; }
.domain-mode__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
</style>
