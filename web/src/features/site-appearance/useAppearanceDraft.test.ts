import { cleanup, render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { useAppearanceDraft } from './useAppearanceDraft'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('guards imperative duplicate loads and saves across loading and saving without losing a confirmed revision', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } })
  const first = createDeferred<Response>(), write = createDeferred<Response>(), reload = createDeferred<Response>()
  const document = { accentPreset: 'ocean', updatedAt: '2026-10-30T00:01:02.123456Z' }
  const response = () => new Response(JSON.stringify({ code: 0, message: 'OK', data: document, meta: {} }))
  const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(write.promise).mockReturnValueOnce(reload.promise)
  vi.stubGlobal('fetch', fetcher)
  let controller!: ReturnType<typeof useAppearanceDraft>
  render(defineComponent({ setup() { controller = useAppearanceDraft(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  await controller.load(); await controller.save()
  expect(fetcher).not.toHaveBeenCalled(); expect(controller.state.version).toBe('')
  client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'alice', group: 'admin', permissions: ['admin:access', 'system:manage'] } })
  await controller.load(); await controller.save()
  expect(fetcher).toHaveBeenCalledTimes(1); expect(controller.state.loading).toBe(true)
  first.resolve(response()); await waitFor(() => expect(controller.state.version).toBe(document.updatedAt))
  const saving = controller.save()
  await controller.load(); await controller.save()
  expect(fetcher).toHaveBeenCalledTimes(2); expect(controller.state.saving).toBe(true)
  write.resolve(response()); await saving
  const refreshing = controller.load()
  await controller.load(); await controller.save()
  expect(fetcher).toHaveBeenCalledTimes(3); expect(controller.state.version).toBe(document.updatedAt)
  reload.resolve(response()); await refreshing
  expect(controller.state.loading).toBe(false); expect(controller.state.saving).toBe(false)
  cleanup(); client.clear()
})
