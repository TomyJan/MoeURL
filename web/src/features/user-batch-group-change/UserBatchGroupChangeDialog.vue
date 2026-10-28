<template>
  <v-dialog :model-value="true" :persistent="pending" :aria-label="t('batchMembership.title')" max-width="600" @update:model-value="close">
    <v-card class="batch-membership-card">
      <v-card-title>{{ t('batchMembership.title') }}</v-card-title>
      <v-card-text class="batch-membership-body">
        <ul class="batch-membership-summary" :aria-label="t('batchMembership.summary')">
          <li v-for="item in snapshot" :key="item.id"><strong>{{ item.username }}</strong><span>{{ t(item.group === 'admin' ? 'membership.admin' : 'membership.user') }}</span></li>
        </ul>
        <p>{{ t('batchMembership.warning') }}</p>
        <v-select v-model="groupKey" :items="options" :label="t('batchMembership.group')" :disabled="pending" variant="outlined" />
        <v-alert v-if="groupKey" :type="groupKey === 'admin' ? 'warning' : 'info'" variant="tonal">{{ t(groupKey === 'admin' ? 'membership.promote' : 'membership.demote') }}</v-alert>
        <p>{{ t('batchMembership.counts', { changed: changedCount, unchanged: snapshot.length - changedCount }) }}</p>
        <v-switch v-model="confirmed" :label="t('batchMembership.confirm')" :disabled="pending" color="primary" />
      </v-card-text>
      <v-card-actions>
        <v-btn :disabled="pending" variant="text" @click="close">{{ t('membership.cancel') }}</v-btn>
        <v-btn :disabled="!canSave" :loading="pending" color="primary" variant="flat" @click="save">{{ t('batchMembership.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { z } from 'zod'
import type { UserSummary } from '@/entities/user/api'

const props = defineProps<{ snapshot: readonly UserSummary[]; pending: boolean }>()
const emit = defineEmits<{ close: []; submit: [group: 'user' | 'admin'] }>()
const { t } = useI18n()
const { defineField } = useForm({ initialValues: { groupKey: '', confirmed: false } })
const [groupKey] = defineField('groupKey')
const [confirmed] = defineField('confirmed')
const schema = z.strictObject({ groupKey: z.enum(['user', 'admin']), confirmed: z.literal(true) })
const options = computed(() => [{ title: t('membership.user'), value: 'user' }, { title: t('membership.admin'), value: 'admin' }])
const changedCount = computed(() => groupKey.value ? props.snapshot.filter(item => item.group !== groupKey.value).length : 0)
const canSave = computed(() => !props.pending && changedCount.value > 0 && schema.safeParse({ groupKey: groupKey.value, confirmed: confirmed.value }).success)
watch(groupKey, () => { confirmed.value = false }, { flush: 'sync' })

/** Never dismisses an in-flight privilege change through cancel, overlay or Escape. */
function close() { if (!props.pending) emit('close') }
/** Publishes only an explicitly confirmed supported destination with at least one actual change. */
function save() {
  const parsed = schema.safeParse({ groupKey: groupKey.value, confirmed: confirmed.value })
  if (canSave.value && parsed.success) emit('submit', parsed.data.groupKey)
}
</script>

<style scoped>
.batch-membership-card { min-width: 0; }
.batch-membership-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.batch-membership-body { display: grid; gap: 16px; min-width: 0; overflow-wrap: anywhere; }
.batch-membership-summary { max-height: 30vh; overflow-y: auto; padding-inline-start: 20px; }
.batch-membership-summary li { display: grid; gap: 4px; margin-block: 8px; overflow-wrap: anywhere; }
.batch-membership-body :deep(.v-label) { white-space: normal; }
</style>
