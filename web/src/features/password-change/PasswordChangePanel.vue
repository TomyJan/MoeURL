<template>
  <section class="password-change" data-testid="password-change-panel">
    <h2>{{ t('passwordChange.title') }}</h2>
    <p>{{ t('passwordChange.description') }}</p>
    <v-progress-linear v-if="status.isPending.value" indeterminate :aria-label="t('passwordChange.loading')" />
    <v-alert v-else-if="status.isError.value" type="error" variant="tonal">
      {{ t('passwordChange.statusFailed') }}
      <v-btn type="button" variant="text" :disabled="status.isFetching.value" @click="retryStatus">{{ t('passwordChange.retry') }}</v-btn>
    </v-alert>
    <p v-else-if="!status.data.value?.canChangePassword">{{ t('passwordChange.externalIdentity') }}</p>
    <form v-else data-testid="password-change-form" class="password-change__form" novalidate @submit.prevent="submit">
      <p class="password-change__note">{{ t('passwordChange.loginPolicyNote') }}</p>
      <v-text-field
        v-model="currentPassword" :label="t('passwordChange.currentPassword')" :error-messages="errors.currentPassword"
        :disabled="locked" type="password" autocomplete="current-password" variant="outlined"
      />
      <v-text-field
        v-model="newPassword" :label="t('passwordChange.newPassword')" :error-messages="errors.newPassword"
        :disabled="locked" type="password" autocomplete="new-password" variant="outlined"
      />
      <v-text-field
        v-model="confirmPassword" :label="t('passwordChange.confirmPassword')" :error-messages="errors.confirmPassword"
        :disabled="locked" type="password" autocomplete="new-password" variant="outlined"
      />
      <div class="password-change__actions">
        <v-btn color="primary" type="submit" :disabled="locked" :loading="pending">{{ t('passwordChange.submit') }}</v-btn>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useForm } from 'vee-validate'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { changePassword, getPasswordStatus, type ChangePasswordInput } from '@/entities/auth/password'
import { ApiClientError } from '@/shared/api/client'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const { t } = useI18n()
const router = useRouter()
const emit = defineEmits<{ sessionRevoked: [] }>()
const client = useQueryClient()
const status = useQuery({ queryKey: ['auth', 'password', 'status'], queryFn: getPasswordStatus, retry: false })
const pending = ref(false)
const locked = computed(() => pending.value || status.isFetching.value)
const { values, errors, defineField, setErrors, resetForm } = useForm({
  initialValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
})
const [currentPassword] = defineField('currentPassword')
const [newPassword] = defineField('newPassword')
const [confirmPassword] = defineField('confirmPassword')
let active = true
let requestInput: ChangePasswordInput | undefined
const wellFormed = z.string().refine((value) => !/[\uD800-\uDFFF]/u.test(value))
const schema = z.object({
  currentPassword: wellFormed.refine((value) => value.length > 0 && new globalThis.TextEncoder().encode(value).length <= 4096, 'currentInvalid'),
  newPassword: wellFormed.refine((value) => Array.from(value).length >= 8 && Array.from(value).length <= 128, 'newInvalid'),
  confirmPassword: z.string(),
}).superRefine((draft, ctx) => {
  if (draft.currentPassword === draft.newPassword) {
    ctx.addIssue({ code: 'custom', path: ['newPassword'], message: 'mustDiffer' })
  }
  if (draft.newPassword !== draft.confirmPassword) {
    ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'confirmationMismatch' })
  }
})

watch(status.error, (error) => {
  if (error instanceof ApiClientError && error.code === 401) {
    pending.value = true
    void leaveAuthenticatedSession(false)
  }
})

onBeforeUnmount(() => {
  active = false
  clearSecrets()
})

/** Clears local form values and any retained reference to the submitted credentials. */
function clearSecrets() {
  resetForm()
  if (requestInput) {
    requestInput.currentPassword = ''
    requestInput.newPassword = ''
    requestInput = undefined
  }
}

/** Validates the original draft without retaining a parsed password snapshot. */
function validateDraft() {
  const result = schema.safeParse(values)
  setErrors({ currentPassword: undefined, newPassword: undefined, confirmPassword: undefined })
  if (result.success) return true
  const fieldErrors: Partial<Record<keyof typeof values, string>> = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof typeof values
    if (fieldErrors[field]) continue
    const message = issue.message === 'mustDiffer' || issue.message === 'confirmationMismatch'
      ? issue.message : field === 'currentPassword' ? 'currentInvalid' : 'newInvalid'
    fieldErrors[field] = t(`passwordChange.${message}`)
  }
  setErrors(fieldErrors)
  return false
}

/** Cancels outstanding identity reads and clears cached account data before returning to login. */
async function leaveAuthenticatedSession(changed: boolean) {
  if (active) emit('sessionRevoked')
  await revokeAccountIdentity(client, true)
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'auth' || query.queryKey[1] !== 'me' })
  if (!active) return
  if (changed) toast.success(t('passwordChange.success'))
  else toast.error(t('passwordChange.sessionExpired'))
  await router.replace('/login?redirect=/profile')
}

/** Submits once through the direct API boundary and clears secrets after every request outcome. */
async function submit() {
  if (!active || locked.value || status.isError.value || !status.data.value?.canChangePassword) return
  if (!validateDraft()) return
  pending.value = true
  requestInput = { currentPassword: values.currentPassword, newPassword: values.newPassword }
  try {
    await changePassword(requestInput)
    clearSecrets()
    await leaveAuthenticatedSession(true)
  } catch (error) {
    clearSecrets()
    if (error instanceof ApiClientError && error.code === 401) {
      await leaveAuthenticatedSession(false)
      return
    }
    if (!active) return
    const code = error instanceof ApiClientError ? error.code : 0
    const messages: Record<number, string> = { 100001: 'invalidRequest', 110101: 'wrongPassword', 110103: 'rateLimited', 110105: 'unavailable' }
    toast.error(t(`passwordChange.${messages[code] ?? 'failed'}`))
    if (code === 110105) await status.refetch()
  } finally {
    clearSecrets()
    pending.value = false
  }
}

/** Manually reloads authoritative password availability without retrying a password write. */
function retryStatus() {
  void status.refetch()
}
</script>

<style scoped>
.password-change {
  display: grid;
  min-width: 0;
  align-content: start;
  gap: 14px;
  padding: 22px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: var(--moeurl-surface-elevated);
  box-shadow: var(--moeurl-shadow);
}

.password-change h2 {
  margin: 0;
  font-size: 1.18rem;
}

.password-change p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.password-change__form {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.password-change__note {
  font-size: 0.86rem;
}

.password-change__actions {
  display: flex;
  flex-wrap: wrap;
}

@media (max-width: 620px) {
  .password-change { padding: 18px; }
}
</style>
