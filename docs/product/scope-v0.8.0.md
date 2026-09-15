# v0.8.0 多域名管理范围

状态：功能实现与分阶段本地验证已有记录，当前提交的全量 Playwright 与 Compose smoke 待复验；目标 CI、race、安全扫描、真实 DNS/TLS、隔离恢复与生产发布验收待证据。历史本地结果不等于当前提交的门禁通过或发布批准。

## 目标

管理员可以管理多个短链访问域名、授权内置用户组并设置一个全局默认域名；用户创建短链时可以选择获授权的启用域名。短链保存的域名不随默认值变化，公开访问必须从其所属域名进入。v0.8.0 在现有 `domain_id`、用户组权限与单机 Compose + 外部 TLS 反向代理基础上交付这一闭环。

## 必须实现

- 管理员列出、创建、编辑、启停、设默认和删除短链域名。输入使用根 Origin；生产仅接受 HTTPS，开发仅对回环地址允许 HTTP。旧裸域名值保持兼容，不批量改写已发布 URL。
- 只能授权内置 `user`、`admin` 组；`guest` 不获创建能力。现有默认域名在升级时授权这两个组，新初始化同样写入授权关系。
- 保留 `domain:use_default`：省略 `domainId` 使用当前默认域名，且必须同时有权限和组授权。新增可配置的 `domain:use_assigned`：显式选择时也要求权限与授权交集。新增受保护的 `domain:manage`：固定授予 `admin`，管理服务还检查 `admin:access`。
- 全局默认域名始终启用；停用或删除默认域名前必须先切换。任何短链（包括软删除短链）引用的域名不能删除或修改地址；其他设置可更新。
- 管理写入使用 `expectedUpdatedAt` 乐观并发，冲突不静默覆盖。设默认与同步 `site.default_short_link_domain` 镜像使用同一事务。
- 旧短链继续使用保存的域名构建 URL。`/{slug}`、公开预览、路径作用域预览、解锁及继续访问都要求真实请求 `Host` 与保存的域名相符，且每次重新检查启用状态；停用按不存在处理，重启后恢复。不得信任 `X-Forwarded-Host` 或 `X-Forwarded-Proto` 扩大访问范围。
- 管理页与短链创建选择器支持中英双语、桌面和移动端，并覆盖加载、错误、空列表、保存、冲突、确认与权限变化状态。默认情况下旧创建请求仍不带 `domainId`。

## 数据和接口

- Goose migration 新增 `domain_user_group`，回填升级前默认域名授权与新增权限，Down 保留旧域名及短链；用户组权限在升级后被修改时，不自动撤回该组的新增权限。
- 新增 `GET /api/v1/domain/available` 和 `GET /api/v1/admin/domain/list`；新增 `POST /api/v1/admin/domain/create`、`update`、`set-default`、`delete`。
- `POST /api/v1/short-link/create` 接受可选 UUID `domainId`；不提供时维持默认域名语义。现有短链的 `domain_id` 不通过更新接口改变。

## 暂不实现

- 系统访问域名管理、个人及用户组默认域名、域名排序兜底、用户自带域名及域名所有权证明。
- 按域名复用短码、已发布短链迁移、自动 DNS/TLS、证书管理或边缘代理配置自动化。
- 自定义用户组、`guest` 短链创建、跳转模板和域名审核。

## 升级与验收

短码仍全局唯一，旧数据不更改 `domain.host` 或 `short_link.domain_id`。升级前必须核查已登记域名与实际公开 Host、端口及代理保留 Host 的设置：以前可经别名访问的短链在新版本会被拒绝。每个启用域名均须由部署者配置 DNS、HTTPS 证书与到同一 App 的路由。

完成标准包括迁移 Up/Down/再次 Up、权限交集和事务并发、所有公开路径的 Host/启停回归、真实双 Host E2E、后端和前端门禁、SQLC 零漂移及部署检查。目标 CI、race、安全扫描、真实 DNS/TLS 与生产恢复演练的证据独立记录；缺失时保持待验证。设计细节见 [多域名管理设计](../superpowers/specs/2026-09-14-v0.8.0-multi-domain-design.md)。
