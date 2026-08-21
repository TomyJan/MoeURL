import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useMutation } from '@tanstack/vue-query'

import { ApiClientError } from '@/shared/api/client'
import { USER_GROUP_PERMISSION_CONFLICT_CODE } from '@/shared/api/error-codes'
import { listUserGroups, updateUserGroupPermissions } from '@/entities/user-group/api'
import type { UserGroupListResponse } from '@/entities/user-group/api'

import AdminUserGroupsPage from './AdminUserGroupsPage.vue'

/** Holds mutable query and mutation state shared by page tests. */
const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(async () => undefined),
  setQueryData: vi.fn(),
  mutationPending: undefined as unknown as ReturnType<typeof ref<boolean>>,
  queryData: undefined as unknown as ReturnType<typeof ref<unknown>>,
  queryError: undefined as unknown as ReturnType<typeof ref<boolean>>,
  queryPending: undefined as unknown as ReturnType<typeof ref<boolean>>,
  refetch: vi.fn(async () => undefined),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en' },
    t: (key: string, params?: unknown) => params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))
vi.mock('@/entities/user-group/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/user-group/api')>()
  return { ...actual, listUserGroups: vi.fn(), updateUserGroupPermissions: vi.fn() }
})
vi.mock('@tanstack/vue-query', () => ({
  useQuery: vi.fn((options: { queryFn: () => unknown }) => {
    void options.queryFn()
    return { data: state.queryData, isError: state.queryError, isPending: state.queryPending, refetch: state.refetch }
  }),
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries, setQueryData: state.setQueryData }),
  useMutation: vi.fn((options: {
    mutationFn: (input: unknown) => Promise<unknown>
    onError?: (error: unknown, input: unknown) => unknown
    onSuccess?: (result: unknown, input: unknown) => unknown
  }) => ({
    isPending: state.mutationPending,
    mutate: vi.fn((input: unknown) => {
      state.mutationPending.value = true
      void options.mutationFn(input)
        .then((result) => options.onSuccess?.(result, input))
        .catch((error) => options.onError?.(error, input))
        .finally(() => { state.mutationPending.value = false })
    }),
  })),
}))

const data: UserGroupListResponse = {
  groups: [
    { key: 'guest', name: 'Guest', description: 'Guest group', builtin: true, editable: false, permissions: [], updatedAt: 'guest-v1' },
    { key: 'user', name: 'User', description: 'User group', builtin: true, editable: true, permissions: ['short_link:read_own'], updatedAt: 'user-v1' },
    { key: 'admin', name: 'Admin', description: 'Admin group', builtin: true, editable: true, permissions: ['admin:access'], updatedAt: 'admin-v1' },
  ],
  permissions: [
    { key: 'short_link:create', category: 'short_link_basic', protected: false },
    { key: 'short_link:read_own', category: 'short_link_basic', protected: false },
    { key: 'admin:access', category: 'administration', protected: true },
  ],
  presets: [
    { key: 'restricted', applicableGroups: ['user', 'admin'], permissions: [] },
    { key: 'basic', applicableGroups: ['user', 'admin'], permissions: ['short_link:create'] },
    { key: 'standard', applicableGroups: ['user', 'admin'], permissions: ['short_link:create', 'short_link:read_own'] },
  ],
}

const stubs = {
  VAlert: { template: '<div role="alert"><slot /><slot name="append" /></div>' },
  VBtn: { props: ['disabled', 'loading'], emits: ['click'], template: '<button v-bind="$attrs" :disabled="disabled || loading" @click="$emit(\'click\')"><slot /></button>' },
  VCheckbox: { props: ['disabled', 'label', 'modelValue'], emits: ['update:modelValue'], template: '<label><input type="checkbox" :aria-label="label" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />{{ label }}</label>' },
  VProgressLinear: { template: '<div role="progressbar" />' },
  VSelect: { props: ['disabled', 'items', 'label', 'modelValue'], emits: ['update:modelValue'], template: '<select :aria-label="label" :disabled="disabled" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option value="" /><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>' },
  VTab: { props: ['value'], emits: ['click'], template: '<button role="tab" :data-value="value" @click="$emit(\'click\')"><slot /></button>' },
  VTabs: { props: ['modelValue'], emits: ['update:modelValue'], template: '<div role="tablist" @click="$emit(\'update:modelValue\', $event.target.dataset.value)"><slot /></div>' },
}

/** Mounts the user-group administration page with controlled component stubs. */
function mountPage() {
  return render(AdminUserGroupsPage, { global: { stubs } })
}

beforeEach(() => {
  state.mutationPending = ref(false)
  state.queryData = ref<unknown>(data)
  state.queryError = ref(false)
  state.queryPending = ref(false)
  state.invalidateQueries.mockClear()
  state.setQueryData.mockClear()
  state.setQueryData.mockImplementation((_queryKey: unknown, updater: (current: UserGroupListResponse | undefined) => unknown) => {
    updater(data)
    updater(undefined)
  })
  state.refetch.mockReset()
  state.refetch.mockResolvedValue(undefined)
  vi.mocked(useMutation).mockClear()
  vi.mocked(listUserGroups).mockReset()
  vi.mocked(listUserGroups).mockResolvedValue(data)
  vi.mocked(updateUserGroupPermissions).mockReset()
})

describe('AdminUserGroupsPage', () => {
  it('renders loading, read failure, and empty states', async () => {
    state.queryPending.value = true
    const loading = mountPage()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    loading.unmount()

    state.queryPending.value = false
    state.queryError.value = true
    state.queryData.value = undefined
    const failed = mountPage()
    expect(screen.getByText('userGroups.loadFailed')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'userGroups.retry' }))
    expect(state.refetch).toHaveBeenCalledOnce()
    failed.unmount()

    state.queryError.value = false
    state.queryData.value = { ...data, groups: [] }
    const empty = mountPage()
    expect(screen.getByText('userGroups.empty')).toBeTruthy()
    empty.unmount()

    state.queryData.value = undefined
    mountPage()
    expect(screen.getByText('userGroups.empty')).toBeTruthy()
  })

  it('renders three tabs and preserves independent drafts across group switches', async () => {
    mountPage()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))
    await fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    expect((screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement).checked).toBe(true)
  })

  it('resets a dirty draft when its server version changes', async () => {
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))
    state.queryData.value = {
      ...data,
      groups: data.groups.map((group) => group.key === 'admin'
        ? { ...group, updatedAt: 'admin-v2' }
        : group),
    }
    await nextTick()

    expect((screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('applies a preset locally, disables unchanged saves, and submits the complete draft', async () => {
    vi.mocked(updateUserGroupPermissions).mockResolvedValue({ group: { ...data.groups[1], permissions: ['short_link:create'], updatedAt: 'user-v2' } })
    mountPage()
    expect(useMutation).toHaveBeenCalledWith(expect.objectContaining({ retry: false }))
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))

    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'basic')
    expect(updateUserGroupPermissions).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))

    await waitFor(() => expect(updateUserGroupPermissions).toHaveBeenCalledWith({
      groupKey: 'user', permissions: ['short_link:create'], expectedUpdatedAt: 'user-v1',
    }))
    await waitFor(() => expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin-user-groups'] }))
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
    expect(screen.getByText('userGroups.saveSuccess')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    expect(screen.queryByText('userGroups.saveSuccess')).toBeNull()
  })

  it('locks controls while saving', async () => {
    state.mutationPending.value = true
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    expect((screen.getByLabelText('userGroups.preset') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getAllByRole('checkbox').every((checkbox) => (checkbox as HTMLInputElement).disabled)).toBe(true)
  })

  it('fails safely when a selected preset disappears during a catalog refresh', async () => {
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    const preset = screen.getByLabelText('userGroups.preset') as HTMLSelectElement
    state.queryData.value = { ...data, presets: [] }
    preset.value = 'basic'
    preset.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(screen.getByText('userGroups.saveFailed')).toBeTruthy()
    expect(updateUserGroupPermissions).not.toHaveBeenCalled()
  })

  it('fails safely when a permission definition disappears during a catalog refresh', async () => {
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    const checkbox = screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement
    state.queryData.value = { ...data, permissions: [] }
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()

    expect(screen.getByText('userGroups.saveFailed')).toBeTruthy()
    expect(updateUserGroupPermissions).not.toHaveBeenCalled()
  })

  it('does not submit when an immutable group emits a stale save event', async () => {
    mountPage()
    const save = screen.getByRole('button', { name: 'userGroups.save' })
    save.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(screen.getByText('userGroups.saveFailed')).toBeTruthy()
    expect(updateUserGroupPermissions).not.toHaveBeenCalled()
  })

  it('reloads server-changed drafts without retrying the conflicting mutation', async () => {
    vi.mocked(updateUserGroupPermissions).mockRejectedValue(new ApiClientError(USER_GROUP_PERMISSION_CONFLICT_CODE, 'Permission conflict'))
    state.refetch.mockImplementation(async () => {
      state.queryData.value = {
        ...data,
        groups: data.groups.map((group) => {
          if (group.key === 'user') {
            return { ...group, permissions: ['short_link:create'], updatedAt: 'user-v2' }
          }
          if (group.key === 'admin') {
            return { ...group, updatedAt: 'admin-v2' }
          }
          return group
        }),
      }
    })
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'restricted')
    await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))

    await waitFor(() => expect(screen.getByText('userGroups.conflict')).toBeTruthy())
    expect(state.refetch).toHaveBeenCalledOnce()
    expect(updateUserGroupPermissions).toHaveBeenCalledOnce()
    expect((screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('userGroups.preset') as HTMLSelectElement).value).toBe('')

    await fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    expect((screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('userGroups.dataStale')).toBeTruthy()
  })

  it('shows a non-conflict save failure without refetching', async () => {
    vi.mocked(updateUserGroupPermissions).mockRejectedValue(new Error('failed'))
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'restricted')
    await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))

    await waitFor(() => expect(screen.getByText('userGroups.saveFailed')).toBeTruthy())
    expect(state.refetch).not.toHaveBeenCalled()
  })

  it('keeps conflict feedback when the refreshed target group is unavailable', async () => {
    vi.mocked(updateUserGroupPermissions).mockRejectedValue(new ApiClientError(USER_GROUP_PERMISSION_CONFLICT_CODE, 'Permission conflict'))
    state.refetch.mockImplementation(async () => {
      state.queryData.value = { ...data, groups: data.groups.filter(({ key }) => key !== 'user') }
    })
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'restricted')
    await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))

    await waitFor(() => expect(screen.getByText('userGroups.conflict')).toBeTruthy())
    expect(updateUserGroupPermissions).toHaveBeenCalledOnce()
  })

  it('keeps conflict feedback when a successful refresh returns no catalog data', async () => {
    vi.mocked(updateUserGroupPermissions).mockRejectedValue(new ApiClientError(USER_GROUP_PERMISSION_CONFLICT_CODE, 'Permission conflict'))
    state.refetch.mockImplementation(async () => {
      state.queryData.value = undefined
    })
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'restricted')
    await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))

    await waitFor(() => expect(screen.getByText('userGroups.conflict')).toBeTruthy())
    expect(state.refetch).toHaveBeenCalledOnce()
    expect(updateUserGroupPermissions).toHaveBeenCalledOnce()
  })

  it('keeps the stale conflict draft locked when reloading latest state fails', async () => {
    vi.mocked(updateUserGroupPermissions).mockRejectedValue(new ApiClientError(USER_GROUP_PERMISSION_CONFLICT_CODE, 'Permission conflict'))
    state.refetch.mockImplementation(() => {
      queueMicrotask(() => {
        state.queryData.value = {
          ...data,
          groups: data.groups.map((group) => group.key === 'admin'
            ? { ...group, updatedAt: 'admin-v2' }
            : group),
        }
      })
      state.queryError.value = true
      return Promise.reject(new Error('reload failed'))
    })
    mountPage()
    await fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    await fireEvent.click(screen.getByLabelText('userGroups.permissions.short_link:create.label'))
    await fireEvent.click(screen.getByRole('tab', { name: 'User' }))
    await fireEvent.update(screen.getByLabelText('userGroups.preset'), 'basic')
    await fireEvent.click(screen.getByRole('button', { name: 'userGroups.save' }))

    await waitFor(() => expect(screen.getByText('userGroups.conflictReloadFailed')).toBeTruthy())
    expect(state.refetch).toHaveBeenCalledWith({ throwOnError: true })
    expect((screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('button', { name: 'userGroups.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(updateUserGroupPermissions).toHaveBeenCalledOnce()

    await fireEvent.click(screen.getByRole('tab', { name: 'Admin' }))
    expect((screen.getByLabelText('userGroups.permissions.short_link:create.label') as HTMLInputElement).checked).toBe(true)
  })
})
