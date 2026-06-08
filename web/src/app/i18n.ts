import { createI18n } from 'vue-i18n'

export const messages = {
  'zh-CN': {
    nav: {
      home: '首页',
      links: '我的短链',
      admin: '管理',
      users: '用户',
      login: '登录',
      logout: '退出登录',
    },
    page: {
      home: '创建并管理你的短链',
      setup: '初始化 MoeURL',
      login: '登录',
      links: '我的短链',
      adminLinks: '全站短链',
      adminUsers: '用户管理',
      createUser: '创建用户',
      notFound: '页面不存在',
    },
    filter: {
      status: '状态筛选',
      all: '全部',
      active: '启用',
      disabled: '禁用',
    },
    adminUsers: {
      createUser: '创建用户',
      loadFailed: '加载失败',
      noUsers: '暂无用户',
      total: '共 {total} 个用户',
      paginationNotice: '当前仅显示前 20 个用户，分页将在后续版本实现。',
      headers: {
        username: '账号',
        nickname: '昵称',
        group: '用户组',
        status: '状态',
        type: '类型',
        createdAt: '创建时间',
        actions: '操作',
      },
      labels: {
        nickname: '昵称',
        newPassword: '新密码',
      },
      actions: {
        enable: '启用',
        disable: '禁用',
      },
      saveNickname: '保存昵称',
      resetPassword: '重置密码',
      status: {
        active: '启用',
        disabled: '禁用',
      },
      type: {
        builtin: '内置',
        normal: '普通',
      },
      passwordRequired: '请输入新密码',
      passwordMinLength: '密码至少需要 8 个字符',
    },
  },
  en: {
    nav: {
      home: 'Home',
      links: 'My Links',
      admin: 'Admin',
      users: 'Users',
      login: 'Sign in',
      logout: 'Sign out',
    },
    page: {
      home: 'Create and manage your short links',
      setup: 'Set up MoeURL',
      login: 'Sign in',
      links: 'My links',
      adminLinks: 'All links',
      adminUsers: 'Users',
      createUser: 'Create user',
      notFound: 'Page not found',
    },
    filter: {
      status: 'Status',
      all: 'All',
      active: 'Active',
      disabled: 'Disabled',
    },
    adminUsers: {
      createUser: 'Create user',
      loadFailed: 'Failed to load users',
      noUsers: 'No users',
      total: '{total} users',
      paginationNotice: 'Showing first 20 users; pagination is planned for a future release.',
      headers: {
        username: 'Username',
        nickname: 'Nickname',
        group: 'Group',
        status: 'Status',
        type: 'Type',
        createdAt: 'Created at',
        actions: 'Actions',
      },
      labels: {
        nickname: 'Nickname',
        newPassword: 'New password',
      },
      actions: {
        enable: 'Enable',
        disable: 'Disable',
      },
      saveNickname: 'Save nickname',
      resetPassword: 'Reset password',
      status: {
        active: 'Active',
        disabled: 'Disabled',
      },
      type: {
        builtin: 'Built-in',
        normal: 'Normal',
      },
      passwordRequired: 'Enter a new password',
      passwordMinLength: 'Password must be at least 8 characters',
    },
  },
}

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages,
})
