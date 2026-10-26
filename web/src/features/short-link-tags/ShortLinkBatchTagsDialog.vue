<template>
  <v-dialog :model-value="true" :persistent="mutation.isPending.value" max-width="640" @update:model-value="close">
    <v-card class="batch-tags-card" data-testid="batch-tags-dialog">
      <v-card-title>{{ t('batchTags.title', { count: snapshot.length }, snapshot.length) }}</v-card-title>
      <v-card-text class="batch-tags-body">
        <ul class="batch-tags-summary" :aria-label="t('batchTags.summary')">
          <li v-for="target in snapshot" :key="target.id"><p>{{ target.url }}</p><p>{{ target.tags.join(' · ') }}</p></li>
        </ul>
        <p>{{ t('batchTags.description') }}</p>
        <v-select v-model="operation" data-testid="batch-tags-operation" :items="operations" :label="t('batchTags.operation')" :disabled="mutation.isPending.value" variant="outlined" />
        <v-textarea v-model="tagsText" data-testid="batch-tags-input" :label="t('batchTags.tags')" :error-messages="!parsed.success ? t('linkMetadata.tagsInvalid') : ''" :disabled="mutation.isPending.value" rows="3" auto-grow variant="outlined" />
        <v-alert v-if="clearing" type="warning" variant="tonal" data-testid="batch-tags-clear-warning">{{ t('batchTags.clearWarning') }}</v-alert>
        <v-switch v-model="confirmed" data-testid="batch-tags-confirm" :label="t('batchTags.confirm')" :disabled="mutation.isPending.value" color="primary" />
      </v-card-text>
      <v-card-actions>
        <v-btn data-testid="batch-tags-cancel" :disabled="mutation.isPending.value" variant="text" @click="close">{{ t('batchTags.cancel') }}</v-btn>
        <v-btn data-testid="batch-tags-save" :disabled="!canSave" :loading="mutation.isPending.value" color="primary" variant="flat" @click="save">{{ t('batchTags.save') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import { useForm } from 'vee-validate'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { batchTagShortLinks, batchTagTagsSchema, type BatchTagInput, type BatchTagTarget } from '@/entities/short-link/batch-tags'
import { metadataDraftSchema } from '@/shared/validation/shortLinkMetadata'
import { ApiClientError } from '@/shared/api/client'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'

const props = defineProps<{ targets: readonly BatchTagTarget[]; context: 'own' | 'admin' }>()
const emit = defineEmits<{ close: []; saved: []; conflict: []; revoked: [] }>()
const { t } = useI18n()
const client = useQueryClient()
const access = useShortLinkAccess(props.context)
const scope = access.identity.scope.value
const context = props.context
const snapshot = props.targets.map(target => ({ ...target, tags: [...target.tags] }))
const { defineField } = useForm({ initialValues: { tagsText: '' } })
const [tagsText] = defineField('tagsText')
const operation = ref<BatchTagInput['operation']>('add')
const confirmed = ref(false)
const dismissed = ref(false)
let alive = true
const mutation = useMutation({ mutationKey: ['batch-tags'], mutationFn: (input: BatchTagInput) => batchTagShortLinks(input, context), retry: false })
const draftSchema = metadataDraftSchema.transform(value => value.tags).pipe(batchTagTagsSchema)
const parsed = computed(() => draftSchema.safeParse({ title: '', tagsText: tagsText.value }))
const clearing = computed(() => operation.value === 'replace' && parsed.value.success && parsed.value.data.length === 0)
const operations = computed(() => (['add', 'remove', 'replace'] as const).map(value => ({ title: t(`batchTags.${value}`), value })))
const allowed = computed(() => access.identity.isCurrent(scope) && access.canTag.value)
const canSave = computed(() => !dismissed.value && allowed.value && !mutation.isPending.value && confirmed.value && parsed.value.success && (operation.value === 'replace' || parsed.value.data.length > 0))
/** Retires the opening snapshot immediately on any grant or login-epoch revocation. */
function revoke() {
  if (!dismissed.value) { dismissed.value = true; emit('revoked'); emit('close') }
}
const unsubscribe = client.getQueryCache().subscribe(event => {
  if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me' && (!access.identity.isCurrent(scope) || !access.allows('tags'))) revoke()
})
watch(allowed, value => { if (!value) revoke() }, { flush: 'sync' })
onBeforeUnmount(() => { alive = false; unsubscribe() })
/** Rechecks synchronous grants before sending and after a completion. */
function isCurrent() { return alive && !dismissed.value && access.identity.isCurrent(scope) && access.allows('tags') }
/** Prevents manual dismissal while the atomic operation is outstanding. */
function close() { if (!mutation.isPending.value && !dismissed.value) { dismissed.value = true; emit('close') } }
/** Invalidates all dependent private views even after this dialog has unmounted. */
function invalidate() {
  for (const key of ['short-link', 'admin-short-link', 'short-link-overview', 'short-link-statistics', 'insights']) void client.invalidateQueries({ queryKey: [key] })
}
/** Sends the fixed versions and preserves dirty input for ordinary failures. */
async function save() {
  if (!canSave.value || !isCurrent()) return
  try {
    const result = await mutation.mutateAsync({ items: snapshot.map(target => ({ id: target.id, expectedUpdatedAt: target.updatedAt })), operation: operation.value, tags: parsed.value.data! })
    await nextTick()
    invalidate()
    if (!isCurrent()) return
    toast.success(`${t('batchTags.changed', { count: result.changedCount }, result.changedCount)} ${t('batchTags.unchanged', { count: result.unchangedCount }, result.unchangedCount)}`)
    emit('saved'); close()
  } catch (error) {
    await nextTick()
    if (!isCurrent()) return
    if (error instanceof ApiClientError && [120001, 401, 403].includes(error.code)) {
      toast.error(t('batchTags.accessChanged')); revoke()
      // Discard denied grants before refetching so they cannot authorize a new confirmation.
      void client.resetQueries({ queryKey: ['auth', 'me'], exact: true })
    } else if (error instanceof ApiClientError && error.code === 200116) {
      toast.error(t('batchTags.conflict')); emit('conflict'); close(); invalidate()
    } else toast.error(t(error instanceof ApiClientError && error.code === 200119 ? 'batchTags.limitExceeded' : 'batchTags.failed'))
  }
}
</script>
<style scoped>
.batch-tags-card { min-width: 0; }
.batch-tags-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.batch-tags-body { display: grid; gap: 16px; min-width: 0; overflow-wrap: anywhere; }
.batch-tags-summary { max-height: 32vh; overflow-y: auto; padding-inline-start: 20px; min-width: 0; }
.batch-tags-summary li + li { margin-top: 12px; }
.batch-tags-summary p { margin: 0; overflow-wrap: anywhere; }
.batch-tags-body :deep(.v-label) { white-space: normal; }
</style>
