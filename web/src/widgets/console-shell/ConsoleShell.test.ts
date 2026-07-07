import { fireEvent, render, screen, within } from '@testing-library/vue'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import ConsoleShell from './ConsoleShell.vue'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  logoutMutate: vi.fn(),
  routerPush: vi.fn(),
  queryResult: {},
  routePath: '/link',
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('vuetify/framework', () => ({
  useTheme: () => ({
    global: {
      name: ref('moeurlLight'),
    },
  }),
}))

vi.mock('vue-router', () => ({
  RouterLink: { props: ['to'], template: '<a :data-to="to"><slot /></a>' },
  RouterView: { template: '<div data-testid="router-view" />' },
  useRoute: () => ({
    path: state.routePath,
  }),
  useRouter: () => ({
    push: state.routerPush,
  }),
}))

vi.mock('@/entities/auth/api', () => ({
  logout: vi.fn(),
  me: vi.fn(),
}))

vi.mock('@/entities/short-link/api', () => ({
  createShortLink: vi.fn(),
}))

vi.mock('@tanstack/vue-query', () => ({
  useMutation: vi.fn((options?: { onSuccess?: () => void }) => ({
    data: ref(undefined),
    error: ref(undefined),
    isPending: ref(false),
    mutate: vi.fn(() => {
      state.logoutMutate()
      options?.onSuccess?.()
    }),
  })),
  useQuery: vi.fn(() => state.queryResult),
  useQueryClient: () => ({
    invalidateQueries: state.invalidateQueries,
  }),
}))

function mountShell() {
  return render(ConsoleShell, {
    slots: {
      default: '<section>console content</section>',
    },
    global: {
      stubs: componentStubs,
    },
  })
}

function setCurrentUser(user: {
  username: string
  nickname?: string
  group: string
  permissions: string[]
}) {
  state.queryResult = {
    data: ref({ user }),
    isError: ref(false),
    isPending: ref(false),
  }
}

describe('ConsoleShell', () => {
  beforeEach(() => {
    document.body.style.overflow = ''
    state.invalidateQueries.mockReset()
    state.logoutMutate.mockReset()
    state.routerPush.mockReset()
    state.routePath = '/link'
    setCurrentUser({
      username: 'alice',
      nickname: 'Alice',
      group: 'user',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own'],
    })
  })

  it('renders desktop navigation and account inside the sidebar for regular users', () => {
    const { container } = mountShell()

    expect(container.querySelector('.console-shell__workspace')).toBeTruthy()
    expect(screen.getByText('console content')).toBeTruthy()
    const sidebarUtilities = screen.getByTestId('console-sidebar-utilities')
    expect(within(sidebarUtilities).getByTestId('console-sidebar-home')).toBeTruthy()
    expect(within(sidebarUtilities).getByRole('group', { name: 'preferences.groupLabel' })).toBeTruthy()
    expect(screen.queryByText('short links')).toBeNull()
    expect(screen.getByText('console.nav.workspace')).toBeTruthy()
    expect(screen.getByText('nav.links')).toBeTruthy()
    expect(screen.queryByText('nav.admin')).toBeNull()
    expect(screen.queryByText('nav.users')).toBeNull()
    expect(screen.queryByText('page.createUser')).toBeNull()
    expect(within(screen.getByTestId('console-account')).getByText('Alice')).toBeTruthy()
    expect(screen.getAllByRole('group', { name: 'preferences.groupLabel' }).length).toBeGreaterThan(0)
  })

  it('shows administrator navigation as grouped two-level sections without create-user nav', async () => {
    setCurrentUser({
      username: 'admin',
      nickname: 'Admin',
      group: 'admin',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own', 'admin:access'],
    })

    mountShell()

    expect(screen.getByText('nav.links')).toBeTruthy()
    expect(screen.getByText('nav.overview')).toBeTruthy()
    expect(screen.getAllByText('nav.admin').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'console.nav.userManagement' }).length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('console-nav-primary-item').length).toBeGreaterThan(4)
    expect(screen.getAllByTestId('console-nav-parent-item').length).toBeGreaterThan(0)
    expect(screen.queryByText('nav.users')).toBeNull()
    expect(screen.getAllByTestId('console-nav-planned-badge').length).toBe(3)
    await fireEvent.click(screen.getAllByRole('button', { name: 'console.nav.userManagement' })[0])
    expect(screen.getByText('nav.users')).toBeTruthy()
    expect(screen.getByText('nav.userGroups')).toBeTruthy()
    expect(screen.getAllByTestId('console-nav-child-item').length).toBeGreaterThan(1)
    expect(screen.getAllByTestId('console-nav-planned-badge').length).toBe(4)
    expect(screen.queryByText('page.createUser')).toBeNull()
    expect(screen.getByText('nav.analytics')).toBeTruthy()
    expect(screen.getByText('nav.settings')).toBeTruthy()
  })

  it('expands the matching two-level navigation group for child routes', () => {
    state.routePath = '/admin/user/group'
    setCurrentUser({
      username: 'admin',
      nickname: 'Admin',
      group: 'admin',
      permissions: ['short_link:create', 'domain:use_default', 'short_link:read_own', 'admin:access'],
    })

    mountShell()

    expect(screen.getByText('nav.userGroups')).toBeTruthy()
  })

  it('opens short link creation dialog from the console action', async () => {
    mountShell()

    await fireEvent.click(screen.getAllByText('console.newShortLink')[0])

    expect(screen.getByTestId('console-create-transition')).toBeTruthy()
    expect(screen.getByText('console.createShortLink')).toBeTruthy()
    expect(screen.getByText('shortLinkCreate.submit')).toBeTruthy()
  })

  it('closes overlays from backdrop click and Escape while locking background scroll', async () => {
    mountShell()

    await fireEvent.click(screen.getAllByText('console.newShortLink')[0])
    expect(screen.getByTestId('console-create-transition')).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')

    await fireEvent.click(screen.getByRole('dialog'))
    expect(screen.queryByTestId('console-create-transition')).toBeNull()
    expect(document.body.style.overflow).toBe('')

    await fireEvent.click(screen.getByLabelText('console.openMenu'))
    expect(screen.getByTestId('console-mobile-nav')).toBeTruthy()
    expect(document.body.style.overflow).toBe('hidden')

    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('console-mobile-nav')).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  it('opens mobile navigation from the hamburger button', async () => {
    mountShell()

    expect(screen.queryByTestId('console-mobile-nav')).toBeNull()
    expect(within(screen.getByLabelText('console.openMenu')).getByTestId('console-icon-menu')).toBeTruthy()

    await fireEvent.click(screen.getByLabelText('console.openMenu'))

    expect(screen.getByTestId('console-mobile-nav')).toBeTruthy()
    expect(screen.getByTestId('console-drawer-transition')).toBeTruthy()
    const mobileUtilities = within(screen.getByTestId('console-mobile-nav')).getByTestId('console-mobile-utilities')
    expect(within(mobileUtilities).getByTestId('console-mobile-home')).toBeTruthy()
    expect(within(mobileUtilities).getByRole('group', { name: 'preferences.groupLabel' })).toBeTruthy()
    expect(within(screen.getByTestId('console-mobile-nav')).getByText('nav.links')).toBeTruthy()
  })

  it('opens the mobile account menu and logs out from the topbar avatar', async () => {
    mountShell()

    await fireEvent.click(screen.getByLabelText('console.openAccountMenu'))

    expect(screen.getByTestId('console-mobile-account-menu')).toBeTruthy()
    expect(within(screen.getByTestId('console-mobile-account-menu')).getByText('Alice')).toBeTruthy()

    await fireEvent.click(within(screen.getByTestId('console-mobile-account-menu')).getByText('nav.logout'))

    expect(state.logoutMutate).toHaveBeenCalled()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
    expect(state.routerPush).toHaveBeenCalledWith('/login')
  })

  it('closes the mobile account menu on outside click and Escape', async () => {
    mountShell()

    await fireEvent.click(screen.getByLabelText('console.openAccountMenu'))
    expect(screen.getByTestId('console-mobile-account-menu')).toBeTruthy()

    await fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('console-mobile-account-menu')).toBeNull()

    await fireEvent.click(screen.getByLabelText('console.openAccountMenu'))
    expect(screen.getByTestId('console-mobile-account-menu')).toBeTruthy()

    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('console-mobile-account-menu')).toBeNull()
  })

  it('closes mobile navigation after choosing a route item', async () => {
    mountShell()

    await fireEvent.click(screen.getByLabelText('console.openMenu'))
    await fireEvent.click(within(screen.getByTestId('console-mobile-nav')).getByText('nav.links'))

    expect(screen.queryByTestId('console-mobile-nav')).toBeNull()
  })

  it('logs out from the sidebar account area', async () => {
    mountShell()

    await fireEvent.click(within(screen.getByTestId('console-account')).getByText('nav.logout'))

    expect(state.logoutMutate).toHaveBeenCalled()
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] })
    expect(state.routerPush).toHaveBeenCalledWith('/login')
  })

  it('redirects to login when the current user query fails in the shell', () => {
    state.queryResult = {
      data: ref(undefined),
      isError: ref(true),
      isPending: ref(false),
    }

    mountShell()

    expect(state.routerPush).toHaveBeenCalledWith('/login')
  })

  it('keeps parent expansion visually separate from active child navigation', () => {
    const source = readFileSync('src/widgets/console-shell/ConsoleNavList.vue', 'utf8')

    expect(source).toContain('.console-nav-list__item--parent[aria-expanded="true"]')
    expect(source).not.toContain('.console-nav-list__item--parent[aria-expanded="true"] .console-nav-list__rail')
    expect(source).toContain('.console-nav-list__item.router-link-active .console-nav-list__rail')
    expect(source).toContain('background: color-mix(in srgb, var(--moeurl-surface-strong) 40%, transparent)')
    expect(source).toContain('.console-nav-list__badge')
    expect(source).toContain('background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 14%, transparent)')
  })

  it('rebuilds expanded navigation groups from the current route instead of accumulating old matches', () => {
    const source = readFileSync('src/widgets/console-shell/ConsoleNavList.vue', 'utf8')

    expect(source).toContain('const nextExpandedGroups = new Set<string>()')
    expect(source).toContain('expandedGroups.value = nextExpandedGroups')
  })
})
