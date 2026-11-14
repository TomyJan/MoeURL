# v0.75.3 文档入口与执行设计维护范围

基线是 PR346 已独立核验的 master `d0352fdae905096a2430b85af206fbadc322b11b`，分支 `chore/v0.75.3-doc-entry-maintenance`。这是文档维护版本，产品保持 0.75.2。

## 必须实现

- 将 v0.75.1 执行设计从 `docs/specs/` 归位到 `docs/implementation/`，全文不改，同步 scope 和 plan 的两处引用。
- 详细历史保留在 development-status；另外五个入口最近八个历史检查点改为短链接，保留原 H2 标题。范围为 v0.71.0、v0.72.0、v0.73.0、v0.73.1、v0.74.0、v0.74.1、v0.75.0、v0.75.1，共 40 份重复正文。
- 修正 v0.75.2 design、plan、tasks、scope 四处多余 EOF 空行；不改语句或历史证据。
- 六个入口的当前摘要指向统一进度，明确 PR346 已交付与本维护尚在执行。

## 边界与验收

不改运行代码、产品号、API、权限、数据库、依赖、生成物或稳定 CSV 规格。更早或独有历史保持原样，本版不声称全部旧重复均已消除；前版执行设计 Minor 和 EOF Minor 可据本版实际修正关闭，历史集中化 Minor 仅有界消减，剩余更早重复继续明确接续。

验证 40 份原文的相对链接解析后与保留原文完全相等、旧标题落点仍在、范围外原文不变、移动文件 bytes/hash 相同、旧引用零残留、新链接可达、全范围 diff-check 0，以及完整非 Markdown 输入零漂移。纯文档不重跑已成功生产套件，不安装或启动 Docker。

采用既有隔离工作区内联执行、两项标准任务，版末唯一 fresh 最强独立终审、最终 head 真实 CodeRabbit、正常 match-head squash、独立 SHA/tree/唯一父核验及可恢复归档。不查 CI，不碰 PR240/266/267，不发布部署；临时预算仍为 4/12/6 GiB。

设计见[执行设计](../implementation/2026-11-15-v0.75.3-doc-entry-maintenance-design.md)，实施见[计划](../implementation/v0.75.3-plan.md)、[任务](../implementation/v0.75.3-tasks.md)和[验收](../implementation/v0.75.3-acceptance.md)。
