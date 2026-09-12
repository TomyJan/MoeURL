# MoeURL 文档中心

MoeURL 文档按实施导向组织，目标是让产品规划、功能规格、技术基线和实施计划各自边界清晰，便于后续按阶段开发。

## 阅读顺序

建议按以下顺序阅读：

1. [产品总览](product/overview.md)：了解 MoeURL 的定位、目标和核心原则。
2. [v0.7.0 范围](product/scope-v0.7.0.md)：确认当前多提供商 OIDC 登录版本的范围、账号供应规则和非目标。
3. [v0.7.0 OIDC 登录设计](specs/2026-09-11-v0.7.0-oidc-login-design.md)：确认协议、密钥、外部身份、并发和回滚设计。
4. [v0.7.0 详细实现计划](implementation/v0.7.0-detailed-plan.md)：查看当前 TDD 切片，并在 [v0.7.0 验收清单](implementation/v0.7.0-acceptance.md) 跟踪真实证据。
5. [v0.6.0 范围](product/scope-v0.6.0.md)：回看生产就绪版本的边界、部署目标和仍待补齐的目标环境证据。
6. [v0.6.0 生产就绪设计](specs/2026-08-29-v0.6.0-production-readiness-design.md)：确认单机 Compose、外部 TLS 反向代理、安全、生命周期和运维设计。
7. [v0.5.0 范围](product/scope-v0.5.0.md)：回看已完成的内置用户组权限管理边界。
8. [v0.5.0 功能设计](specs/2026-08-20-v0.5.0-user-group-permission-management-design.md)：回看权限目录、预设、保护规则、并发和页面状态。
9. [v0.4.0 范围](product/scope-v0.4.0.md)：回看已完成的确认页访问边界。
10. [v0.4.0 功能设计](specs/2026-08-13-v0.4.0-confirmation-page-access-design.md)：回看模式、权限、访问状态机和统计口径。
11. [v0.3.0 范围](product/scope-v0.3.0.md)：回看受保护短链访问的实现边界。
12. [v0.3.0 功能设计](specs/2026-08-04-v0.3.0-protected-link-access-design.md)：回看密码、限流、授权和访问流程设计。
13. [v0.2.0 范围](product/scope-v0.2.0.md)：回看短链访问体验与生命周期的实现边界。
14. [v0.2.0 功能设计](specs/2026-08-02-v0.2.0-link-experience-design.md)：回看中间页、过期时间、二维码和事件设计。
15. [统计与事件](specs/statistics-and-events.md)：确认短链访问事件、基础统计和维度统计口径。
16. [短链](specs/short-links.md)：确认短链访问、状态和事件记录调用点。
17. [跳转模式](specs/redirect-modes.md)：确认直接跳转、中间页和确认页边界。
18. [功能规格](specs/)：按模块查看权限、短链、用户、域名、页面、跳转、统计、主题和后台设计。
19. [技术选型决策](implementation/technical-decision.md)：确认 Go + Vue 技术栈和选型理由。
20. [技术基线](implementation/technical-baseline.md)：确认仓库结构、模块边界、API、数据库、测试和部署约定。
21. [Agent 自主交付规范](implementation/agent-delivery-guidelines.md)：确认新版本、跨模块、review 修复、CI 门禁和生产化任务的统一执行约定。
22. [实施文档](implementation/)：查看工程计划、阶段任务和验收记录。

## 部署与运维

- [单机 Docker Compose 部署](deployment/single-host-compose.md)：准备秘密、首次启动、Caddy/Nginx TLS 和来源级限流。
- [PostgreSQL 备份与隔离恢复](deployment/backup-and-restore.md)：创建自定义格式备份并在隔离 project 验证恢复。
- [升级、回退与灾难恢复](deployment/upgrade-and-recovery.md)：执行升级前检查、显式 migration、失败回退和主机丢失演练。

## 文档分层

### 产品层

产品层文档位于 [product](product/) 目录，用于描述产品方向、版本边界和路线图。

- [产品总览](product/overview.md)
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
- [路线图](product/roadmap.md)

### 功能规格层

功能规格层文档位于 [specs](specs/) 目录，用于描述各模块的稳定产品规格。实施计划应引用这些文档，而不是在计划中重复定义产品规则。

- [权限模型](specs/permissions.md)
- [v0.7.0 多提供商 OIDC 登录设计](specs/2026-09-11-v0.7.0-oidc-login-design.md)
- [v0.6.0 生产就绪设计](specs/2026-08-29-v0.6.0-production-readiness-design.md)
- [v0.5.0 用户组权限管理设计](specs/2026-08-20-v0.5.0-user-group-permission-management-design.md)
- [v0.4.0 确认页访问设计](specs/2026-08-13-v0.4.0-confirmation-page-access-design.md)
- [v0.3.0 受保护短链访问设计](specs/2026-08-04-v0.3.0-protected-link-access-design.md)
- [用户与认证](specs/users-and-auth.md)
- [短链](specs/short-links.md)
- [域名](specs/domains.md)
- [跳转模式](specs/redirect-modes.md)
- [统计与事件](specs/statistics-and-events.md)
- [导航与页面](specs/navigation-and-pages.md)
- [主题与多语言](specs/themes-and-i18n.md)
- [管理后台](specs/admin.md)

### 实施层

实施层文档位于 [implementation](implementation/) 目录，用于承载技术决策、技术基线、工程计划、任务拆分和验收记录。

当前 v0.7.0 多提供商 OIDC 登录的功能实现与本地可执行门禁已完成，目标 CI、race、外部 OIDC 互操作和生产发布验收仍待证据；v0.6.0 生产就绪闭环的代码实现已完成、生产验收仍待目标环境证据。涉及认证扩展时先阅读 v0.7.0 范围、设计、详细实现计划和验收清单；涉及生产部署时继续阅读 v0.6.0 对应文档。

当前实施层文档包括：

- [Agent 自主交付规范](implementation/agent-delivery-guidelines.md)
- [技术选型决策](implementation/technical-decision.md)
- [技术基线](implementation/technical-baseline.md)
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
