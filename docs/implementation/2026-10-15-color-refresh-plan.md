# 配色更新实施计划

目标：按 [鸢尾蓝与薄荷青设计](../specs/2026-10-15-color-refresh-design.md) 更新现有界面，保留布局与交互。

本轮在既有授权的 `master` 工作区内联执行，不创建分支，不推送。

- [x] 扩展 `web/src/app/vuetify.test.ts` 的现有对比度检查：补齐次级按钮、语义文字及柔和表面，运行 `pnpm test src/app/vuetify.test.ts` 确认旧配色不足。
- [x] 更新 `web/src/app/vuetify.ts` 的浅深色和共享变量；侧栏及 `theme.css` 表头继续引用 token。更新首页、登录页、概览的色彩层次，保留结构与行为。
- [x] 更新 `web/index.html`、`web/public/manifest.webmanifest` 与 SVG 图标颜色，保持 PWA 原有行为。
- [x] 执行 `pnpm test:coverage`、`pnpm lint`、`pnpm build`（包含 `vue-tsc --noEmit` 类型检查）；实际预览运行 88 组页面检查及界面 E2E，检查菜单、浅深色和手机截图。
- [x] 更新设计入口与技术基线，检查差异，记录 [本地验收与限制](2026-10-15-color-refresh-acceptance.md)。

提交边界：主题、页面样式与 PWA 色彩作为一个界面提交；规格、技术基线与验收记录作为一个文档提交。提交后重新构建并核对版本链接，不推送。
