import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQueryClient } from '@tanstack/vue-query'

import type { ShortLink, UpdateShortLinkInput } from '@/entities/short-link/model'

interface UseShortLinkSettingsOptions {
  mutationFn: (input: UpdateShortLinkInput) => Promise<unknown>
  queryKey: readonly unknown[]
}

type ShortLinkSettingsTarget = Pick<
  ShortLink,
  'id' | 'url' | 'slug' | 'targetUrl' | 'redirectMode' | 'intermediateDelaySeconds' | 'expiresAt'
>

export function useShortLinkSettings(options: UseShortLinkSettingsOptions) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const settingsLink = ref<ShortLinkSettingsTarget | null>(null)
  const qrLink = ref<ShortLinkSettingsTarget | null>(null)
  const settingsMutation = useMutation({
    mutationFn: options.mutationFn,
    onSuccess(_data, variables) {
      if (settingsLink.value?.id === variables.id) {
        settingsLink.value = null
      }
      void queryClient.invalidateQueries({ queryKey: options.queryKey })
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
    settingsMutation.mutate(input)
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
