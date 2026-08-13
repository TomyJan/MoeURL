# v0.4.0 确认页访问范围

## 目标

v0.4.0 在 v0.3.0 的公共访问页、访问密码和短期授权基础上，增加确认页跳转闭环。短链所有者可以选择确认页模式，访问者查看目标主机名后必须主动点击继续，服务端重新检查全部访问条件后才返回目标跳转。

本版本只扩展跳转模式，不把确认页包装成安全授权或风险审核能力。访问密码仍是访问授权边界，确认页只提供明确的访问者确认步骤。

## 必须实现

- 新增 `confirmation` 跳转模式和 `short_link:use_confirmation` 权限；内置 `user`、`admin` 默认拥有，`guest` 不拥有。
- 创建和编辑短链支持在 `direct`、`intermediate`、`confirmation` 之间切换，并按目标模式执行后端权限校验。
- 既有短链继续保持原跳转模式，数据库迁移只扩展 `redirect_mode` 约束，不新增无关字段。
- 确认页复用 `/go/{slug}`，展示短码、目标主机名、可选过期时间、继续访问和返回首页操作，不返回或渲染完整目标 URL。
- 公开预览显式返回 `redirectMode`，不再通过倒计时字段推断确认页；只有 `intermediate` 返回 3 至 10 秒倒计时，其余模式返回 `null`。
- 无密码的 `confirmation` 短链从 `/{slug}` 进入确认页；受密码保护的短链先完成现有密码解锁，再按实际模式进入直接跳转、中间页倒计时或确认页。
- `/go/{slug}/continue` 每次重新检查短链状态、软删除、过期时间、密码授权和跳转模式；无密码的 `direct` 短链不能借该路由绕过规范入口。
- `/go/{slug}/continue` 遇到基础设施错误时回到公共访问页，重新读取最小预览并等待访问者重试；不得以自动重试形成跳转循环，也不得向前端返回目标 URL。
- 确认动作可以发出非统计的 `confirmation_clicked` 事件，但不持久化为访问量；只有最终目标 `302` 成功写出后记录一次 `redirect_response_sent`。
- 创建面板、访问设置、短链列表和公共访问页补齐中英文文案、权限状态、桌面与移动布局。
- E2E 从真实 `/{slug}` 入口覆盖无密码确认页、受密码保护确认页、主动继续、访问条件二次检查和访问量口径，并在 `1280 x 720` 与 `390 x 800` 视口验证布局。

## API 与路由

```text
POST /api/v1/short-link/create
POST /api/v1/short-link/update
POST /api/v1/admin/short-link/update
  redirectMode: "direct" | "intermediate" | "confirmation"

GET /go/{slug}/preview
  data.slug: string
  data.targetHost: string
  data.redirectMode: "direct" | "intermediate" | "confirmation"
  data.intermediateDelaySeconds: 3..10 或 null
  data.expiresAt: string 或 null

GET /{slug}
  confirmation → 302 /go/{slug}
  受保护短链 → 302 /go/{slug}?reason=password

GET /go/{slug}/continue
  confirmation 且访问条件有效 → 目标 302
  受保护短链需要有效授权
  无密码 direct → 302 /go/{slug}?reason=not-interactive
  基础设施错误 → 302 /go/{slug}?reason=continue-failed
```

旧的 `/api/v1/public/short-link/preview` 继续作为弃用兼容入口，返回与同源预览相同的最小字段；新前端只使用 `/go/{slug}/preview`。

## 数据与权限边界

- `short_link.redirect_mode` 的允许值扩展为 `direct`、`intermediate`、`confirmation`。
- migration 升级不改写既有数据；回滚时将 `confirmation` 记录降级为 `direct`，再恢复旧约束，保证 Down 可执行。
- `short_link:use_confirmation` 只控制创建和编辑确认页模式，不控制公开访问者点击继续。
- 修改为 `direct` 不需要确认页或中间页能力；修改为 `intermediate` 和自定义倒计时要求 `short_link:use_intermediate`；修改为 `confirmation` 要求 `short_link:use_confirmation`。
- 前端权限控制只负责体验，后端权限服务按当前用户 `GroupKey` 从数据库读取当前用户组权限，并对一次业务操作使用同一份权限快照执行最终校验。
- 确认页不得接收目标 URL、确认令牌或客户端声明的访问状态；目标地址只由服务端最终跳转响应提供。

## 暂不实现

- 最大访问次数、访问额度预占、一次性链接或并发额度扣减。
- 风险链接识别、强制确认策略、黑白名单或外部安全数据源。
- 自定义确认文案、确认页模板、广告、图片背景或 Open Graph 配置。
- 权限预设、用户组编辑、自定义用户组或域名管理。
- 标签、OIDC、批量导入导出、Webhook 和访问明细。

## 完成标准

- migration 可升级、回滚，SQLC 生成代码无手工漂移，既有 direct/intermediate 数据保持不变。
- 有权限用户可以创建和编辑确认页短链，无权限用户收到统一业务错误；切回 direct 不依赖高级模式权限。
- 确认页不自动跳转、不暴露完整目标 URL，只有主动继续才请求最终跳转。
- 密码与三种跳转模式组合行为明确，旧授权失效、禁用、软删除和过期检查继续有效。
- 确认页进入和点击不增加访问量，最终目标 `302` 成功写出后只增加 1 次。
- 后端测试、前端测试、覆盖率、lint、类型检查、生产构建和 Playwright E2E 全部通过。
