<template>
  <v-dialog :model-value="true" :persistent="mutation.isPending.value" max-width="520" @update:model-value="close">
    <v-card>
      <v-card-title>{{ t('membership.title') }}</v-card-title>
      <v-card-text>
        <p class="membership-identity">{{ target.username }}</p>
        <p>{{ t('membership.warning') }}</p>
        <v-select v-model="group" :items="options" :label="t('membership.group')" :disabled="mutation.isPending.value" variant="outlined" />
        <v-alert :type="group === 'admin' ? 'warning' : 'info'" variant="tonal">{{ t(group === 'admin' ? 'membership.promote' : 'membership.demote') }}</v-alert>
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
import { computed, ref, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me } from '@/entities/auth/api'
import { changeUserGroup, type UserSummary } from '@/entities/user/api'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const props = defineProps<{ target: UserSummary }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const client = useQueryClient()
const identity = useAccountIdentity()
const initialScope = identity.scope.value
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const allowed = computed(() => identity.isCurrent(initialScope) && !!initialScope.userId && !!auth.data.value?.user.permissions.includes('admin:access') && props.target.id !== initialScope.userId && !props.target.builtin)
const group = ref(props.target.group as 'user' | 'admin')
const confirmed = ref(false)
const options = computed(() => [{ title: t('membership.user'), value: 'user' }, { title: t('membership.admin'), value: 'admin' }])
const mutation = useMutation({ mutationFn: changeUserGroup, retry: false })
let revision = 0
watch(() => props.target, () => { group.value = props.target.group as 'user' | 'admin'; confirmed.value = false; revision++ }, { flush: 'sync' })
watch(allowed, (value) => { if (!value) emit('close') }, { flush: 'sync' })
const canSave = computed(() => allowed.value && confirmed.value && group.value !== props.target.group && !mutation.isPending.value)

/** Keeps dismissal locked until the privileged mutation has settled. */
function close() { if (!mutation.isPending.value) emit('close') }

/** Sends the opening snapshot, ignoring completions belonging to an obsolete target or identity. */
async function save() {
  if (!canSave.value) return
  const current = revision
  const input = { id: props.target.id, groupKey: group.value, expectedUpdatedAt: props.target.updatedAt }
  try {
    await mutation.mutateAsync(input)
    if (!allowed.value || revision !== current) return
    toast.success(t('membership.success'))
    emit('close')
    void client.invalidateQueries({ queryKey: ['admin-user'] })
  } catch (error) {
    if (!allowed.value || revision !== current) return
    if (error instanceof ApiClientError && error.code === 300105) {
      toast.error(t('membership.conflict'))
      emit('close')
      void client.invalidateQueries({ queryKey: ['admin-user'] })
    } else toast.error(t('membership.failed'))
  }
}
</script>
<style scoped>
.membership-identity { overflow-wrap: anywhere; font-weight: 600; }
</style>
