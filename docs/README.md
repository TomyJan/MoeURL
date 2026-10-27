# MoeURL 文档中心

最近功能 [v0.25.0 操作审计 CSV](product/scope-v0.25.0.md) 已由 PR #222 合并，其旧合并 CI 的手机 E2E 失败保持历史归属。后继[维护 PR #223](https://github.com/TomyJan/MoeURL/pull/223) 已合并为 `cafacf15`，精确最终 head 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40415038034) 与新合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40421454231) 各 9 成功，实际 CodeRabbit 已覆盖最终变更，无有效未解决问题。恢复证据见[维护验收](implementation/2026-10-27-frontend-security-dependencies-acceptance.md)；尚未正式发布。

当前 [v0.26.0 个人默认域名](product/scope-v0.26.0.md) 本地实现与完整门禁已通过，唯一整审的两项 Important 已在单修复波闭环，远端集成待完成；见[设计](specs/2026-10-27-v0.26.0-personal-default-domain-design.md)、[计划](implementation/v0.26.0-plan.md)、[任务](implementation/v0.26.0-tasks.md)和[验收](implementation/v0.26.0-acceptance.md)。

[v0.25.0 操作审计 CSV 导出](product/scope-v0.25.0.md) 已合并按 UTC 日期与操作者／资源／动作筛选的完整元数据下载，最多 1000 条／8 MiB，新增受保护管理员权限并保持业务值与秘密隔离。设计与逐候选证据见[规格](specs/2026-10-27-v0.25.0-audit-export-design.md)、[计划](implementation/v0.25.0-plan.md)、[任务](implementation/v0.25.0-tasks.md)及[验收](implementation/v0.25.0-acceptance.md)。当前[开发依赖安全维护](implementation/2026-10-27-frontend-security-dependencies-plan.md) 同时处理 4 条工具链公告及上述 E2E 提示关闭同步，不新增产品版本；进度见[维护验收](implementation/2026-10-27-frontend-security-dependencies-acceptance.md)。

v0.24.0 整分支终审已完成，统一修复候选 `7cd277b2` 补齐真实父页授权恢复、服务端日期权威及固定 E2E 分类／已加载页面撤权回归；新门禁、工作树生成物隔离偏差及已通过的独立定向复审结论见本版验收。

主分支已合并 [全站统计、匿名访问明细与操作审计](product/scope-v0.18.0.md)。管理页为 `/admin/dashboard`、`/admin/audit`，访问明细保留在单短链分析页中；权限、隐私、事务与保留边界见 [设计](specs/2026-10-22-v0.18.0-analytics-audit-design.md)。分阶段本地门禁、候选树及剩余远端／发布验证分别记录在 [验收](implementation/v0.18.0-acceptance.md)，功能已通过 PR #208 合并为 `0f01a2e5`，尚未正式发布。

整分支终审的统一修复已通过定向复审，范围往返、卸载重建、跨 UTC 午夜与父聚合身份隔离均有回归。原完整门禁候选 `721206c` 的前端、68 项 E2E、production smoke、精确镜像扫描及证据 ZIP 另行保留；原分支最后实现候选 `e476f87d` 包含权限集合审计修复，已重跑后端门禁，尚未重跑前端、完整浏览器及镜像门禁，详见 v0.18.0 验收。

MoeURL 文档按实施导向组织，目标是让产品规划、功能规格、技术基线和实施计划各自边界清晰，便于后续按阶段开发。

## 阅读顺序

先阅读 [开发进度与能力清单](product/development-status.md)：按模块查看已实现、部分实现、待开发和待验证事项；再阅读 [产品总览](product/overview.md) 与 [路线图](product/roadmap.md)。进度清单集中维护当前状态，scope 定义版本边界，acceptance 保留指定提交和环境的证据。

此前 [v0.11.0 短链标题与标签](product/scope-v0.11.0.md) 的设计见 [元数据规格](specs/2026-10-13-v0.11.0-link-metadata-design.md)，执行与证据见 [实施计划](implementation/v0.11.0-plan.md)、[任务清单](implementation/v0.11.0-tasks.md) 和 [验收清单](implementation/v0.11.0-acceptance.md)。[v0.10.0 最大访问次数](product/scope-v0.10.0.md) 已实现，其 [验证记录](implementation/v0.10.0-acceptance.md) 与其他版本保持独立。

[v0.12.0 自定义短码](product/scope-v0.12.0.md) 已通过 PR #185 合并为 `17e1f766`。只允许创建时指定短码，不修改已发布地址；规则见 [设计](specs/2026-10-15-v0.12.0-custom-slugs-design.md)，原分支本地门禁与独立审查见 [验收清单](implementation/v0.12.0-acceptance.md)，不据此声称正式发布。

[v0.13.0 个人密码修改](product/scope-v0.13.0.md) 已通过 PR #186 合并为 `a52733cc`；校验当前密码后原子更新并撤销旧会话。见 [设计](specs/2026-10-15-v0.13.0-password-change-design.md)、[实施计划](implementation/v0.13.0-plan.md)、[任务清单](implementation/v0.13.0-tasks.md) 和 [验收记录](implementation/v0.13.0-acceptance.md)。合并不替代目标 CI 或生产验收证据。

[v0.14.0 统计日期范围](product/scope-v0.14.0.md) 已通过 PR #187 合并为 `c864ce3a`，支持近 7／30／90 天和有界自定义 UTC 区间；见 [设计](specs/2026-10-15-v0.14.0-analytics-date-range-design.md)、[实施计划](implementation/v0.14.0-plan.md)、[任务清单](implementation/v0.14.0-tasks.md) 与 [原分支验收记录](implementation/v0.14.0-acceptance.md)。

[v0.15.0 账号语言与主题偏好](product/scope-v0.15.0.md) 已通过 PR #190 合并为 `2ec7eaa4`；显式账号保存、登录加载和浏览器偏好隔离的原分支证据见 [验收记录](implementation/v0.15.0-acceptance.md)，不替代合并提交或发布验证。

[v0.16.0 聚合统计 CSV 导出](product/scope-v0.16.0.md) 已通过 PR #191 合并为 `bd4c2625`，未正式发布；仅导出单短链已应用 UTC 区间的匿名聚合。见 [设计](specs/2026-10-16-v0.16.0-analytics-export-design.md)、[实施计划](implementation/v0.16.0-plan.md)、[任务清单](implementation/v0.16.0-tasks.md) 与 [原分支验收记录](implementation/v0.16.0-acceptance.md)。

[v0.17.0 短链批量管理](product/scope-v0.17.0.md) 已通过 PR #198 合并为 `3eda85de`，支持当前列表多选与最多 100 条的原子批量启停／软删除。历史主分支候选 `c4928a85` 包含当时的依赖与 Go 证书安全修复，其完整目标 CI 9 项通过；功能合并和历史 CI 不等于当前候选或正式发布通过。范围与实际证据见 [设计](specs/2026-10-16-v0.17.0-bulk-link-management-design.md)、[计划](implementation/v0.17.0-plan.md)、[任务清单](implementation/v0.17.0-tasks.md) 和 [验收记录](implementation/v0.17.0-acceptance.md)。

2026-10-14 全站前端视觉更新沿用既有业务范围，设计见 [视觉与交互规范](specs/2026-10-14-ui-refresh-design.md)，执行与证据见 [实施计划](implementation/2026-10-14-ui-refresh-plan.md) 和 [本地验收](implementation/2026-10-14-ui-refresh-acceptance.md)。

2026-10-15 配色更新为 [鸢尾蓝与薄荷青](specs/2026-10-15-color-refresh-design.md)，替代前述灰蓝配色，保留标准列表与布局；执行与证据见 [实施计划](implementation/2026-10-15-color-refresh-plan.md) 和 [本地验收](implementation/2026-10-15-color-refresh-acceptance.md)。

需要了解既有模块的设计和实施过程时，继续按以下索引阅读；列表中的早期版本范围不代表当前全部能力：

1. [产品总览](product/overview.md)：了解 MoeURL 的定位、目标和核心原则。
2. [v0.9.0 范围](product/scope-v0.9.0.md)：确认已实现的系统设置、站点品牌和本地登录开关边界，以及仍待补齐的目标环境证据。
   详细技术设计见 [v0.9.0 系统设置与站点品牌基础闭环设计](superpowers/specs/2026-10-09-v0.9.0-system-settings-design.md)。
   工程推进参见 [v0.9.0 实施计划](implementation/v0.9.0-plan.md)、[详细实现计划](implementation/v0.9.0-detailed-plan.md)、[任务清单](implementation/v0.9.0-tasks.md) 与 [验收清单](implementation/v0.9.0-acceptance.md)。
3. [v0.8.0 范围](product/scope-v0.8.0.md)：确认多域名管理范围、升级边界及历史合并提交的 CI 与容器验证记录。
   工程推进参见 [v0.8.0 实施计划](implementation/v0.8.0-plan.md)、[任务清单](implementation/v0.8.0-tasks.md) 与 [验收清单](implementation/v0.8.0-acceptance.md)。
4. [v0.7.0 范围](product/scope-v0.7.0.md)：确认多提供商 OIDC 登录的范围、账号供应规则和非目标。
5. [v0.7.0 OIDC 登录设计](specs/2026-09-11-v0.7.0-oidc-login-design.md)：确认协议、密钥、外部身份、并发和回滚设计。
6. [v0.7.0 详细实现计划](implementation/v0.7.0-detailed-plan.md)：查看 OIDC 的 TDD 切片，并在 [v0.7.0 验收清单](implementation/v0.7.0-acceptance.md) 跟踪真实证据。
7. [v0.6.0 范围](product/scope-v0.6.0.md)：回看生产就绪版本的边界、部署目标和仍待补齐的目标环境证据。
8. [v0.6.0 生产就绪设计](specs/2026-08-29-v0.6.0-production-readiness-design.md)：确认单机 Compose、外部 TLS 反向代理、安全、生命周期和运维设计。
9. [v0.5.0 范围](product/scope-v0.5.0.md)：回看已完成的内置用户组权限管理边界。
10. [v0.5.0 功能设计](specs/2026-08-20-v0.5.0-user-group-permission-management-design.md)：回看权限目录、预设、保护规则、并发和页面状态。
11. [v0.4.0 范围](product/scope-v0.4.0.md)：回看已完成的确认页访问边界。
12. [v0.4.0 功能设计](specs/2026-08-13-v0.4.0-confirmation-page-access-design.md)：回看模式、权限、访问状态机和统计口径。
13. [v0.3.0 范围](product/scope-v0.3.0.md)：回看受保护短链访问的实现边界。
14. [v0.3.0 功能设计](specs/2026-08-04-v0.3.0-protected-link-access-design.md)：回看密码、限流、授权和访问流程设计。
15. [v0.2.0 范围](product/scope-v0.2.0.md)：回看短链访问体验与生命周期的实现边界。
16. [v0.2.0 功能设计](specs/2026-08-02-v0.2.0-link-experience-design.md)：回看中间页、过期时间、二维码和事件设计。
17. [统计与事件](specs/statistics-and-events.md)：确认短链访问事件、基础统计和维度统计口径。
18. [短链](specs/short-links.md)：确认短链访问、状态和事件记录调用点。
19. [跳转模式](specs/redirect-modes.md)：确认直接跳转、中间页和确认页边界。
20. [功能规格](specs/)：按模块查看权限、短链、用户、域名、页面、跳转、统计、主题和后台设计。
21. [技术选型决策](implementation/technical-decision.md)：确认 Go + Vue 技术栈和选型理由。
22. [技术基线](implementation/technical-baseline.md)：确认仓库结构、模块边界、API、数据库、测试和部署约定。
23. [Agent 自主交付规范](implementation/agent-delivery-guidelines.md)：确认新版本、跨模块、review 修复、CI 门禁和生产化任务的统一执行约定。
24. [实施文档](implementation/)：查看工程计划、阶段任务和验收记录。

## 此前合并：v0.19.0

[用户组成员迁移](product/scope-v0.19.0.md) 已通过 PR #211 合并为 `c08b67b2`，尚未正式发布。原候选和后续 CI 修复证据见 [验收](implementation/v0.19.0-acceptance.md)，不替代新合并提交目标 CI。

## 此前合并：v0.18.0

[全站统计、匿名访问明细与操作审计](product/scope-v0.18.0.md) 已通过 PR #208 合并为 `0f01a2e5`，尚未正式发布。原分支统一终审修复与本地验证保持原候选归属。查询权限、隐私和事务原子性见 [设计](specs/2026-10-22-v0.18.0-analytics-audit-design.md)，执行与证据见 [计划](implementation/v0.18.0-plan.md)、[任务](implementation/v0.18.0-tasks.md) 和 [验收](implementation/v0.18.0-acceptance.md)。

## 部署与运维

- [单机 Docker Compose 部署](deployment/single-host-compose.md)：准备秘密、首次启动、Caddy/Nginx TLS 和来源级限流。
- [PostgreSQL 备份与隔离恢复](deployment/backup-and-restore.md)：创建自定义格式备份并在隔离 project 验证恢复。
- [升级、回退与灾难恢复](deployment/upgrade-and-recovery.md)：执行升级前检查、显式 migration、失败回退和主机丢失演练。

## 文档分层

### 产品层

产品层文档位于 [product](product/) 目录，用于描述产品方向、版本边界和路线图。

- [产品总览](product/overview.md)
- [开发进度与能力清单](product/development-status.md)
- [v0.24.0 匿名访问记录导出范围](product/scope-v0.24.0.md)
- [v0.25.0 操作审计导出范围](product/scope-v0.25.0.md)
- [v0.0.1 范围](product/scope-v0.0.1.md)
- [v0.0.2 范围](product/scope-v0.0.2.md)
- [v0.0.3 范围](product/scope-v0.0.3.md)
- [v0.0.4 范围](product/scope-v0.0.4.md)
- [v0.1.0 范围](product/scope-v0.1.0.md)
- [v0.1.1 范围](product/scope-v0.1.1.md)
- [v0.1.2 范围](product/scope-v0.1.2.md)
- [v0.2.0 范围](product/scope-v0.2.0.md)
- [v0.3.0 范围](product/scope-v0.3.0.md)
- [v0.4.0 范围](product/scope-v0.4.0.md)
- [v0.5.0 范围](product/scope-v0.5.0.md)
- [v0.6.0 范围](product/scope-v0.6.0.md)
- [v0.7.0 范围](product/scope-v0.7.0.md)
- [v0.8.0 范围](product/scope-v0.8.0.md)
- [v0.9.0 范围](product/scope-v0.9.0.md)
- [v0.10.0 范围](product/scope-v0.10.0.md)
- [v0.11.0 范围](product/scope-v0.11.0.md)
- [v0.12.0 范围](product/scope-v0.12.0.md)
- [v0.13.0 范围](product/scope-v0.13.0.md)
- [v0.14.0 范围](product/scope-v0.14.0.md)
- [v0.15.0 范围](product/scope-v0.15.0.md)
- [路线图](product/roadmap.md)

### 功能规格层

功能规格层文档位于 [specs](specs/) 目录，用于描述各模块的稳定产品规格。实施计划应引用这些文档，而不是在计划中重复定义产品规则。

- [权限模型](specs/permissions.md)
- [v0.9.0 系统设置与站点品牌基础闭环设计](superpowers/specs/2026-10-09-v0.9.0-system-settings-design.md)
- [v0.7.0 多提供商 OIDC 登录设计](specs/2026-09-11-v0.7.0-oidc-login-design.md)
- [v0.6.0 生产就绪设计](specs/2026-08-29-v0.6.0-production-readiness-design.md)
- [v0.5.0 用户组权限管理设计](specs/2026-08-20-v0.5.0-user-group-permission-management-design.md)
- [v0.4.0 确认页访问设计](specs/2026-08-13-v0.4.0-confirmation-page-access-design.md)
- [v0.3.0 受保护短链访问设计](specs/2026-08-04-v0.3.0-protected-link-access-design.md)
- [用户与认证](specs/users-and-auth.md)
- [个人密码修改设计](specs/2026-10-15-v0.13.0-password-change-design.md)
- [短链](specs/short-links.md)
- [v0.11.0 短链标题与标签设计](specs/2026-10-13-v0.11.0-link-metadata-design.md)
- [v0.12.0 自定义短码设计](specs/2026-10-15-v0.12.0-custom-slugs-design.md)
- [域名](specs/domains.md)
- [跳转模式](specs/redirect-modes.md)
- [统计与事件](specs/statistics-and-events.md)
- [v0.24.0 匿名访问记录导出设计](specs/2026-10-26-v0.24.0-visit-record-export-design.md)
- [v0.25.0 操作审计导出设计](specs/2026-10-27-v0.25.0-audit-export-design.md)
- [v0.14.0 统计日期范围设计](specs/2026-10-15-v0.14.0-analytics-date-range-design.md)
- [v0.15.0 账号语言与主题偏好设计](specs/2026-10-16-v0.15.0-account-preferences-design.md)
- [导航与页面](specs/navigation-and-pages.md)
- [主题与多语言](specs/themes-and-i18n.md)
- [管理后台](specs/admin.md)

### 实施层

实施层文档位于 [implementation](implementation/) 目录，用于承载技术决策、技术基线、工程计划、任务拆分和验收记录。

v0.9.0 系统设置与站点品牌基础闭环的功能实现已经完成；功能提交 `900037d` 的 Go、前端单元覆盖率、静态检查、构建、SQLC 和 Compose 配置门禁已完成复验，该提交的全量 Playwright、目标 Node.js 26、完整 Compose smoke、目标 CI、Linux race、安全扫描、外部真实 OIDC 和生产发布验收仍待补齐。v0.8.0 多域名管理的功能实现已完成；合并提交 `f818a7e8` 对应的 PR 合并验证已通过全量 CI、Linux race、安全扫描、Playwright 与 Compose smoke。真实 DNS/TLS、隔离恢复和生产发布验收仍待目标环境证据，不能视为已发布能力。v0.7.0 多提供商 OIDC 登录的功能实现与本地门禁已完成，外部互操作和发布验收仍待证据；v0.6.0 生产就绪闭环的代码实现已完成、生产验收仍待目标环境证据。涉及认证扩展时先阅读 v0.9.0 与 v0.7.0 范围、设计、实施计划和验收清单；涉及生产部署时继续阅读 v0.6.0 对应文档。

当前实施层文档包括：

- [Agent 自主交付规范](implementation/agent-delivery-guidelines.md)
- [v0.24.0 计划](implementation/v0.24.0-plan.md)
- [v0.24.0 任务](implementation/v0.24.0-tasks.md)
- [v0.24.0 验收](implementation/v0.24.0-acceptance.md)
- [v0.25.0 计划](implementation/v0.25.0-plan.md)
- [v0.25.0 任务](implementation/v0.25.0-tasks.md)
- [v0.25.0 验收](implementation/v0.25.0-acceptance.md)
- [技术选型决策](implementation/technical-decision.md)
- [技术基线](implementation/technical-baseline.md)
- [初始化、密码与操作反馈本地验证记录](implementation/2026-10-14-auth-feedback-acceptance.md)
- [控制台导航、版本标识与界面细节计划](implementation/2026-10-14-ui-details-plan.md)
- [控制台导航、版本标识与界面细节本地验收](implementation/2026-10-14-ui-details-acceptance.md)
- [标准列表与页脚链接调整](implementation/2026-10-15-standard-lists-plan.md)
- [标准列表与页脚链接本地验收](implementation/2026-10-15-standard-lists-acceptance.md)
- [v0.11.0 实施计划](implementation/v0.11.0-plan.md)
- [v0.12.0 实施计划](implementation/v0.12.0-plan.md)
- [v0.13.0 实施计划](implementation/v0.13.0-plan.md)
- [v0.13.0 任务清单](implementation/v0.13.0-tasks.md)
- [v0.13.0 验收记录](implementation/v0.13.0-acceptance.md)
- [v0.14.0 实施计划](implementation/v0.14.0-plan.md)
- [v0.14.0 任务清单](implementation/v0.14.0-tasks.md)
- [v0.14.0 验收记录](implementation/v0.14.0-acceptance.md)
- [v0.12.0 任务清单](implementation/v0.12.0-tasks.md)
- [v0.12.0 验收清单](implementation/v0.12.0-acceptance.md)
- [v0.11.0 任务清单](implementation/v0.11.0-tasks.md)
- [v0.11.0 验收清单](implementation/v0.11.0-acceptance.md)
- [v0.9.0 实施计划](implementation/v0.9.0-plan.md)
- [v0.9.0 任务级实施清单](implementation/v0.9.0-tasks.md)
- [v0.9.0 验收清单](implementation/v0.9.0-acceptance.md)
- [v0.9.0 详细实现计划](implementation/v0.9.0-detailed-plan.md)
- [v0.8.0 实施计划](implementation/v0.8.0-plan.md)
- [v0.8.0 任务级实施清单](implementation/v0.8.0-tasks.md)
- [v0.8.0 验收清单](implementation/v0.8.0-acceptance.md)
- [v0.7.0 实施计划](implementation/v0.7.0-plan.md)
- [v0.7.0 详细实现计划](implementation/v0.7.0-detailed-plan.md)
- [v0.7.0 任务级实施清单](implementation/v0.7.0-tasks.md)
- [v0.7.0 验收清单](implementation/v0.7.0-acceptance.md)
- [v0.6.0 实施计划](implementation/v0.6.0-plan.md)
- [v0.6.0 详细实现计划](implementation/v0.6.0-detailed-plan.md)
- [v0.6.0 任务级实施清单](implementation/v0.6.0-tasks.md)
- [v0.6.0 验收清单](implementation/v0.6.0-acceptance.md)
- [v0.2.0 实施计划](implementation/v0.2.0-plan.md)
- [v0.2.0 详细实现计划](implementation/v0.2.0-detailed-plan.md)
- [v0.2.0 任务级实施清单](implementation/v0.2.0-tasks.md)
- [v0.2.0 验收清单](implementation/v0.2.0-acceptance.md)
- [v0.3.0 实施计划](implementation/v0.3.0-plan.md)
- [v0.3.0 详细实现计划](implementation/v0.3.0-detailed-plan.md)
- [v0.3.0 任务级实施清单](implementation/v0.3.0-tasks.md)
- [v0.3.0 验收清单](implementation/v0.3.0-acceptance.md)
- [v0.4.0 实施计划](implementation/v0.4.0-plan.md)
- [v0.4.0 详细实现计划](implementation/v0.4.0-detailed-plan.md)
- [v0.4.0 任务级实施清单](implementation/v0.4.0-tasks.md)
- [v0.4.0 验收清单](implementation/v0.4.0-acceptance.md)
- [v0.5.0 实施计划](implementation/v0.5.0-plan.md)
- [v0.5.0 详细实现计划](implementation/v0.5.0-detailed-plan.md)
- [v0.5.0 任务级实施清单](implementation/v0.5.0-tasks.md)
- [v0.5.0 验收清单](implementation/v0.5.0-acceptance.md)
- [v0.0.1 工程实施合同](implementation/v0.0.1-implementation-contract.md)
- [v0.0.1 实施规划](implementation/v0.0.1-plan.md)
- [v0.0.1 工程实施计划](implementation/v0.0.1-engineering-plan.md)
- [v0.0.1 任务级实施清单](implementation/v0.0.1-tasks.md)
- [v0.0.1 验收清单](implementation/v0.0.1-acceptance.md)
- [v0.0.2 实施计划](implementation/v0.0.2-plan.md)
- [v0.0.2 任务级实施清单](implementation/v0.0.2-tasks.md)
- [v0.0.2 验收清单](implementation/v0.0.2-acceptance.md)
- [v0.0.3 实施计划](implementation/v0.0.3-plan.md)
- [v0.0.3 任务级实施清单](implementation/v0.0.3-tasks.md)
- [v0.0.3 验收清单](implementation/v0.0.3-acceptance.md)
- [v0.0.4 实施计划](implementation/v0.0.4-plan.md)
- [v0.0.4 任务级实施清单](implementation/v0.0.4-tasks.md)
- [v0.0.4 验收清单](implementation/v0.0.4-acceptance.md)
- [v0.1.0 实施计划](implementation/v0.1.0-plan.md)
- [v0.1.0 任务级实施清单](implementation/v0.1.0-tasks.md)
- [v0.1.0 验收清单](implementation/v0.1.0-acceptance.md)
- [v0.1.1 实施计划](implementation/v0.1.1-plan.md)
- [v0.1.1 任务级实施清单](implementation/v0.1.1-tasks.md)
- [v0.1.1 验收清单](implementation/v0.1.1-acceptance.md)
- [v0.1.2 实施计划](implementation/v0.1.2-plan.md)
- [v0.1.2 任务级实施清单](implementation/v0.1.2-tasks.md)
- [v0.1.2 验收清单](implementation/v0.1.2-acceptance.md)
