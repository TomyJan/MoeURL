<template>
  <section class="provider-template" :aria-label="t('oidc.templates.title')">
    <h3>{{ t('oidc.templates.title') }}</h3>
    <div class="provider-template__choices" role="group" :aria-label="t('oidc.templates.choice')">
      <v-btn v-for="item in choices" :key="item.id" type="button" :aria-pressed="selected === item.id" :variant="selected === item.id ? 'tonal' : 'outlined'" :disabled="disabled" @click="selectTemplate(item.id)">{{ item.label }}</v-btn>
    </div>
    <p>{{ t('oidc.templates.description') }}</p>
    <v-btn type="button" variant="tonal" :disabled="disabled" @click="apply">{{ t('oidc.templates.apply') }}</v-btn>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildProviderTemplate, type ProviderTemplateFields, type ProviderTemplateID } from './template'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ apply: [fields: ProviderTemplateFields]; change: [] }>()
const { t } = useI18n()
const selected = ref<ProviderTemplateID>('manual')
const choices = computed(() => [{ id: 'manual' as const, label: t('oidc.templates.manual') }, { id: 'google' as const, label: 'Google' }])
const fields = computed(() => buildProviderTemplate(selected.value))

/** Changing the picker never applies fields and invalidates any previous confirmation. */
function selectTemplate(id: ProviderTemplateID) {
  if (props.disabled) return
  selected.value = id
  emit('change')
}

/** Emits only non-secret template fields after an explicit user action. */
function apply() {
  if (props.disabled) return
  emit('apply', { ...fields.value })
}
</script>

<style scoped>
.provider-template { display: grid; gap: 12px; padding: 16px; border: 1px solid var(--moeurl-outline); border-radius: 12px; min-width: 0; }
.provider-template h3, .provider-template p { margin: 0; }
.provider-template p { color: rgb(var(--v-theme-on-surface-variant)); font-size: .875rem; }
.provider-template__choices { display: flex; flex-wrap: wrap; gap: 8px; }
.provider-template > .v-btn { justify-self: start; }
@media (max-width: 600px) { .provider-template__choices { display: grid; grid-template-columns: 1fr; } }
</style>
