# v0.84.1 测试资源清理诊断维护

状态：本地实现、19 项夹具／58 项完整 Node、lint／12 份 strict 通过，Task1 合同与标准完成；独立终审及真实交付待做。产品保持 0.84.0。前版 PR370 已真实审查、正常合并至 master `f2bc2bb92c5d524f8bb42d5cb08e5f8a53ec8df7`，三个标准任务及 10 份工作记录可恢复归档。阶段见[验收](../implementation/v0.84.1-acceptance.md)。

## 本版范围

- 修复 `scripts/csv-issues-fixture.test.mjs` 的清理 hook：服务、文件句柄、准确临时目录依序尝试，所有错误按发生顺序原样保存到 AggregateError，包含 undefined／null／false 等拒绝值。
- 使用真实回环 HTTP、真实文件句柄和目录证明资源释放；仅在真实释放之后注入确定性失败，不使用固定等待或 mock 调用计数替代资源证据。
- 收口 v0832-FR-M1、v0840-FR-M1 与 v0840-CR-M1；不将已驳回的 Clipboard 重试 nitpick 冒为缺口。
- 完整 Node 脚本、现有 lint 和 12 份 E2E strict；产品源码闭包不变，准确旧产品、浏览器及扫描证据保留实际执行身份，不重建或重跑。

## 不做

不改产品、真实 E2E 生命周期、API、数据库、权限、SQLC、依赖或产品版本。不查 CI，不发布部署；不触 PR240／266／267、18080 和日常 DB。活动 4 GiB／双 .tmp 12 GiB／Docker 可回收 6 GiB，精确清自有资源，不全局 prune。

这是 Agent 按用户持续自主授权选择的最小维护，不冒称逐项用户批准。设计见[规格](../specs/2026-11-16-v0.84.1-fixture-release-errors-design.md)，执行见[计划](../implementation/v0.84.1-plan.md)。
