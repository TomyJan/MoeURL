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
      createUser: '创建用户',
      notFound: '页面不存在',
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
      createUser: 'Create user',
      notFound: 'Page not found',
    },
  },
}

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages,
})
