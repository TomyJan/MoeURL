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
      const passwordRequested = passwordRequests.has(input)
      return runShortLinkMutation(options.mutationFn, input, requestPassword, passwordRequested)
    },
    /** Closes the matching editor and refreshes its list after a successful save. */
    onSuccess(_data, variables) {
      if (settingsLink.value?.id === variables.id) {
        settingsLink.value = null
      }
      void queryClient.invalidateQueries({ queryKey: options.queryKey })
    },
    /** Releases transient password state after every mutation outcome. */
    onSettled(_data, _error, variables) {
      passwordRequests.delete(variables)
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

  /** Opens the settings dialog with a fresh mutation state for the selected link. */
  function configure(link: ShortLinkSettingsTarget) {
    settingsMutation.reset()
    settingsLink.value = link
  }

  /** Separates sensitive password data before starting the shared update mutation. */
  function saveSettings(input: UpdateShortLinkInput) {
    const { password, ...variables } = input
    if (password) {
      passwordRequests.add(variables)
      pendingPasswords.set(variables, { ...password })
    }
    settingsMutation.mutate(variables)
  }

  /** Releases the selected settings target when the dialog closes. */
  function closeSettings(open: boolean) {
    if (!open) {
      settingsLink.value = null
    }
  }

  /** Selects a short link for QR-code display. */
  function showQr(link: ShortLinkSettingsTarget) {
    qrLink.value = link
  }

  /** Clears the active QR-code dialog target. */
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
