import { computed, inject, provide, type ComputedRef, type InjectionKey, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatInstant } from '@/shared/lib/date-time'
import { useTimeZonePreference } from './useTimeZonePreference'

type Fallback = 'device' | 'loading' | 'unavailable' | 'unsupported' | null
interface DisplayContext { timeZone: Ref<string | null>; fallback: Ref<Fallback> }
const displayKey: InjectionKey<DisplayContext> = Symbol('account-date-time-display')

/** Only the application owns this observer; display-only children do not need a QueryClient. */
export function provideDateTimeDisplay(authReady: Ref<boolean>) {
  const preference = useTimeZonePreference(authReady)
  const timeZone = computed(() => authReady.value ? preference.effectiveTimeZone.value : null)
  const fallback = computed<Fallback>(() => {
    if (!authReady.value || !preference.scope.value.userId) return 'device'
    if (preference.readError.value) return 'unavailable'
    if (preference.unsupported.value) return 'unsupported'
    if (!preference.preference.value) return 'loading'
    return timeZone.value ? null : 'device'
  })
  provide(displayKey, { timeZone, fallback })
  return { ...preference, timeZone, fallback }
}

/** Defaults to device formatting outside the authenticated application tree. */
export function useDateTimeDisplay() {
  const context = inject(displayKey, null)
  const { locale } = useI18n()
  const timeZone = computed(() => context?.timeZone.value ?? null)
  const fallback: ComputedRef<Fallback> = computed(() => context ? context.fallback.value : 'device')
  function format(value: string, style: 'date' | 'dateTime' = 'dateTime') {
    return formatInstant(value, locale.value, timeZone.value, style)
  }
  return { timeZone, fallback, format }
}
