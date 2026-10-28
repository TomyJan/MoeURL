import { cleanup, fireEvent, screen } from '@testing-library/vue'
import { useQuery } from '@tanstack/vue-query'
import { computed, defineComponent, h, ref, shallowRef, watch } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { listDomains, managedDomainQueryKey, type ManagedDomain } from '@/entities/domain/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { globalId, otherId, mountRedirectDefaults, revision } from '@/test/domain-redirect-default'
import { useDomainRedirectManagement } from './useDomainRedirectManagement'

let view: ReturnType<typeof mountRedirectDefaults>
afterEach(() => { cleanup(); view?.client.clear(); vi.unstubAllGlobals() })

it('rejects queued wrong-target, busy and removed-resource actions at its public boundary', async () => {
  const domain = shallowRef<ManagedDomain>()
  const removed = ref(false)
  const eligible = ref(true)
  const legacyBusy = ref(false)
  const recovery = ref('')
  const component = defineComponent({ setup() {
    const identity = useAccountIdentity()
    const list = useQuery({ queryKey: computed(() => [...managedDomainQueryKey, identity.scope.value.userId, identity.scope.value.epoch]), queryFn: listDomains })
    watch(list.data, (data) => { if (data && !removed.value) domain.value = data.items.find(({ id }) => id === globalId) }, { immediate: true })
    const mode = useDomainRedirectManagement({ domain, identity, eligible, denied: ref(false), removed, dirty: ref(false), legacyDirty: ref(false), legacyBusy, list, adopt: (value) => { domain.value = value } })
    return () => h('section', [h('output', mode.setting.value?.redirectMode ?? 'unknown'), h('output', recovery.value), h('button', { onClick: () => mode.save({ id: otherId, redirectMode: 'direct', expectedUpdatedAt: revision }) }, 'Queued other target'), h('button', { onClick: async () => { recovery.value = String(await mode.reload()) } }, 'Queued reload')])
  } })
  view = mountRedirectDefaults(component, { admin: true })
  await screen.findByText('confirmation')
  const initialReads = view.state.requests.length
  await fireEvent.click(screen.getByRole('button', { name: 'Queued other target' }))
  expect(view.state.writes).toHaveLength(0)
  legacyBusy.value = true
  await fireEvent.click(screen.getByRole('button', { name: 'Queued reload' }))
  await screen.findByText('false')
  expect(view.state.requests).toHaveLength(initialReads)
  legacyBusy.value = false
  removed.value = true
  await fireEvent.click(screen.getByRole('button', { name: 'Queued reload' }))
  await screen.findByText('false')
  expect(view.state.requests).toHaveLength(initialReads)
  removed.value = false
  eligible.value = false
  await fireEvent.click(screen.getByRole('button', { name: 'Queued reload' }))
  expect(view.state.writes).toHaveLength(0)
  expect(view.state.requests).toHaveLength(initialReads)
})
