<template>
  <v-dialog :model-value="true" :persistent="pending" max-width="600" @update:model-value="close">
    <v-card>
      <v-card-title>{{ t('supplementalMembership.title') }}</v-card-title>
      <v-card-text>
        <p class="supplemental-membership__identity">{{ target.username }} · {{ t('supplementalMembership.primaryGroup', { group: primaryGroupName }) }}</p>
        <p>{{ t('supplementalMembership.warning') }}</p>
        <v-alert v-if="groupsLoading" type="info" variant="tonal">{{ t('supplementalMembership.groupsLoading') }}</v-alert>
        <v-alert v-if="groupsError" type="error" variant="tonal">
          {{ t('supplementalMembership.groupsFailed') }}
          <v-btn variant="text" :disabled="pending" @click="emit('retry-groups')">{{ t('supplementalMembership.retryGroups') }}</v-btn>
        </v-alert>
        <v-alert v-if="!frozenGroupsAvailable && groupsReady" type="warning" variant="tonal">{{ t('supplementalMembership.staleGroups') }}</v-alert>
        <fieldset class="supplemental-membership__groups" :disabled="pending || !groupsReady || groupsError">
          <legend>{{ t('supplementalMembership.groupsLabel') }}</legend>
          <p v-if="options.length === 0" class="supplemental-membership__empty">{{ t('supplementalMembership.noGroups') }}</p>
          <label v-for="group in options" :key="group.key" class="supplemental-membership__option">
            <v-checkbox-btn :aria-label="group.name" :model-value="selectedKeys.includes(group.key)" :disabled="pending || !groupsReady || groupsError || !group.available" @update:model-value="toggleGroup(group.key, !!$event)" />
            <span>{{ group.name }}</span>
            <small v-if="!group.available">{{ t('supplementalMembership.unavailable') }}</small>
          </label>
        </fieldset>
        <v-switch v-model="confirmed" :label="t('supplementalMembership.confirm')" :disabled="pending || !groupsReady || groupsError" color="primary" />
        <p class="supplemental-membership__revision">{{ t('supplementalMembership.revision', { updatedAt: target.updatedAt }) }}</p>
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="pending" variant="text" @click="close">{{ t('supplementalMembership.cancel') }}</v-btn>
        <v-btn :disabled="!canSave" :loading="pending" color="primary" variant="flat" @click="save">{{ t('supplementalMembership.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ApiClientError } from '@/shared/api/client'
import { me } from '@/entities/auth/api'
import type { UserResponse } from '@/entities/auth/api'
import { updateUserGroupMemberships } from '@/entities/user/supplemental-group-membership'
import type { UserSummary } from '@/entities/user/api'
import type { UserGroup } from '@/entities/user-group/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const props = defineProps<{
  target: UserSummary
  groups: UserGroup[]
  groupsReady: boolean
  groupsLoading: boolean
  groupsError: boolean
}>()
const emit = defineEmits<{
  close: []
  pending: [value: boolean]
  refresh: [success: boolean]
  'retry-groups': []
}>()
const { t } = useI18n()
const identity = useAccountIdentity()
const openingScope = identity.scope.value
let alive = true
let revision = 0
const pending = ref(false)
const confirmed = ref(false)
const selectedKeys = ref(props.target.supplementalGroups.map(({ key }) => key))
const target = computed(() => props.target)
onBeforeUnmount(() => { alive = false })

const auth = useQuery<UserResponse>({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const allowed = computed(() => identity.isCurrent(openingScope)
  && !!openingScope.userId
  && auth.data.value?.user.id === openingScope.userId
  && auth.data.value.user.permissions.includes('admin:access')
  && !props.target.builtin
  && props.target.id !== openingScope.userId)
const frozenByKey = computed(() => new Map(target.value.supplementalGroups.map(group => [group.key, group])))
const customGroups = computed(() => props.groups.filter(group => !group.builtin && group.editable))
const frozenGroupsAvailable = computed(() => target.value.supplementalGroups.every(({ key }) => customGroups.value.some(group => group.key === key)))
const options = computed(() => {
  const catalog = customGroups.value.map(group => ({
    key: group.key,
    name: frozenByKey.value.get(group.key)?.name ?? group.name,
    available: true,
  }))
  for (const frozen of target.value.supplementalGroups) {
    if (!catalog.some(group => group.key === frozen.key)) catalog.push({ ...frozen, available: false })
  }
  return catalog.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key))
})
const primaryGroupName = computed(() => props.groups.find(({ key }) => key === target.value.group)?.name ?? target.value.group)
const changed = computed(() => {
  const frozen = target.value.supplementalGroups.map(({ key }) => key).sort()
  const selected = [...selectedKeys.value].sort()
  return frozen.length !== selected.length || frozen.some((key, index) => key !== selected[index])
})
const canSave = computed(() => allowed.value
  && props.groupsReady
  && !props.groupsLoading
  && !props.groupsError
  && frozenGroupsAvailable.value
  && confirmed.value
  && changed.value
  && !pending.value
  && selectedKeys.value.every(key => customGroups.value.some(group => group.key === key)))

watch(() => props.target, (next, previous) => {
  if (next.id !== previous.id || next.updatedAt !== previous.updatedAt) {
    selectedKeys.value = next.supplementalGroups.map(({ key }) => key)
    confirmed.value = false
    revision++
    if (pending.value) {
      pending.value = false
      emit('pending', false)
      emit('close')
    }
  }
}, { flush: 'sync' })
watch(allowed, value => { if (!value) emit('close') }, { flush: 'sync' })

/** Adds or removes one custom group without changing the frozen target revision. */
function toggleGroup(key: string, checked: boolean) {
  if (pending.value || !props.groupsReady || props.groupsError || !customGroups.value.some(group => group.key === key)) return
  selectedKeys.value = checked
    ? [...new Set([...selectedKeys.value, key])]
    : selectedKeys.value.filter(item => item !== key)
  confirmed.value = false
}

/** Dismisses only after the one explicit request has settled. */
function close() {
  if (!pending.value) emit('close')
}

/** Sends one CAS replacement using the opening snapshot and ignores obsolete completions. */
async function save() {
  if (!canSave.value) return
  const currentRevision = revision
  const scope = openingScope
  pending.value = true
  emit('pending', true)
  let succeeded = false
  try {
    await updateUserGroupMemberships({
      id: target.value.id,
      groupKeys: [...selectedKeys.value].sort(),
      expectedUpdatedAt: target.value.updatedAt,
    })
    if (!alive || currentRevision !== revision || !identity.isCurrent(scope) || !allowed.value) return
    succeeded = true
  } catch (error) {
    if (!alive || currentRevision !== revision || !identity.isCurrent(scope) || !allowed.value) return
    toast.error(error instanceof ApiClientError && error.code === 300105
      ? t('supplementalMembership.conflict')
      : t('supplementalMembership.failed'))
  } finally {
    if (alive && currentRevision === revision && identity.isCurrent(scope)) {
      pending.value = false
      emit('pending', false)
      emit('close')
      emit('refresh', succeeded)
    }
  }
}

</script>

<style scoped>
.supplemental-membership__identity { overflow-wrap: anywhere; font-weight: 600; }
.supplemental-membership__groups { display: grid; gap: 4px; margin: 0; padding: 8px 12px 12px; border: 1px solid rgb(var(--v-theme-outline)); border-radius: 8px; }
.supplemental-membership__groups legend { padding: 0 4px; font-weight: 600; }
.supplemental-membership__option { display: flex; align-items: center; gap: 8px; min-height: 44px; overflow-wrap: anywhere; }
.supplemental-membership__option small { margin-inline-start: auto; color: rgb(var(--v-theme-on-surface-variant)); }
.supplemental-membership__empty, .supplemental-membership__revision { color: rgb(var(--v-theme-on-surface-variant)); font-size: 0.875rem; }
</style>
