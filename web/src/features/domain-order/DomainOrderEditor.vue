<template>
  <section class="domain-order">
    <h2>{{ t('domainOrder.title') }}</h2>
    <p>{{ t('domainOrder.description') }}</p>
    <form @submit.prevent="submit">
      <v-text-field v-model="priority" :label="t('domainOrder.value')" inputmode="numeric" variant="outlined" :disabled="disabled" :error-messages="parsed.success ? [] : [t('domainOrder.invalid')]" />
      <div class="domain-order__actions">
        <v-btn v-if="conflict" type="button" variant="text" :disabled="disabled" @click="$emit('reload')">{{ t('domainOrder.reload') }}</v-btn>
        <v-btn type="button" variant="text" :disabled="disabled" @click="adopt(conflict ? original : domain)">{{ t('domainOrder.cancel') }}</v-btn>
        <v-btn type="submit" color="primary" :disabled="disabled || !parsed.success" :loading="pending">{{ t('domainOrder.save') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useForm } from 'vee-validate'
import { z } from 'zod'
import type { ManagedDomain, SetDomainOrderInput } from '@/entities/domain/api'

const props = defineProps<{ domain: ManagedDomain; disabled: boolean; pending: boolean; conflict: boolean }>()
const emit = defineEmits<{ save: [SetDomainOrderInput]; dirty: [boolean]; reload: [] }>()
const { t } = useI18n()
const original = shallowRef(props.domain)
const conflict = ref(props.conflict)
const schema = z.object({ priority: z.string().regex(/^-?\d+$/).refine((value) => Number(value) >= -10000 && Number(value) <= 10000) })
const { values, defineField, resetForm } = useForm<{ priority: string }>({ initialValues: { priority: String(props.domain.sortOrder) } })
const [priority] = defineField('priority')
const parsed = computed(() => schema.safeParse(values))
const dirty = computed(() => priority.value !== String(original.value.sortOrder))
watch(dirty, (value) => emit('dirty', value), { immediate: true, flush: 'sync' })
// Unrelated details feedback cannot release this resource's conflicted snapshot.
// The parent renews this editor after an explicit reload, successful order save or selection change.
watch(() => props.conflict, (value) => { if (value) conflict.value = true }, { flush: 'sync' })
watch(() => props.domain, (domain) => { if (!dirty.value && !conflict.value) adopt(domain) })

/** Uses only an authoritative snapshot, retaining the exact optimistic revision. */
function adopt(domain: ManagedDomain) {
  original.value = domain
  resetForm({ values: { priority: String(domain.sortOrder) } })
}

/** Emits one independent command; validation never coerces empty text or exponents to zero. */
function submit() {
  if (props.disabled || !parsed.value.success) return
  emit('save', { id: original.value.id, sortOrder: Number(parsed.value.data.priority), expectedUpdatedAt: original.value.updatedAt })
}
</script>

<style scoped>
.domain-order { display: grid; gap: 12px; padding: 18px; border: 1px solid rgb(var(--v-theme-outline-variant)); border-radius: 18px; background: rgb(var(--v-theme-surface)); min-width: 0; }
.domain-order h2, .domain-order p { margin: 0; }
.domain-order p { color: rgb(var(--v-theme-on-surface-variant)); line-height: 1.6; }
.domain-order__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
</style>
