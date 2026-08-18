import { computed, toValue, type MaybeRefOrGetter } from 'vue'

import type { CurrentUser } from '@/entities/auth/api'
import type { RedirectMode } from '@/entities/short-link/model'

/** Derives redirect-mode capabilities and validates a selected mode for submission. */
export function useRedirectModePermissions(currentUser: MaybeRefOrGetter<Pick<CurrentUser, 'permissions'> | undefined>) {
  const canUseIntermediate = computed(() => Boolean(toValue(currentUser)?.permissions.includes('short_link:use_intermediate')))
  const canUseConfirmation = computed(() => Boolean(toValue(currentUser)?.permissions.includes('short_link:use_confirmation')))
  const canConfigureRedirect = computed(() => canUseIntermediate.value || canUseConfirmation.value)

  /** Reports whether the selected mode is allowed under the supplied configuration boundary. */
  function canSubmitRedirectMode(mode: RedirectMode, configured = canConfigureRedirect.value) {
    return configured && (mode === 'direct'
      || (mode === 'intermediate' && canUseIntermediate.value)
      || (mode === 'confirmation' && canUseConfirmation.value))
  }

  return {
    canUseConfirmation,
    canUseIntermediate,
    canSubmitRedirectMode,
  }
}
