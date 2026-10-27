import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { Toaster } from 'vue-sonner'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { i18n } from '@/app/i18n'
import { nextVersion, response, version } from '@/test/group-default'
import { createDeferred } from '@/test/deferred'
import AdminUserGroupsPage from './AdminUserGroupsPage.vue'

let client: QueryClient
afterEach(() => { cleanup(); client.clear(); i18n.global.locale.value = 'zh-CN'; vi.unstubAllGlobals() })

it.each(['zh-CN', 'en'] as const)('distinguishes reload failures from actual permission conflicts in %s', async (locale) => {
  await verifyFeedback(locale, 'manual')
})

it.each(['zh-CN', 'en'] as const)('does not report a conflict after a committed permission save in %s', async (locale) => {
  await verifyFeedback(locale, 'committed')
})

it.each(['zh-CN', 'en'] as const)('retains the conflict diagnosis when a rejected permission save cannot reload in %s', async (locale) => {
  await verifyFeedback(locale, 'conflict')
})

it.each(['zh-CN', 'en'] as const)('does not publish a late conflict reload notification to another login in %s', async (locale) => {
  await verifyFeedback(locale, 'late-conflict')
})

/** Exercises real parent queries, translations and notifications against explicit HTTP outcomes. */
async function verifyFeedback(locale: 'zh-CN' | 'en', mode: 'manual' | 'committed' | 'conflict' | 'late-conflict') {
  i18n.global.locale.value = locale
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const user = { id: 'A', username: 'admin', nickname: '', group: 'admin', permissions: ['admin:access', 'domain:manage'] }
  client.setQueryData(['auth', 'me'], { user })
  const groups = ['guest', 'user', 'admin'].map((key) => ({ key, name: key, description: '', builtin: true, editable: key !== 'guest', permissions: [] as string[], updatedAt: version }))
  const writes: Array<Record<string, unknown>> = []
  const authReadStarted = createDeferred<void>()
  const authResult = createDeferred<Response>()
  let offline = false
  let listOwner = 'A'
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    if (path === '/api/v1/auth/me') {
      if (mode === 'late-conflict') { authReadStarted.resolve(); return authResult.promise }
      return response({ user })
    }
    if (path === '/api/v1/admin/user-group/list') {
      if (offline) throw new Error('Read connection lost')
      return response({ groups: groups.map((group) => ({ ...group, name: listOwner === 'B' ? `B-${group.name}` : group.name })), permissions: [{ key: 'short_link:create', category: 'short_link_basic', protected: false }], presets: ['restricted', 'basic', 'standard'].map((key) => ({ key, applicableGroups: ['user', 'admin'], permissions: [] })) })
    }
    if (path.startsWith('/api/v1/admin/user-group/domain-default?')) {
      const key = new URL(path, 'https://app.example').searchParams.get('groupKey')!
      return response({ setting: { groupKey: key, domainId: null, updatedAt: groups.find((group) => group.key === key)!.updatedAt, editable: key !== 'guest' }, candidates: [] })
    }
    if (path === '/api/v1/admin/user-group/update-permissions') {
      const input = JSON.parse(init.body as string)
      writes.push(input); offline = true
      if (mode === 'conflict' || mode === 'late-conflict') return response(null, 300202)
      const target = groups.find((group) => group.key === input.groupKey)!
      target.permissions = input.permissions; target.updatedAt = nextVersion
      return response({ group: target })
    }
    throw new Error(`Unexpected request ${path}`)
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('visualViewport', Object.assign(new window.EventTarget(), { width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1 }))
  const Host = defineComponent({ setup: () => () => [h(AdminUserGroupsPage), h(Toaster)] })
  render(Host, { global: { plugins: [i18n, [VueQueryPlugin, { queryClient: client }], createVuetify({ components, directives })] } })
  await fireEvent.click(await screen.findByRole('tab', { name: 'user' }))
  const checkbox = await screen.findByRole('checkbox')
  await waitFor(() => expect(checkbox).toHaveProperty('disabled', false))
  if (mode === 'manual') {
    offline = true
    await fireEvent.click(screen.getByRole('button', { name: i18n.global.t('groupDefault.reloadPermissions') }))
  } else {
    await fireEvent.click(checkbox)
    await fireEvent.click(screen.getByRole('button', { name: i18n.global.t('userGroups.save') }))
  }
  if (mode === 'late-conflict') {
    await authReadStarted.promise
    const other = { ...user, id: 'B', username: 'other-admin' }
    listOwner = 'B'
    offline = false
    client.setQueryData(['auth', 'me'], { user: other })
    await fireEvent.click(await screen.findByRole('tab', { name: 'B-user' }))
    await waitFor(() => expect(screen.getByRole('checkbox')).toHaveProperty('disabled', false))
    authResult.resolve(response({ user }))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(client.getQueryData(['auth', 'me'])).toEqual({ user: other })
    expect(screen.queryByText(i18n.global.t('userGroups.conflict'))).toBeNull()
    expect(screen.queryByText(i18n.global.t('userGroups.conflictReloadFailed'))).toBeNull()
    expect(screen.queryByText(i18n.global.t('groupDefault.reloadFailed'))).toBeNull()
    expect(writes).toEqual([{ groupKey: 'user', permissions: ['short_link:create'], expectedUpdatedAt: version }])
    return
  }
  const expected = mode === 'conflict' ? 'userGroups.conflictReloadFailed' : 'groupDefault.reloadFailed'
  await screen.findByText(i18n.global.t(expected))
  expect(screen.queryByText(i18n.global.t(mode === 'conflict' ? 'groupDefault.reloadFailed' : 'userGroups.conflictReloadFailed'))).toBeNull()
  expect(screen.getByRole('checkbox')).toHaveProperty('disabled', true)
  expect(groups.find((group) => group.key === 'user')).toMatchObject({ permissions: mode === 'committed' ? ['short_link:create'] : [], updatedAt: mode === 'committed' ? nextVersion : version })
  expect(writes).toEqual(mode === 'manual' ? [] : [{ groupKey: 'user', permissions: ['short_link:create'], expectedUpdatedAt: version }])
}
