import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQueryClient } from '@tanstack/vue-query'

import type { ShortLink, UpdateShortLinkInput } from '@/entities/short-link/model'
import { runShortLinkMutation } from './runShortLinkMutation'

interface UseShortLinkSettingsOptions {
  mutationFn: (input: UpdateShortLinkInput) => Promise<unknown>
  queryKey: readonly unknown[]
}

type ShortLinkSettingsTarget = Pick<
  ShortLink,
  'id' | 'url' | 'slug' | 'targetUrl' | 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt' | 'passwordEnabled'
>

/** Coordinates shared settings and QR dialog state for short-link list pages. */
export function useShortLinkSettings(options: UseShortLinkSettingsOptions) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const settingsLink = ref<ShortLinkSettingsTarget | null>(null)
  const qrLink = ref<ShortLinkSettingsTarget | null>(null)
  const pendingPasswords = new WeakMap<object, UpdateShortLinkInput['password']>()
  const passwordRequests = new WeakSet<object>()
  const settingsMutation = useMutation({
    /** Runs updates through the shared sensitive-input cleanup boundary. */
    mutationFn: (input: Omit<UpdateShortLinkInput, 'password'>) => {
      const requestPassword = pendingPasswords.get(input)
      const passwordRequested = passwordRequests.delete(input)
      pendingPasswords.delete(input)
      return runShortLinkMutation(options.mutationFn, input, requestPassword, passwordRequested)
    },
    onSuccess(_data, variables) {
      if (settingsLink.value?.id === variables.id) {
        settingsLink.value = null
      }
      void queryClient.invalidateQueries({ queryKey: options.queryKey })
    },
    onSettled(_data, _error, variables) {
      pendingPasswords.delete(variables)
    },
  })
  const settingsErrorMessage = computed(() => {
    if (!settingsMutation.isError.value) {
      return ''
    }
    return settingsMutation.error.value instanceof Error
      ? settingsMutation.error.value.message
      : t('links.settingsSaveFailed')
  })

  function configure(link: ShortLinkSettingsTarget) {
    settingsMutation.reset()
    settingsLink.value = link
  }

  function saveSettings(input: UpdateShortLinkInput) {
    const { password, ...variables } = input
    if (password) {
      passwordRequests.add(variables)
      pendingPasswords.set(variables, password)
    }
    settingsMutation.mutate(variables)
  }

  function closeSettings(open: boolean) {
    if (!open) {
      settingsLink.value = null
    }
  }

  function showQr(link: ShortLinkSettingsTarget) {
    qrLink.value = link
  }

  function closeQr() {
    qrLink.value = null
  }

  return {
    closeQr,
    closeSettings,
    configure,
    qrLink,
    saveSettings,
    settingsErrorMessage,
    settingsLink,
    settingsMutation,
    showQr,
  }
}
