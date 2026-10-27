<template>
  <section class="group-default-editor" data-testid="group-default-editor">
    <h2>{{ t('groupDefault.title') }}</h2>
    <p>{{ t('groupDefault.description') }}</p>
    <p>{{ t('groupDefault.sharedVersion') }}</p>
    <p v-if="!result.setting.editable">{{ t('userGroups.guestRestricted') }}</p>
    <template v-else>
      <p v-if="unavailable" role="status">{{ t('groupDefault.savedUnavailable') }}</p>
      <p v-if="stale" role="status">{{ t('userGroups.dataStale') }}</p>
      <v-select :model-value="value" :items="items" :label="t('groupDefault.domain')" :disabled="disabled" variant="outlined" @update:model-value="select" />
      <div class="group-default-editor__actions">
        <v-btn :disabled="disabled || !dirty || unavailableValue" :loading="pending" color="primary" @click="save">{{ t('groupDefault.save') }}</v-btn>
        <v-btn :disabled="pending" variant="text" @click="emit('cancel', target)">{{ t('groupDefault.cancel') }}</v-btn>
        <v-btn :disabled="pending" variant="text" @click="emit('reload', target)">{{ t('groupDefault.reload') }}</v-btn>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { UserGroupDomainDefault } from '@/entities/user-group/domain-default'

const props = defineProps<{ result: UserGroupDomainDefault; value: string | null; disabled: boolean; dirty: boolean; pending: boolean; stale: boolean }>()
const emit = defineEmits<{
  select: [target: UserGroupDomainDefault['setting'], value: string | null]
  save: [target: UserGroupDomainDefault['setting']]
  cancel: [target: UserGroupDomainDefault['setting']]
  reload: [target: UserGroupDomainDefault['setting']]
}>()
const { t } = useI18n()
const target = computed(() => props.result.setting)
const unavailable = computed(() => !!target.value.domainId && !props.result.candidates.some(({ id }) => id === target.value.domainId))
const unavailableValue = computed(() => !!props.value && !props.result.candidates.some(({ id }) => id === props.value))
const items = computed(() => [{ title: t('groupDefault.notSet'), value: null }, ...props.result.candidates.map((item) => ({ title: `${item.displayName} (${item.host})`, value: item.id }))])
/** Captures the rendered group and revision for validation at the parent dispatch boundary. */
function select(value: string | null) { emit('select', target.value, value) }
/** Submits only an editable current choice; the parent independently revalidates scope and locks. */
function save() { if (!props.disabled && props.dirty && !unavailableValue.value) emit('save', target.value) }
</script>

<style scoped>
.group-default-editor { display: grid; gap: 14px; min-width: 0; padding-top: 22px; border-top: 1px solid var(--moeurl-outline); }
.group-default-editor h2, .group-default-editor p { margin: 0; }
.group-default-editor__actions { display: flex; gap: 10px; flex-wrap: wrap; }
</style>
