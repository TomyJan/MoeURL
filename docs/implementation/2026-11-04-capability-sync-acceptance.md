# v0.46.0 后文档状态同步验收

## 范围与阶段

这是独立文档维护，不新增业务版本，不改运行时、API、权限、数据库、依赖或测试。基线为 v0.46.0 实际完整交付后的 master `f3beb002ca88c7f2e4e2398ef22edf1cc9eae267`。本维护自身的本地文档核验、唯一独立审查、候选／master CI、合并和归档分别按实际收据更新，不借基线执行结果。

外置证据为 `D:/Dev/TomyJan/MoeURL/.tmp/capability-sync-20261104-evidence`；`baseline.json` 冻结完整 925 个非 Markdown 路径和各自 hash／bytes、旧最终档案与完整报告。`capability-evidence.json` 保存以下各项允许表述、非目标和原收据身份。

## 能力与归属

| 能力 | 已交付边界 | 仍未实现／保证之外 | 原验收 |
| --- | --- | --- | --- |
| 备注状态 | 本人／全站／CSV 的有备注或无备注与既有筛选取交集 | 备注批量编辑、公开正文 | [v0.44.0](v0.44.0-acceptance.md) |
| 列表分页 | 固定每页 20 条，前后翻页与单页选择；CSV 为全部匹配 | 跨页全选、可变页大小；不为同创建时间的排序作新保证 | [v0.45.0](v0.45.0-acceptance.md) |
| 备注关键词 | 四个只读 POST；最多 100 个 Unicode 码点、字面子串、PostgreSQL lower、当前授权及私密词生命周期守卫 | 全文搜索、正则／通配符、跨字段搜索、备注批量编辑／历史；生产规模及不同 locale 未测 | [v0.46.0](v0.46.0-acceptance.md) |

旧 CI artifact 未下载，不增加 CI 视觉结论。各版本原失败、运行时、缓存构建、扫描提示及生产 DNS/TLS／外部 OIDC／恢复演练缺口保留原验收。已合并不等于正式发布或部署。

## 文档问题处置

M1：原 v0.35“现状盘点”及 v0.37“定位与状态”的实际标题明确历史，保留原文；M2：overview 旧“最近验证”改为历史基线并链接当前验收；M4：roadmap 当前摘要更新至 v0.46；M7：v0.46 Task2 旧浏览器待验明确为当时阶段；M8：能力表将备注关键词列入已交付，保留其他未实现扩展。修正以实际 diff 和本轮文档验证判定，不预先称已完成。

M5 可选测试请求风格与 M6 固定 20 共享常量继续延期，不捆绑运行时重构。成本分别为测试写法一致性和常量维护便利性；既有行为门禁保持原归属。

## 本轮验收条件

- [x] Task1：只修改 Markdown、所有变更本地链接有效、完整 925 源与冻结证据全等；原子提交及标准完成合同。
- [ ] Task2：一次 fresh 独立整分支审查，全部有效问题处理、完整裁决／报告、本地 whole-owned 档案和标准完成。
- [ ] Task3：精确最新候选真实 reviewed／covered、有效讨论闭环、候选自身九 CI 和完整日志 EOF。
- [ ] Task3：守卫 squash、独立 API／fetch／SHA／tree／唯一父一致，master 自身九 CI 和完整日志 EOF。
- [ ] Task3：完整报告、标准完成、新 whole-owned ZIP／解压全集核、准确 leaf 可恢复迁出及 siblings 不变。

本轮不执行本地产品套件／生成器／安装，不重旧远端操作或修改原 ZIP。未发布、部署或打 tag。

## Task1 本地文档验证

`verify-docs.mjs verify task1-initial-check`、`task1-precommit` 和标准 `local-stage.mjs verify1` 均实际退出 0：14 份 Markdown、727 个本地文件链接有效，925 个非 Markdown 路径及逐 hash／bytes 与基线全等，15 项冻结原件不变。Task1 已在 `a16035c1025bd71a4adba2fb9983f1cb640a71e4` 标准完成，合同 `task1-completion-contract.json`；Git 的 LF／CRLF 提示保留，不冒零提示。未执行产品套件／生成器或旧远端操作。

## Task2 唯一独立终审

一次 fresh 独立审查范围 `f3beb002..a16035c1`，Critical 0／Important 0／新增 Minor 0，五项文档问题核实已处理，无修复轮或第二审查者。审查者独立只读核对完整 925 源、14 文档合同、15 冻结原件、727 个文件链接、旧版合并与 CI／归档证据；原报告完整保存于本轮 owned 的 `independent-final-review.md`。后继仅同步本轮实际阶段，原件与源码不变，远端审查及 CI 仍独立待做。

不予判断的五类项目均已裁决并完整记入 `task2-review-decisions.json` 及最终报告：不复现的产品／性能风险不作新保证；实时远端在 Task3 取得；图片与生产缺口保留；不扩为历史全集重写或 M5／M6 重构；不重做旧任务和档案。本地 whole-owned 归档和标准 Task2 以随后实际收据判定，当前进行中。
