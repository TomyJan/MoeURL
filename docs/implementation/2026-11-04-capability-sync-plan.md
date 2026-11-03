# v0.46.0 后文档状态同步计划

> 面向 AI 代理：使用 executing-plans 原生执行，不派 builder／逐任务审查；文档完成后唯一 fresh 独立整分支终审。持续自主授权覆盖常规审批。

**目标：** 当前状态入口、能力表和验收阶段与已完成 v0.46.0 一致。
**架构：** 只读证据矩阵＋精确 Markdown 修改，保留历史执行归属。
**技术栈：** Markdown、Git、已有 Node／PowerShell，无产品运行时变化。
**规格：** [状态同步设计](../specs/2026-11-04-capability-sync-design.md)。

实际阶段与验证结果见[本轮验收](2026-11-04-capability-sync-acceptance.md)。

## 全局约束

- v0.46.0 master CI、标准 Task4、最终归档实际完成后，从其已验 master f3beb002 建立 docs/capability-sync-20261104；沿用已有隔离 worktree。
- 只修改 Markdown，925 个非 Markdown 路径／hash／bytes 全等；旧合同／CI／ZIP 只读，不重成功 suite、生成器、API 或安装。
- 外置 .tmp/capability-sync-20261104-evidence；owned .superpowers/sdd/2026-11-04-capability-sync-plan。
- 本轮须独立真实审查、候选／master 各九 CI 与完整原日志 EOF、守卫 squash／独立 merge 身份及可恢复归档。
- 不碰 PR240、18080、日常 DB 或未知资源；不发布部署；不删分支／worktree／其他 plan；automation ACTIVE 每 10 分钟仅兜底。

## 文件职责

- docs/README.md 与 docs/product/{overview,development-status,roadmap}.md：当前完成摘要、历史标签、准确能力表／当前验收入口，处理 M2／M4／M8。
- docs/product/scope-v0.35.0.md、scope-v0.37.0.md：实际承载旧状态的两个标题加历史限定及表前说明，处理 M1，不批量改层级或历史正文。
- docs/product/scope-v0.46.0.md、docs/implementation/v0.46.0-{plan,tasks,acceptance}.md：按实际最终收据同步状态，Task2 明确历史，处理 M7。
- docs/implementation/v0.44.0-tasks.md：既有标准 Task3／4 完成勾选与历史标记。
- docs/specs/2026-11-04-capability-sync-design.md、docs/implementation/2026-11-04-capability-sync-{plan,acceptance}.md：本轮范围、任务与证据。

## 审查重点（Review Focus）

1. 精确候选／master／本地运行归属分开，不把已合并写成已发布。
2. 备注状态、固定 20 条分页和 100 码点私密词写成已有能力；全文搜索／批量备注等仍为非目标。
3. 旧失败、运行时、扫描与未看 artifact 的边界完整保留。
4. 当前摘要和历史阶段不冲突，旧原文不被冒改成新执行。
5. 只有 Markdown 改动，925 源及冻结证据全等，链接有效，五项文档 Minor 有具体处置，M5／M6 不夹带修复。

## Task1：文档修正与证据矩阵

**Interfaces:** Consumes：已完整归档 v0.46 合同／收据及已有 v0.44／45 验收。Produces：只读矩阵、准确文档、原子提交和本地完成合同。

- [x] 标准 start1，全文读 brief；核完整925源 baseline、旧最终档案 hash／bytes，逐项矩阵记允许表述／非目标／收据身份。
- [x] 按文件职责精确修正。新当前完成摘要有对应真实收据；两个历史标题只增加阶段限定，不批量调整层级，不删原失败／限制。
- [x] 运行外置 verify-docs.mjs verify task1-precommit，Expected：仅 .md、所有本地链接有效、925源与冻结档案全等，实际0。不为文档修正添加镜像实现的测试。
- [x] 精确名单原子提交，建立合同并标准 done1（只核实际证据，不重 suite）。

## Task2：唯一独立终审与本地收尾

**Interfaces:** Consumes：Task1 文档与证据合同。Produces：整分支审查、全部裁决／延期清单、本地报告和档案。

- [x] 标准 start2，全文读 brief；一次 fresh 独立整分支终审，附 base..HEAD、规格／计划／完整 Focus 和账本，不派下级或执行产品套件。
- [x] 核实所有意见，Critical／Important 最小修正并文档核验；Minor 逐项延期理由成本，不派第二终审。
- [ ] 同步实际阶段、链接／完整源／冻结证据核，原子提交；全部裁决与 M5／M6 等延期入完整报告，新 whole-owned ZIP／解压全集核、合同与标准 done2。

## Task3：独立远端交付与最终归档

**Interfaces:** Consumes：Task2 clean 候选及合同。Produces：本轮真实覆盖、候选／master 各九 CI、守卫合并身份、标准完成及可恢复档案。

- [ ] 标准 start3、同名 push／upstream／唯一 PR。只读新讨论／审查；running 不催，skipped 看本 PR 评论 updated_at＋明示时长，在恢复点后 fresh 无 running 且该 head 无 manual 才唯一请求。精确 source=covered／kind reviewed，全部有效问题闭环。
- [ ] 候选自身九 CI 全成功，完整日志一次 capture 并连续核 EOF；fresh 完整分页讨论 open0，match-head 守卫 squash，独立 API／fetch／SHA／tree／唯一父一致。
- [ ] master 自身九 CI／完整日志 EOF；完整报告／合同、标准 done3、新 whole-owned ZIP／解压全集核及准确 leaf 可恢复迁出／siblings 不变。简短通知完成后继续合理下一增量。

## 自检

三任务产出与消费顺序一致，五项 Focus 均由矩阵／完整源／文档／独立审查／远端门禁覆盖。本轮不改变产品或借旧 CI 给新 SHA，不扩大文档维护为历史全集重写。
