# 当前能力与交付状态维护计划

> 面向 AI 代理：原生 executing-plans；不派 builder 或逐任务审查，文档完成后唯一 fresh 最强 supported 整分支终审。用户持续自主授权覆盖常规设计审批。

**目标：** 当前入口准确描述截至已交付 v0.43.1 的能力和剩余缺口。
**架构：** 逐能力证据矩阵＋精确 Markdown 更新，旧阶段原文显式归为历史；冻结原件只读。
**技术栈：** Markdown、Git、现有 Node／PowerShell；产品运行时不变。
**规格：** [能力状态设计](../specs/2026-11-03-capability-status-design.md)。

## 全局约束

- 必须先完成 v0.43.1 master CI／标准任务／归档，不在其候选分支写本计划。
- 新分支 docs/capability-status-20261103 从独立核验的实际 master 建立，不删除旧分支或 worktree。
- 只修改 Markdown。基线完整902非Markdown路径、hash和bytes冻结并前后全等。
- 不执行安装、生成器、Go／前端／本地浏览器／产品扫描；这些不变运行时的成功结果不重跑，也不声称执行于新文档SHA。
- 新维护轮仍须自己的候选九CI、真实最新审查、合并与master九CI及最终归档。
- 外置证据 .tmp/capability-status-20261103-evidence；owned .superpowers/sdd/2026-11-03-capability-status-plan。归档清理仅该准确leaf可恢复迁出，旧证据、siblings及外部资源不动。
- 不碰PR240、18080、日常DB，不发布／部署／tag；automation保持ACTIVE10分钟兜底。

## 文件职责

- docs/README.md：本轮入口和已完成v0.43.1摘要；旧阶段前插历史标题，不删原文。
- docs/product/overview.md：当前主要闭环和剩余方向，替换“最近仍为v0.33”旧摘要；区分当前与历史。
- docs/product/development-status.md：用户时区、标题标签／内部备注、批量创建／CSV、品牌／页脚当前表，保留历史门禁表及生产缺口。
- docs/product/roadmap.md：待开发表中固定时区／有界导入／固定色已实现，标签只读查找与治理未实现分开，备注已实现；增加正确scope引用。
- docs/product/scope-v0.35.0.md、scope-v0.36.0.md、scope-v0.37.0.md：有原最终收据才添加当前完成摘要，旧原文明确历史；不把设计时盘点改成当下新实施。
- docs/product/scope-v0.43.1.md：仅修R-M1表格前空行及真实最终状态。
- docs/implementation/v0.43.1-{tasks,acceptance,plan}.md：只勾有最终实际证据的Task3项目，增加候选／master／标准任务／归档实证，原执行全部保留。
- docs/specs/2026-11-03-capability-status-design.md、docs/implementation/2026-11-03-capability-status-{plan,acceptance}.md：本轮范围、任务、证据矩阵、限制与独立交付。
- 不改技术约定，因此不改technical-decision／technical-baseline的历史大段；不改AGENTS。

## 审查重点（Review Focus）

1. 已合并与未发布、候选CI与masterCI及维护自身CI分开。
2. 固定时区与任意时区分析、固定色与自由色、CSV创建与导出恢复、只读标签与实体治理的边界不扩大。
3. 旧失败／运行时／未看artifact／扫描severity等限制完整保留。
4. 当前与历史不矛盾，未执行的生产演练不勾选。
5. 只有Markdown改变、全部本地链接有效、原冻结证据hash不变，R-M1解决。

## Task1：准确能力表与状态入口

**Consumes：** v0.43.1实际最终收据和v0.35–43 scope／acceptance。**Produces：** 一致的当前文档、只读证据矩阵与本地原子提交。

- [x] 标准start1，完整brief。建立外置capability-evidence.json，逐项记录能力、精确scope／acceptance、允许的当前表述、仍未实现边界、原收据Path／Bytes／SHA256。需要引用的旧最终收据必须实际读取并核，不重复旧API、CI下载或归档。
- [x] 按文件职责精确patch。每项当前事实对应矩阵来源；历史段只新增历史标签，原文字和顺序保留。正式验收未执行的本轮门禁保持未勾选。
- [x] 运行本地evidence-only验证：git diff --check，所有变更Markdown本地链接存在，git diff --name-only基线仅.md，完整902非Markdown集合／hash／bytes等于基线，引用冻结档案全hashbytes相同。输出唯一proof，实际0。
- [x] 本地原子提交docs(进度): 对齐当前能力与交付状态，精确暂存名单，不覆盖无关改动。建立完成合同并标准done1，只核原成功证据，不重suite。

## Task2：唯一终审与本地标准收尾

**Consumes：** Task1文档及冻结矩阵。**Produces：** 无未处置阻断的整分支审查、完整本地报告及归档。

- [x] 标准start2。唯一fresh最强supported reviewer，给完整base..HEAD及五项Focus；不得访问生产／执行产品suite或派下级。
- [x] 根据信息核实全部意见；Critical／Important必须修有效问题并核文档，Minor按既定规则记完整原因和错误代价。无无关业务扩张或重复审查。
- [x] 同步实际审查阶段，核完整非MD与链接，原子文档提交。生成全部裁决和报告，新whole-owned ZIP／extract全集hashbytes，标准done2实际0。

## Task3：本轮远端与最终可恢复归档

**Consumes：** Task2 clean候选及合同。**Produces：** 本轮真实覆盖、候选／master各九CI、标准完成与最终档案。

标准 start3 已实际 0，BASE `550a34f9e608ae73e2a8bcdf96a5014d3c210bf2`，brief 已全文读取。远端操作及下列联合验收项尚未完成，不能预先勾选。

- [ ] 标准start3，同名push／upstream，唯一PR。自动审查running不催；若skipped读本PR当时评论updated_at＋明示恢复时长，恢复点后fresh无running且该head无manual才一次请求。覆盖必须kind reviewed／source=covered精确最新head；全部有效评论／inline／outside闭环。
- [ ] 候选精确九CI通过，完整raw只capture一次并ROOT连续读至EOF；允许按已读原件精确引用重建文本，不能借执行身份。fresh完整分页讨论、guarded squash match-head，独立API及fetch核masterSHA／tree／唯一父。
- [ ] master自身九CI通过及原rawEOF。完整本轮报告、standarddone3，新whole-owned ZIP／extract／准确leaf可恢复迁出、siblings不变，通知完成后继续合理下一增量。

## 自检

需求矩阵和Task1逐项覆盖五Focus；Task2只审本轮文档，Task3独立远端交付。没有产品实现、测试镜像、依赖安装或多版本混归。本计划复选框只按实际执行更新。
