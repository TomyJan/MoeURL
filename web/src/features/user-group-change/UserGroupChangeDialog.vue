<template>
  <v-dialog :model-value="true" :persistent="mutation.isPending.value" max-width="520" @update:model-value="close">
    <v-card>
      <v-card-title>{{ t('membership.title') }}</v-card-title>
      <v-card-text>
        <p class="membership-identity">{{ target.username }}</p>
        <p>{{ t('membership.warning') }}</p>
        <v-select v-model="group" :items="options" :label="t('membership.group')" :disabled="mutation.isPending.value || groupsQuery.isPending.value || groupsQuery.isError.value" variant="outlined" />
        <v-alert :type="group === 'admin' ? 'warning' : 'info'" variant="tonal">{{ group === 'admin' ? t('membership.promote') : selectedGroup ? t('membership.assignGroup', { group: selectedGroup.name }) : t('membership.groupUnavailable') }}</v-alert>
        <v-alert v-if="groupsQuery.isError.value" type="error" variant="tonal">
          {{ t('membership.groupsLoadFailed') }} <v-btn variant="text" @click="groupsQuery.refetch()">{{ t('membership.retry') }}</v-btn>
        </v-alert>
        <v-switch v-model="confirmed" :label="t('membership.confirm')" :disabled="mutation.isPending.value" color="primary" />
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="mutation.isPending.value" variant="text" @click="close">{{ t('membership.cancel') }}</v-btn>
        <v-btn :disabled="!canSave" :loading="mutation.isPending.value" color="primary" variant="flat" @click="save">{{ t('membership.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me } from '@/entities/auth/api'
import { changeUserGroup, type UserSummary } from '@/entities/user/api'
import { listUserGroups, userGroupQueryKey, type UserGroupKey } from '@/entities/user-group/api'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const props = defineProps<{ target: UserSummary; managed?: boolean }>()
const emit = defineEmits<{ close: []; pending: [value: boolean]; refresh: [] }>()
const { t } = useI18n()
const client = useQueryClient()
const identity = useAccountIdentity()
const initialScope = identity.scope.value
let alive = true
onBeforeUnmount(() => { alive = false })
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const allowed = computed(() => identity.isCurrent(initialScope) && !!initialScope.userId && !!auth.data.value?.user.permissions.includes('admin:access') && props.target.id !== initialScope.userId && !props.target.builtin)
const groupsQuery = useQuery({ queryKey: [...userGroupQueryKey, initialScope.userId, initialScope.epoch], queryFn: listUserGroups, enabled: allowed, retry: false, staleTime: Infinity })
const group = ref<UserGroupKey>(props.target.group)
const confirmed = ref(false)
const options = computed(() => (groupsQuery.data.value?.groups ?? []).filter(({ key }) => key !== 'guest').map(({ name, key }) => ({ title: name, value: key })))
const selectedGroup = computed(() => groupsQuery.data.value?.groups.find(({ key }) => key === group.value))
const mutation = useMutation({ mutationFn: changeUserGroup, retry: false })
let revision = 0
watch(() => props.target, () => { group.value = props.target.group; confirmed.value = false; revision++ }, { flush: 'sync' })
watch(options, (items) => { if (!items.some(({ value }) => value === group.value)) group.value = items.find(({ value }) => value === 'user')?.value ?? items[0]?.value ?? '' }, { immediate: true })
watch(allowed, (value) => { if (!value) emit('close') }, { flush: 'sync' })
const canSave = computed(() => allowed.value && !groupsQuery.isPending.value && !groupsQuery.isError.value && options.value.some(({ value }) => value === group.value) && confirmed.value && group.value !== props.target.group && !mutation.isPending.value)

/** Keeps dismissal locked until the privileged mutation has settled. */
function close() { if (!mutation.isPending.value) emit('close') }

/** Sends the opening snapshot, ignoring completions belonging to an obsolete target or identity. */
async function save() {
  if (!canSave.value) return
  const current = revision
  const input = { id: props.target.id, groupKey: group.value, expectedUpdatedAt: props.target.updatedAt }
  emit('pending', true)
  try {
    await mutation.mutateAsync(input)
    if (!alive || !allowed.value || revision !== current) return
    toast.success(t('membership.success'))
    emit('close')
    refresh()
  } catch (error) {
    if (!alive || !allowed.value || revision !== current) return
    if (error instanceof ApiClientError && error.code === 300105) {
      toast.error(t('membership.conflict'))
      emit('close')
      refresh()
    } else toast.error(t('membership.failed'))
  } finally { if (alive) emit('pending', false) }
}

/** Lets the owning page enforce readback while preserving standalone dialog consumers. */
function refresh() {
  if (props.managed) emit('refresh')
  else void client.invalidateQueries({ queryKey: ['admin-user'] })
}
</script>
<style scoped>
.membership-identity { overflow-wrap: anywhere; font-weight: 600; }
</style>
