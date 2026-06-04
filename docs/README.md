# MoeURL 文档中心

MoeURL 文档按实施导向组织，目标是让产品规划、功能规格和实施计划各自边界清晰，便于后续按阶段开发。

## 阅读顺序

建议按以下顺序阅读：

1. [产品总览](product/overview.md)：了解 MoeURL 的定位、目标和核心原则。
2. [v0.0.1 范围](product/scope-v0.0.1.md)：确认当前阶段必须实现、应该预留和暂不实现的内容。
3. [功能规格](specs/)：按模块查看权限、短链、用户、域名、页面、跳转、统计、主题和后台设计。
4. [实施文档](implementation/)：查看开发计划、阶段任务和验收记录。

## 文档分层

### 产品层

产品层文档位于 [product](product/) 目录，用于描述产品方向、版本边界和路线图。

- [产品总览](product/overview.md)
- [v0.0.1 范围](product/scope-v0.0.1.md)
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

实施层文档位于 [implementation](implementation/) 目录，用于承载具体开发计划、任务拆分和验收记录。

当前优先目标是 v0.0.1 基础可用闭环。实施计划应优先覆盖 [v0.0.1 范围](product/scope-v0.0.1.md) 中的必须实现项。
