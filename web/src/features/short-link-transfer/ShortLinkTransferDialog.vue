<template>
  <v-dialog :model-value="true" :persistent="mutation.isPending.value" max-width="560" @update:model-value="close">
    <v-card>
      <v-card-title>{{ t('transfer.title') }}</v-card-title>
      <v-card-text class="transfer-body">
        <p class="transfer-url">{{ target.url }}</p>
        <p>{{ t('transfer.currentOwner', { username: target.owner.username }) }}</p>
        <v-alert type="warning" variant="tonal">{{ t('transfer.warning') }}</v-alert>
        <v-text-field v-model="username" :label="t('transfer.recipient')" :disabled="mutation.isPending.value" autocomplete="off" variant="outlined" />
        <v-switch v-model="confirmed" :label="t('transfer.confirm')" :disabled="mutation.isPending.value" color="primary" />
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="mutation.isPending.value" variant="text" @click="close">{{ t('transfer.cancel') }}</v-btn>
        <v-btn :disabled="!canSave" :loading="mutation.isPending.value" color="primary" variant="flat" @click="save">{{ t('transfer.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { AdminShortLink } from '@/entities/short-link/model'
import { transferShortLink, transferUsernameSchema } from '@/entities/short-link/transfer'
import { ApiClientError } from '@/shared/api/client'
import { useTransferSession } from './useTransferSession'

const props = defineProps<{ target: Pick<AdminShortLink, 'id' | 'url' | 'owner' | 'updatedAt'> }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
// Capture the opening version; a refreshed list must not silently authorize a new handoff.
const snapshot = { ...props.target }
const { defineField } = useForm({ initialValues: { username: '' } })
const [username] = defineField('username')
const confirmed = ref(false)
const mutation = useMutation({ mutationFn: transferShortLink, retry: false })
const { allowed, dismissed, isCurrent, close, invalidate } = useTransferSession(mutation.isPending, () => emit('close'))
const validUsername = computed(() => transferUsernameSchema.safeParse(username.value).success)
const canSave = computed(() => !dismissed.value && allowed.value && confirmed.value && validUsername.value && !mutation.isPending.value)
/** Sends the immutable opening version and preserves input on ordinary failures. */
async function save() {
  if (!canSave.value || !isCurrent()) return
  try {
    await mutation.mutateAsync({ id: snapshot.id, newOwnerUsername: username.value, expectedUpdatedAt: snapshot.updatedAt })
    await nextTick()
    invalidate()
    if (!isCurrent()) return
    toast.success(t('transfer.success'))
    close()
  } catch (error) {
    await nextTick()
    if (!isCurrent()) return
    if (error instanceof ApiClientError && error.code === 200116) {
      toast.error(t('transfer.conflict'))
      close()
      invalidate()
    } else toast.error(t(error instanceof ApiClientError && error.code === 200117 ? 'transfer.recipientUnavailable' : 'transfer.failed'))
  }
}
</script>
<style scoped>
.transfer-body { display: grid; gap: 16px; min-width: 0; overflow-wrap: anywhere; }
.transfer-url { overflow-wrap: anywhere; font-weight: 600; }
</style>
