import { computed, nextTick, shallowRef, type ShallowRef } from 'vue'
import { useQueryClient, type QueryClient } from '@tanstack/vue-query'
import { me, type UserResponse } from '@/entities/auth/api'

const activeReads = new WeakMap<QueryClient, ShallowRef<(() => boolean) | undefined>>()

/** Coordinates denial recovery across widgets while keeping revoked grants unavailable. */
export function useAuthorizationRefresh() {
  const client = useQueryClient()
  let active = activeReads.get(client)
  if (!active) { active = shallowRef(); activeReads.set(client, active) }
  const currentRead = active
  const pending = computed(() => currentRead.value?.() ?? false)

  /** Restores only this identity's authorization unless a newer cache write supersedes it. */
  async function refresh(isCurrent: () => boolean) {
    const token = () => isCurrent()
    currentRead.value = token
    void client.cancelQueries({ queryKey: ['auth', 'me'] })
    const current = client.getQueryData<UserResponse>(['auth', 'me'])!
    client.setQueryData<UserResponse>(['auth', 'me'], { user: { ...current.user, permissions: [] } })
    let superseded = false
    // This subscription belongs to the read and survives the initiating widget's unmount.
    const stop = client.getQueryCache().subscribe(event => {
      if (event.query.queryKey[0] === 'auth' && event.query.queryKey[1] === 'me'
        && (event.type === 'updated' || event.type === 'removed')) {
        superseded = true
        if (currentRead.value === token) currentRead.value = undefined
      }
    })
    try {
      const refreshed = await me()
      if (isCurrent() && !superseded) {
        stop()
        client.setQueryData(['auth', 'me'], refreshed)
        // Let observers see the restored grants before releasing navigation's pending state.
        await nextTick()
      }
    } catch { /* Retain cleared grants; the shell handles the confirmed unavailable route. */ }
    finally {
      stop()
      if (currentRead.value === token) currentRead.value = undefined
    }
  }
  return { pending, refresh }
}
