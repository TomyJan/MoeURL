# v0.33.1 交付状态文档维护计划

> **面向 AI 代理的工作者：** 使用 executing-plans 内联执行；本轮仅维护文档，不另设产品版本，不派 builder。唯一全新整分支终审放在文档核验后。

**目标：** 将已经完成的 PR #232 交付证据写回仓库入口，解决 overview 延期摘要，保持历史候选、失败与发布边界。

**架构：** 产品入口给出当前简述，v0.33.1 acceptance 集中记录最终候选、合并、独立 CI、审查及归档事实；历史阶段段落明确保留为历史，不重写外置原件。

**技术栈：** Markdown、Git、PowerShell；产品代码、依赖和部署不变。

**规格：** 本计划的范围与证据契约，以及 [v0.33.1 范围](../product/scope-v0.33.1.md)、[验收](v0.33.1-acceptance.md)和 [Agent 交付规范](agent-delivery-guidelines.md)。

## 范围与现状盘点

2026-10-29T15:16:43Z，REST master ref 与独立 fetch 同为 `cf5d5a647febf6d7c5ee306605432066ca5bd2e8`，open PR 为 0；在原 linked worktree 新建 `docs/v0331-delivery-status`，保留原补丁分支。

| 能力／来源 | 当前状态 | 纳入与原因 | 后端／前端／数据库影响 | 核验与风险 |
| --- | --- | --- | --- | --- |
| v0.33.1，scope／acceptance／交付收据 | 已交付，仓库仍写 Task3 待做 | 纳入，入口与证据不一致 | 均无 | 核对原 completion、CI、归档收据；低风险，主要是证据误归属 |
| overview 最新业务摘要 | 仍写 v0.31.0，原审查已延期 | 纳入，统一描述 v0.33.0／v0.32.0 与补丁 | 均无 | 逐条对照已有范围与合并状态；低风险 |
| roadmap 品牌行及旧日期引言 | 当前状态落后 | 纳入，同步已有能力与非目标 | 均无 | 文档链接与范围核对；低风险 |
| Logo、主题色、导入等路线图能力 | 尚未实现 | 不纳入，本轮先消除已确认文档欠账 | 均无 | 不新增功能验收承诺 |
| 生产演练、tag、release、deploy | 尚未执行 | 不纳入，缺少目标环境证据 | 均无 | 保持未发布，禁止用 CI 替代 |

## 全局约束

- 唯一源码为当前 C: linked worktree；不触日常 D: 源码、数据库、18080、webdist 或 Docker。
- 原 v0.33.1 报告、42 项裁决、ZIP、原任务契约和已清理 leaf 保持冻结；本轮只只读引用，不重下载 CI、不重归档或重建旧 leaf。
- PR 候选 `91cf9d5f93529291139b879e58ea3a93ae0f7eb3` 与 master `cf5d5a647febf6d7c5ee306605432066ca5bd2e8` 各自 CI、运行时、制品和限制分开记录。
- 不将文档同步冒充新的测试通过；不新增扫描人类散文的产品测试。不变运行时不重复本地 suite／生成器。
- 本轮采用独立 owned 账本与外置 `status-reconciliation-evidence`，所有裁决说明理由与错误代价。GitHub 仅经既有 GCM wrapper；不 force、绕保护或删分支。
- 本轮候选自己的远端审查／CI、guarded merge 与合并提交 CI 另行验收；不能借 PR #232 结果。无 tag／release／deploy。

## 文件职责

- 修改 `docs/README.md`、`docs/product/{overview,development-status,roadmap}.md`：当前入口与最新能力。
- 修改 `docs/product/scope-v0.33.1.md`、`docs/implementation/v0.33.1-{tasks,acceptance}.md`：补丁最终状态、勾选有证据的任务、集中证据与限制。
- 修改 `docs/implementation/technical-{decision,baseline}.md`：只加最终状态补记，明确旧阶段记录的时间归属，不改技术约定。
- 新增本计划与 `2026-10-29-delivery-status-acceptance.md`：维护轮自己的核验和未完成交付状态。

## 审查重点（Review Focus）

1. PR #232 的 CI 与 master CI 必须各自指向正确 SHA、事件和运行链接，不归属本轮新文档提交。
2. 最终归档完成、标准 done3 与 cleanup 的先后必须正确；不能改冻结快照来假装含后继收据。
3. 旧 protected 超时及 pointer 组合、截图、扫描和继承环境限制必须保留，不能写成已修复或零风险。
4. 当前入口与历史段落必须能区分，不能同时声称 Task3 当前待做和已完成。
5. overview 与 roadmap 只描述已合并能力；未发布与新能力非目标不得消失。

## Task 1：同步当前状态并验证文档

**Interfaces — Consumes：** 冻结 PR232 completion／归档／清理收据和既有 scope。**Produces：** 一致的当前入口与保留原始归属的 acceptance。

- [ ] 逐项核对原收据哈希与关键事实，记录当前只读查询首次错误使用 jq 字符串导致输出过滤器字面量的工具偏差；该输出不作为远端证据，后继原始 REST 已独立成功。
- [ ] 更新上述文档，acceptance 新增最终章节，原阶段明确标为历史。
- [ ] 运行 `git diff --check`、全部本地 Markdown 链接核验、相对 master 的非 Markdown 路径／hash／bytes 集合相等核验；原报告／ZIP／contract 哈希核验。Expected: 全部实际 0，只有明确的文档路径变化。
- [ ] 原子提交并标准 task-done。Expected: 本地核验通过，不声称本轮远端完成。

## Task 2：唯一终审与独立远端交付

**Interfaces — Consumes：** Task1 文档与本地证明。**Produces：** 本轮自己的审查、CI、合并及最终报告。

- [ ] 唯一 fresh 最强支持模型整分支终审，附本计划、五 Focus、全部裁决及冻结收据；不跑产品 suite、不派下级。逐项核事实处置并记录理由与错误代价。
- [ ] 同名 push／唯一 PR，一次 attach。各候选自身九 CI 完整 raw 及真实最新 CodeRabbit 覆盖、全部有效意见闭环后，guarded squash match-head；独立 API／fetch／tree／父验证，再本轮 master 自身九 CI。
- [ ] 标准 task-done、完整报告／所有裁决、独立 owned 最终归档提取集合核验，仅准确本轮 leaf 可恢复清理。Expected: 本轮交付全部实际完成后才通知；原 PR232 冻结档案不变。

## 计划自检

Task1 只消费冻结事实并产出文档，Task2 只消费该文档候选；无新增运行时接口。五项 Focus 分别由 SHA／run 对照、收据顺序、限制逐项审阅、当前／历史检查和范围审阅覆盖；不以字符串测试替代人工证据判断。维护范围小于新功能版本，所有未来能力继续独立设计。
