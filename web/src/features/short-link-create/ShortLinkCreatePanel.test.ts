import { fireEvent, render, screen } from '@testing-library/vue'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { componentStubs } from '@/test/component-stubs'
import { me } from '@/entities/auth/api'
import { createShortLink } from '@/entities/short-link/api'

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutationOptions: [] as unknown[],
  queryResult: {},
  queryOptions: [] as unknown[],
  mutationResult: {},
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/entities/auth/api', () => ({
  me: vi.fn(),
}))

vi.mock('@/entities/short-link/api', () => ({
  createShortLink: vi.fn(),
}))

vi.mock('@tanstack/vue-query', () => ({
  useMutation: vi.fn((options?: { onSuccess?: (value: unknown) => void }) => {
    state.mutationOptions.push(options)
    const base = state.mutationResult as {
      data?: ReturnType<typeof ref>
      error?: ReturnType<typeof ref>
      isPending?: ReturnType<typeof ref>
      mutate?: (input: unknown) => void
    }
    const providedMutate = base.mutate
    return {
      data: base.data ?? ref(undefined),
      error: base.error ?? ref(undefined),
      isPending: base.isPending ?? ref(false),
      mutate: vi.fn((input: unknown) => {
        providedMutate?.(input)
        options?.onSuccess?.({
          shortLink: { url: 'https://go.example.com/abc123' },
        })
      }),
    }
  }),
  useQuery: vi.fn((options?: unknown) => {
    state.queryOptions.push(options)
    return state.queryResult
  }),
  useQueryClient: () => ({
    invalidateQueries: state.invalidateQueries,
  }),
}))

function mountPanel(props: Record<string, unknown> = {}) {
  return render(ShortLinkCreatePanel, {
    props,
    global: {
      stubs: componentStubs,
    },
  })
}

function setQueryResult(permissions: string[]) {
  state.queryResult = {
    data: ref({
      user: {
        permissions,
      },
    }),
  }
}

function setMutationResult(value: Partial<{
  data: ReturnType<typeof ref>
  error: ReturnType<typeof ref>
  isPending: ReturnType<typeof ref>
  mutate: ReturnType<typeof vi.fn>
}> = {}) {
  state.mutationResult = {
    data: value.data ?? ref(undefined),
    error: value.error ?? ref(undefined),
    isPending: value.isPending ?? ref(false),
    ...(value.mutate ? { mutate: value.mutate } : {}),
  }
}

describe('ShortLinkCreatePanel', () => {
  beforeEach(() => {
    state.invalidateQueries.mockReset()
    state.mutationOptions = []
    state.queryOptions = []
    setQueryResult([])
    setMutationResult()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn() },
    })
  })

  it('keeps the form visible while blocking users without create permission', async () => {
    const mutate = vi.fn()
    setMutationResult({ mutate })

    const { container } = mountPanel()

    expect(container.querySelector('.short-link-create-panel__shell')).toBeTruthy()
    expect(container.querySelector('.short-link-create-panel__field-row')).toBeTruthy()
    const targetInput = screen.getByLabelText('shortLinkCreate.targetLabel') as HTMLInputElement
    expect(targetInput.disabled).toBe(true)
    expect(targetInput.placeholder).toBe('shortLinkCreate.targetPlaceholder')
    expect(screen.queryByText(/^https$/i)).toBeNull()
    expect(screen.getByText('shortLinkCreate.permissionRequired')).toBeTruthy()

    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).not.toHaveBeenCalled()
  })

  it('creates a short link and exposes copy and reset actions', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ mutate })

    mountPanel({ mode: 'full' })

    expect(state.mutationOptions).toEqual(
      expect.arrayContaining([expect.objectContaining({ mutationFn: createShortLink })]),
    )
    expect(state.queryOptions).toEqual(expect.arrayContaining([expect.objectContaining({ queryFn: me })]))

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).toHaveBeenCalledWith({ targetUrl: 'https://example.com' })
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['short-link'] })
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-short-link'] })
    expect(screen.getByTestId('short-link-create-result')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.successTitle')).toBeTruthy()
    expect(screen.getByText('https://go.example.com/abc123')).toBeTruthy()

    await fireEvent.click(screen.getByText('shortLinkCreate.copy'))
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith('https://go.example.com/abc123')

    await fireEvent.click(screen.getByText('shortLinkCreate.reset'))
    expect(screen.queryByText('https://go.example.com/abc123')).toBeNull()
  })

  it('validates target URL before submitting', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ mutate })

    mountPanel()

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'not-a-url')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))

    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('shortLinkCreate.invalidUrl')).toBeTruthy()
  })

  it('blocks duplicate submissions while creation is pending', async () => {
    const mutate = vi.fn()
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ isPending: ref(true), mutate })

    mountPanel()

    const submitButton = screen.getByText('shortLinkCreate.submit') as HTMLButtonElement
    expect(submitButton.disabled).toBe(true)

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(submitButton)

    expect(mutate).not.toHaveBeenCalled()
  })

  it('binds pending state into the submit button disabled expression', () => {
    const source = readFileSync('src/features/short-link-create/ShortLinkCreatePanel.vue', 'utf8')
    const submitButtonBlock = source.match(/<v-btn\s+class="short-link-create-panel__submit"[\s\S]+?<\/v-btn>/)?.[0] ?? ''

    expect(submitButtonBlock).toContain(':disabled="!canCreateShortLink || mutation.isPending.value"')
  })

  it('uses the Zod 4 URL validator pipeline for target URLs', () => {
    const source = readFileSync('src/features/short-link-create/ShortLinkCreatePanel.vue', 'utf8')

    expect(source).toContain('z.string().trim().pipe(z.url())')
    expect(source).not.toContain('z.string().trim().url()')
  })

  it('shows copy failures without clearing the created link', async () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    })

    mountPanel()

    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://example.com')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await fireEvent.click(screen.getByText('shortLinkCreate.copy'))

    expect(await screen.findByText('shortLinkCreate.copyFailed')).toBeTruthy()
    expect(screen.getByText('https://go.example.com/abc123')).toBeTruthy()
  })

  it('shows API errors and fallback errors', () => {
    setQueryResult(['short_link:create', 'domain:use_default'])
    setMutationResult({ error: ref(new Error('invalid target')) })

    const { unmount } = mountPanel()
    expect(screen.getByText('invalid target')).toBeTruthy()
    unmount()

    setMutationResult({ error: ref({}) })
    mountPanel()
    expect(screen.getByText('shortLinkCreate.failed')).toBeTruthy()
  })
})
