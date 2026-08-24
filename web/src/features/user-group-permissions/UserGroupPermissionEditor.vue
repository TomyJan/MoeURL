<template>
  <section class="permission-editor" data-testid="user-group-permission-editor">
    <header class="permission-editor__summary" data-testid="user-group-summary">
      <div>
        <p class="permission-editor__key">{{ group.key }}</p>
        <h2>{{ group.name }}</h2>
        <p>{{ group.description }}</p>
      </div>
      <div class="permission-editor__statuses">
        <span class="permission-editor__status">{{ t('userGroups.builtin') }}</span>
        <span class="permission-editor__status">{{ group.editable ? t('userGroups.editable') : t('userGroups.readOnly') }}</span>
      </div>
    </header>

    <div class="permission-editor__preset" data-testid="user-group-preset">
      <v-select
        v-model="selectedPreset"
        :disabled="pending || !dataValid || !group.editable"
        :items="presetItems"
        :label="t('userGroups.preset')"
        variant="outlined"
        @update:model-value="applyPreset"
      />
      <p v-if="!group.editable">{{ t('userGroups.guestRestricted') }}</p>
      <p v-else-if="!dataValid">{{ t('userGroups.dataStale') }}</p>
      <p v-else>{{ t('userGroups.presetHint') }}</p>
    </div>

    <div class="permission-editor__permissions" data-testid="user-group-permissions">
      <section v-for="category in categories" :key="category.key" class="permission-editor__category">
        <h3>{{ t(`userGroups.categories.${category.key}`) }}</h3>
        <div class="permission-editor__options">
          <div v-for="definition in category.definitions" :key="definition.key" class="permission-editor__option">
            <v-checkbox
              :aria-describedby="permissionDescribedBy(definition)"
              :disabled="pending || !dataValid || !group.editable || definition.protected"
              :label="t(`userGroups.permissions.${definition.key}.label`)"
              :model-value="draftPermissions.includes(definition.key)"
              hide-details
              @update:model-value="setPermission(definition.key, Boolean($event))"
            />
            <p :id="permissionDescriptionId(definition.key)">{{ t(`userGroups.permissions.${definition.key}.description`) }}</p>
            <span v-if="definition.protected" :id="permissionProtectedId(definition.key)">{{ t('userGroups.protected') }}</span>
          </div>
        </div>
      </section>
    </div>

    <footer class="permission-editor__actions" data-testid="user-group-actions">
      <span>{{ t('userGroups.updatedAt', { value: formattedUpdatedAt }) }}</span>
      <v-btn
        color="primary"
        :disabled="!group.editable || !dataValid || !dirty || pending"
        :loading="pending"
        variant="flat"
        @click="emit('save')"
      >
        {{ t('userGroups.save') }}
      </v-btn>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type {
  PermissionCategory,
  PermissionDefinition,
  PermissionPreset,
  PermissionPresetKey,
  UserGroup,
} from '@/entities/user-group/api'

const props = defineProps<{
  dataValid: boolean
  definitions: PermissionDefinition[]
  dirty: boolean
  draftPermissions: string[]
  group: UserGroup
  pending: boolean
  presets: PermissionPreset[]
}>()

const emit = defineEmits<{
  'apply-preset': [presetKey: PermissionPresetKey]
  'save': []
  'set-permission': [permissionKey: string, selected: boolean]
}>()

const { locale, t } = useI18n()
const categoryOrder: PermissionCategory[] = ['short_link_basic', 'short_link_access', 'domain', 'administration']
const selectedPreset = ref<PermissionPresetKey | ''>('')
/** Formats the current permission version whenever its value or locale changes. */
const formattedUpdatedAt = computed(() => formatUpdatedAt(props.group.updatedAt, locale.value))
/** Groups permission definitions in their stable interface order. */
const categories = computed(() => categoryOrder.map((key) => ({
  key,
  definitions: props.definitions.filter((definition) => definition.category === key),
})).filter(({ definitions }) => definitions.length > 0))
/** Builds the presets available to the active built-in group. */
const presetItems = computed(() => {
  if (!props.group.editable) {
    return [{ title: t('userGroups.presets.restricted'), value: 'restricted' }]
  }
  return props.presets
    .filter((preset) => preset.applicableGroups.includes(props.group.key as 'user' | 'admin'))
    .map((preset) => ({ title: t(`userGroups.presets.${preset.key}`), value: preset.key }))
})

watch(
  [() => props.group.key, () => props.group.updatedAt],
  ([groupKey]) => {
    selectedPreset.value = groupKey === 'guest' ? 'restricted' : ''
  },
  { immediate: true },
)

/** Returns the stable DOM ID for one permission's explanatory text. */
function permissionDescriptionId(permissionKey: string) {
  return `permission-${encodeURIComponent(permissionKey)}-description`
}

/** Returns the stable DOM ID for one protected-permission marker. */
function permissionProtectedId(permissionKey: string) {
  return `permission-${encodeURIComponent(permissionKey)}-protected`
}

/** Associates each checkbox with its description and optional protected marker. */
function permissionDescribedBy(definition: PermissionDefinition) {
  const ids = [permissionDescriptionId(definition.key)]
  if (definition.protected) {
    ids.push(permissionProtectedId(definition.key))
  }
  return ids.join(' ')
}

/** Emits a selected preset while retaining it as the visible draft source. */
function applyPreset(value: PermissionPresetKey | '' | null) {
  if (!value || !props.group.editable) {
    return
  }
  selectedPreset.value = value
  emit('apply-preset', value)
}

/** Clears the preset source once a user adjusts an individual permission. */
function setPermission(permissionKey: string, selected: boolean) {
  selectedPreset.value = ''
  emit('set-permission', permissionKey, selected)
}

/** Formats an RFC3339 permission version in the active locale. */
function formatUpdatedAt(value: string, activeLocale: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(activeLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
</script>

<style scoped>
.permission-editor {
  display: grid;
  gap: 22px;
}

.permission-editor__summary,
.permission-editor__preset,
.permission-editor__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.permission-editor__summary h2,
.permission-editor__summary p,
.permission-editor__category h3,
.permission-editor__option p {
  margin: 0;
}

.permission-editor__key,
.permission-editor__status,
.permission-editor__option span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  font-weight: 750;
}

.permission-editor__statuses {
  display: flex;
  align-items: center;
  gap: 10px;
}

.permission-editor__preset {
  align-items: start;
}

.permission-editor__preset :deep(.v-input) {
  flex: 0 1 340px;
}

.permission-editor__permissions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.permission-editor__category {
  min-width: 0;
  padding: 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: 8px;
  background: var(--moeurl-surface-soft);
}

.permission-editor__options {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.permission-editor__option {
  min-width: 0;
}

.permission-editor__option p {
  padding-inline-start: 40px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.88rem;
}

.permission-editor__actions {
  padding-top: 18px;
  border-top: 1px solid var(--moeurl-outline);
}

@media (max-width: 700px) {
  .permission-editor__summary,
  .permission-editor__preset,
  .permission-editor__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .permission-editor__permissions {
    grid-template-columns: minmax(0, 1fr);
  }

  .permission-editor__preset :deep(.v-input) {
    flex: 0 1 auto;
    width: 100%;
  }

  .permission-editor__actions :deep(.v-btn) {
    width: 100%;
  }
}
</style>
