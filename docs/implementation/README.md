# 实施文档

本目录用于保存 MoeURL 的技术决策、技术基线、实施计划、阶段任务和验收记录。

## 当前文档

技术基线文档包括：

- [技术选型决策](technical-decision.md)：记录后端、前端、数据库、测试和部署技术栈的选择原因。
- [技术基线](technical-baseline.md)：定义仓库结构、模块边界、API、数据库、权限、前端结构、测试和部署约定。

v0.0.1 实施文档包括：

- [v0.0.1 工程实施合同](v0.0.1-implementation-contract.md)：v0.0.1 工程开发主入口，集中定义 schema、API、权限、事件、标准命令和验收映射。
- [v0.0.1 实施规划](v0.0.1-plan.md)：说明实施目标、阶段划分、阶段交付和总体验收标准。
- [v0.0.1 工程实施计划](v0.0.1-engineering-plan.md)：基于 Go + Vue 技术栈，定义可指导开发的工程阶段、文件结构、API、业务规则和验收标准。
- [v0.0.1 任务级实施清单](v0.0.1-tasks.md)：把实施规划拆成可执行任务，便于后续按任务开发。
- [v0.0.1 验收清单](v0.0.1-acceptance.md)：用于开发完成后的功能验收和发布前检查。

建议阅读顺序：

```text
technical-decision.md
  ↓
technical-baseline.md
  ↓
v0.0.1-implementation-contract.md
  ↓
v0.0.1-plan.md
  ↓
v0.0.1-engineering-plan.md
  ↓
v0.0.1-tasks.md
  ↓
v0.0.1-acceptance.md
```

## 编写原则

实施文档应遵循以下原则：

- 先确认产品范围，再拆分开发任务。
- 技术实现以 [技术选型决策](technical-decision.md) 和 [技术基线](technical-baseline.md) 为准。
- 以 v0.0.1 基础可用闭环为当前优先目标。
- 不把远期能力直接纳入当前版本实现。
- 对远期能力只保留必要的数据模型、接口边界或扩展点。
- 每份实施计划都应明确目标、范围、任务顺序和验收标准。
- 工程实施计划应明确技术栈、目录结构、模块职责、API、数据模型、测试和部署约定。
- 任务级清单应尽量产出可验证、可提交的阶段成果。
- 验收清单应覆盖核心闭环、权限边界和暂不实现项确认。

## 命名规则

建议实施文档按用途和版本命名，例如：

```text
technical-decision.md
technical-baseline.md
v0.0.1-implementation-contract.md
v0.0.1-plan.md
v0.0.1-engineering-plan.md
v0.0.1-tasks.md
v0.0.1-acceptance.md
v0.1.0-plan.md
```
