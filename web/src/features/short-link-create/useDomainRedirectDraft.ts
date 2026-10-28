import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { RedirectMode } from '@/entities/short-link/model'
import type { useDomainRedirectDefaults } from '@/shared/preferences/useDomainRedirectDefaults'

interface DraftInputs {
  domainId: Ref<string>
  scope: Ref<{ userId: string; epoch: number }>
  canIntermediate: Ref<boolean>
  canConfirmation: Ref<boolean>
  pending: Ref<boolean>
  mode: Ref<RedirectMode>
  delay: Ref<number>
  query: ReturnType<typeof useDomainRedirectDefaults>
}

/** Separates explicit choices from one domain-bound automatic draft snapshot. */
export function useDomainRedirectDraft(input: DraftInputs) {
  const manual = ref<RedirectMode | null>(null)
  const bound = ref<{ domainId: string; mode: RedirectMode } | null>(null)
  const reconfirm = ref(false)
  const waiting = ref(false)
  const enhanced = computed(() => input.canIntermediate.value || input.canConfirmation.value)
  let generation = 0
  let mounted = true
  onBeforeUnmount(() => { mounted = false; generation++ })

  /** Configuration never grants an enhanced capability absent from current auth/me. */
  function allowed(mode: RedirectMode) { return mode === 'direct' || (mode === 'intermediate' ? input.canIntermediate.value : input.canConfirmation.value) }
  const suggested = computed(() => {
    if (!input.query.isSuccess.value) return undefined
    const entry = input.query.data.value!.items.find(({ domainId }) => domainId === input.domainId.value)
    return entry ? allowed(entry.redirectMode) ? entry.redirectMode : 'direct' : undefined
  })
  const ready = computed(() => !reconfirm.value && (!enhanced.value || manual.value !== null || (bound.value?.domainId === input.domainId.value && !waiting.value)))
  const needsRead = computed(() => enhanced.value && manual.value === null && bound.value === null && !reconfirm.value)
  const changed = computed(() => !!bound.value && suggested.value !== undefined && bound.value.mode !== suggested.value)

  /** Adopts only an unbound automatic choice; background reads cannot rewrite a draft. */
  function bind() {
    if (input.pending.value || waiting.value || manual.value !== null || bound.value || reconfirm.value || suggested.value === undefined) return
    input.mode.value = suggested.value
    input.delay.value = 5
    bound.value = { domainId: input.domainId.value, mode: suggested.value }
  }

  /** Defers adoption until identity-scoped query observers finish their synchronous transition. */
  async function settle(refresh: boolean) {
    const scope = input.scope.value
    const current = ++generation
    waiting.value = true
    await nextTick()
    if (!mounted || scope !== input.scope.value || generation !== current) return
    if (refresh && enhanced.value) await input.query.refetch()
    if (!mounted || scope !== input.scope.value || generation !== current) return
    waiting.value = false
    bind()
  }

  /** Resets form-local policy state without changing the independent domain-choice hierarchy. */
  function reset(refresh = false) {
    manual.value = null; bound.value = null; reconfirm.value = false
    input.mode.value = 'direct'; input.delay.value = 5
    void settle(refresh)
  }
  /** A click on even the already-selected direct choice is an explicit override. */
  function choose(mode: RedirectMode) {
    if (input.pending.value || !allowed(mode)) return
    generation++; waiting.value = false; manual.value = mode; bound.value = null; reconfirm.value = false
    input.mode.value = mode
  }
  /** Explicit adoption or successful creation rereads current defaults, never a write. */
  function reload() {
    if (input.pending.value) return
    manual.value = null; bound.value = null; reconfirm.value = false
    void settle(true)
  }

  watch(input.scope, () => reset(), { flush: 'sync' })
  watch(input.domainId, () => {
    bound.value = null
    if (manual.value === null && !reconfirm.value) { input.mode.value = 'direct'; input.delay.value = 5; void settle(false) }
  }, { flush: 'sync' })
  watch([input.canIntermediate, input.canConfirmation], () => {
    if (allowed(input.mode.value)) return
    generation++; waiting.value = false; manual.value = null; bound.value = null; reconfirm.value = true
    input.mode.value = 'direct'; input.delay.value = 5
  }, { flush: 'sync' })
  watch([input.query.data, input.query.isSuccess, input.pending, input.canIntermediate, input.canConfirmation], bind, { immediate: true, flush: 'post' })
  return { ready, needsRead, changed, reconfirm, manual, choose, reset, reload }
}
