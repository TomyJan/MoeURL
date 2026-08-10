# v0.3.0 受保护短链访问范围

## 目标

v0.3.0 在 v0.2.0 的中间页、过期时间和访问配置基础上，增加一个可生产使用的受保护短链访问闭环：短链所有者可以设置访问密码，访问者在最终跳转前通过密码页解锁，并在短时间内复用授权结果。

本版本选择访问密码作为下一个跨模块版本，是因为它直接承接现有访问配置和 `/go/{slug}` 流程，同时必须把哈希、失败限流、短期授权和多实例一致性一起交付，避免只增加一个不安全的密码字段。

## 必须实现

- 新增 `short_link:set_password` 权限；内置 `user` 和 `admin` 默认拥有，`guest` 不拥有。
- 创建和编辑短链支持显式设置或清除访问密码；未提供密码字段时保留现有配置。
- 访问密码使用 Argon2id 哈希保存，密码原文不写入数据库、日志、事件或 API 响应。
- 访问密码长度为 8 至 128 个 Unicode 字符；密码值按原文校验，不自动去除首尾空格。
- 密码保护独立于 `direct` 和 `intermediate` 模式；保护短链首次访问统一进入 `/go/{slug}` 密码页。
- 公开预览返回既有 `redirectMode` 和 `requiresPassword` 布尔值，不返回哈希或目标 URL。
- 解锁成功后签发 15 分钟短期访问授权；授权令牌使用不可逆哈希存储，并通过短链路径作用域的 `HttpOnly`、生产环境 `Secure`、`SameSite=Lax` Cookie 传递。
- 同一短链 15 分钟内连续 5 次密码失败后进入 15 分钟数据库一致限流窗口；成功解锁清零失败计数。限流按短链聚合，不依赖未经验证的代理 IP 头。
- `/go/{slug}/continue` 每次重新检查短链状态、软删除、过期时间、密码授权和跳转模式；授权缺失或失效时不得返回目标跳转。
- 解锁失败、限流和被保护状态均不记录成功访问量；只有最终目标 `302` 响应成功写出后记录一次 `redirect_response_sent`。
- 创建面板和访问设置对话框按权限展示密码配置；无权限用户不能通过 API 绕过后端校验。
- 公共密码页覆盖加载、密码输入、错误、限流、成功解锁和移动端布局状态。

## API 与路由

```text
POST /api/v1/short-link/create
  password: { mode: "set", value: string } | { mode: "never" }

POST /api/v1/short-link/update
POST /api/v1/admin/short-link/update
  password 字段未提供时保持原值；显式 never 清除密码。

GET /api/v1/public/short-link/preview?slug=...
  data.requiresPassword: boolean
  data.redirectMode: "direct" | "intermediate"

GET /go/{slug}/preview
  同源公共页面预览；仅用于接收 `/go/{slug}` 作用域 Cookie，携带有效授权时返回 `requiresPassword: false`

POST /go/{slug}/unlock
  request: { password: string }
  success: HTTP 200, code 0，并设置短链路径作用域授权 Cookie

GET /{slug}
  受保护短链 → 302 /go/{slug}?reason=password

GET /go/{slug}/continue
  需要有效授权时 → 目标 302；否则 → 302 /go/{slug}?reason=password
```

业务错误继续使用 HTTP 200 和数字 `code`；公开访问状态继续使用适合浏览器的跳转或 HTTP 错误响应。解锁接口不区分不存在、禁用和过期短链的密码错误，避免密码状态枚举。

## 数据与安全边界

- `short_link.password_hash` 可空；为空表示未设置访问密码。
- `password_failed_attempts`、`password_window_started_at` 和 `password_blocked_until` 保存在短链行中，解锁失败更新在 `FOR UPDATE` 事务内完成。
- `short_link_access_grant` 只保存短链 ID、令牌哈希、签发时间和过期时间；短链软删除后访问查询自然失效。
- 密码变更通过 `password_updated_at` 使旧授权立即失效，不依赖异步清理。
- 授权 Cookie 不携带目标 URL、用户身份或密码；Cookie 名称固定，Path 绑定到 `/go/{slug}`。

## 暂不实现

- `password_failed` 和 `password_verified` 非统计审计事件；本版本不落库这两类事件。
- 访问密码分享、密码轮换历史和批量密码操作。
- 按 IP、设备指纹或代理头区分的限流；本版本采用短链级数据库限流，后续如需要再设计可信代理配置。
- OIDC、确认页跳转、最大访问次数、标签、批量导入导出、二维码样式和权限预设。
- 密码找回、访问者账号体系或持久化访问明细。

## 完成标准

- migration 可升级、回滚且不暴露既有短链密码字段；SQLC 生成代码无手工漂移。
- 有权限用户可以创建、修改和清除密码，无权限用户收到统一业务错误。
- 正确密码可获得 15 分钟授权；错误密码在第五次后触发限流，成功后清零。
- 旧授权在密码修改后失效，禁用、软删除和过期短链不能跳转或计入访问量。
- 公开预览展示 `redirectMode` 与 `requiresPassword`，列表只展示 `passwordEnabled` 布尔状态；两者都不返回哈希或目标 URL。
- 前端单元测试、后端测试、覆盖率、lint、类型检查、构建和 Playwright E2E 全部通过；生产构建遵循既有分块警告基线。
