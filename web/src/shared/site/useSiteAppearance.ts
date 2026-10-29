import { onScopeDispose, ref, watch } from 'vue'
import { QueryClient, useQueryClient } from '@tanstack/vue-query'
import { useTheme } from 'vuetify'
import { applyAccentPreset } from '@/app/accent-presets'
import { getPublicAppearance, publicAppearanceKey, type Appearance } from '@/entities/appearance/api'

const coordinators = new WeakMap<QueryClient, ReturnType<typeof createCoordinator>>()
/** Shares public commit/read ordering within one application query client. */
function createCoordinator(client: QueryClient) {
  const appearance = ref<Appearance>({ accentPreset: 'iris' })
  const loading = ref(false), error = ref(false)
  let generation = 0
  /** Invalidates success, failure and finally before canceling the old query. */
  function retire() {
    generation++
    void client.cancelQueries({ queryKey: publicAppearanceKey, exact: true })
  }
  /** Keeps the latest success while refreshing; a current failure returns to iris. */
  async function read() {
    retire()
    const token = generation
    loading.value = true
    error.value = false
    try {
      const value = await client.fetchQuery({ queryKey: publicAppearanceKey, staleTime: 0, retry: false,
        async queryFn() {
          const value = await getPublicAppearance()
          if (token !== generation) throw new Error('Obsolete appearance read')
          return value
        },
      })
      if (token === generation) appearance.value = value
    } catch {
      if (token === generation) { appearance.value = { accentPreset: 'iris' }; error.value = true }
    } finally {
      if (token === generation) loading.value = false
    }
  }
  /** Publishes only a guarded server commit and prevents old reads from undoing it. */
  function publish(value: Appearance) {
    retire()
    client.setQueryData(publicAppearanceKey, value)
    appearance.value = value
    loading.value = false
    error.value = false
  }
  return { appearance, loading, error, read, publish, retire }
}
/** Returns the coordinator without mounting any public read in management components. */
function coordinator(client: QueryClient) {
  let value = coordinators.get(client)
  if (!value) { value = createCoordinator(client); coordinators.set(client, value) }
  return value
}
/** Applies a server-validated management result after its identity guard has passed. */
export function publishAppearance(client: QueryClient, value: Appearance) {
  coordinator(client).publish(value)
}
/** Mounts the application's actual public read and four-token theme binding. */
export function useSiteAppearance() {
  const state = coordinator(useQueryClient())
  const theme = useTheme()
  state.appearance.value = { accentPreset: 'iris' }
  watch(state.appearance, value => applyAccentPreset(theme.themes.value, value.accentPreset), { immediate: true, flush: 'sync' })
  void state.read()
  onScopeDispose(state.retire)
  return state
}
