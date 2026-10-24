<template>
  <v-dialog :model-value="true" :persistent="mutation.isPending.value" max-width="640" @update:model-value="close">
    <v-card class="batch-transfer-card">
      <v-card-title>{{ t('batchTransfer.title', { count: snapshot.length }, snapshot.length) }}</v-card-title>
      <v-card-text class="batch-transfer-body">
        <ul class="batch-transfer-summary" :aria-label="t('batchTransfer.summary')">
          <li v-for="target in snapshot" :key="target.id">
            <p>{{ target.url }}</p>
            <p>{{ t('transfer.currentOwner', { username: target.owner.username }) }}</p>
          </li>
        </ul>
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
import { batchTransferShortLinks, transferUsernameSchema } from '@/entities/short-link/transfer'
import { ApiClientError } from '@/shared/api/client'
import { useTransferSession } from './useTransferSession'

const props = defineProps<{ targets: readonly Pick<AdminShortLink, 'id' | 'updatedAt' | 'url' | 'owner'>[] }>()
const emit = defineEmits<{ close: []; transferred: []; conflict: [] }>()
const { t } = useI18n()
const snapshot = props.targets.map(target => ({ ...target, owner: { ...target.owner } }))
const { defineField } = useForm({ initialValues: { username: '' } })
const [username] = defineField('username')
const confirmed = ref(false)
const mutation = useMutation({ mutationFn: batchTransferShortLinks, retry: false })
const { allowed, dismissed, isCurrent, close, invalidate } = useTransferSession(mutation.isPending, () => emit('close'), true)
const canSave = computed(() => !dismissed.value && allowed.value && confirmed.value && transferUsernameSchema.safeParse(username.value).success && !mutation.isPending.value)

/** Makes one explicit attempt using the immutable opening versions and exact username. */
async function save() {
  if (!canSave.value || !isCurrent()) return
  try {
    const result = await mutation.mutateAsync({ items: snapshot.map(target => ({ id: target.id, expectedUpdatedAt: target.updatedAt })), newOwnerUsername: username.value })
    await nextTick()
    if (!isCurrent()) return
    toast.success(`${t('batchTransfer.transferred', { count: result.transferredCount }, result.transferredCount)} ${t('batchTransfer.unchanged', { count: result.unchangedCount }, result.unchangedCount)}`)
    emit('transferred')
    close()
    invalidate()
  } catch (error) {
    await nextTick()
    if (!isCurrent()) return
    if (error instanceof ApiClientError && error.code === 200116) {
      toast.error(t('transfer.conflict'))
      emit('conflict')
      close()
      invalidate()
    } else toast.error(t(error instanceof ApiClientError && error.code === 200117 ? 'transfer.recipientUnavailable' : 'transfer.failed'))
  }
}
</script>

<style scoped>
.batch-transfer-card { min-width: 0; }
.batch-transfer-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.batch-transfer-body { display: grid; gap: 16px; min-width: 0; overflow-wrap: anywhere; }
.batch-transfer-summary { max-height: 32vh; overflow-y: auto; padding-inline-start: 20px; min-width: 0; }
.batch-transfer-summary li + li { margin-top: 12px; }
.batch-transfer-summary p { margin: 0; overflow-wrap: anywhere; }
.batch-transfer-body :deep(.v-label) { white-space: normal; }
</style>
