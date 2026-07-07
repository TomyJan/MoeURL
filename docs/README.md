# MoeURL 文档中心

MoeURL 文档按实施导向组织，目标是让产品规划、功能规格、技术基线和实施计划各自边界清晰，便于后续按阶段开发。

## 阅读顺序

建议按以下顺序阅读：

1. [产品总览](product/overview.md)：了解 MoeURL 的定位、目标和核心原则。
2. [v0.0.3 范围](product/scope-v0.0.3.md)：确认当前阶段必须实现、应该预留和暂不实现的内容。
3. [v0.0.3 UI/UX 精细化重设计](superpowers/specs/2026-06-08-v0.0.3-ui-ux-redesign.md)：确认首页、控制台和短链生成组件结构。
4. [v0.0.3 配色与交互重设设计](superpowers/specs/2026-06-30-v0.0.3-color-interaction-redesign.md)：确认当前雾蓝石墨主题、状态和导航交互基线。
5. [功能规格](specs/)：按模块查看权限、短链、用户、域名、页面、跳转、统计、主题和后台设计。
6. [v0.0.3 实施计划](implementation/v0.0.3-plan.md)：确认 v0.0.3 的实施阶段、边界和验收目标。
7. [技术选型决策](implementation/technical-decision.md)：确认 Go + Vue 技术栈和选型理由。
8. [技术基线](implementation/technical-baseline.md)：确认仓库结构、模块边界、API、数据库、测试和部署约定。
9. [实施文档](implementation/)：查看工程计划、阶段任务和验收记录。

## 文档分层

### 产品层

产品层文档位于 [product](product/) 目录，用于描述产品方向、版本边界和路线图。

- [产品总览](product/overview.md)
- [v0.0.1 范围](product/scope-v0.0.1.md)
- [v0.0.2 范围](product/scope-v0.0.2.md)
- [v0.0.3 范围](product/scope-v0.0.3.md)
- [路线图](product/roadmap.md)

### 功能规格层

功能规格层文档位于 [specs](specs/) 目录，用于描述各模块的稳定产品规格。实施计划应引用这些文档，而不是在计划中重复定义产品规则。

- [权限模型](specs/permissions.md)
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

当前优先目标是 v0.0.3 UI/UX 精细化重设计。实施计划应优先覆盖 [v0.0.3 范围](product/scope-v0.0.3.md) 中的必须实现项，并遵循 [技术基线](implementation/technical-baseline.md)。涉及 v0.0.2 已完成功能、既有 API、schema、权限和验收口径时，应继续参考 [v0.0.2 验收清单](implementation/v0.0.2-acceptance.md) 和 [v0.0.1 工程实施合同](implementation/v0.0.1-implementation-contract.md)。

当前实施层文档包括：

- [技术选型决策](implementation/technical-decision.md)
- [技术基线](implementation/technical-baseline.md)
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
