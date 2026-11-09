# 路线图

## 当前进展（2026-11-09）

正在进行[Go 压缩依赖安全维护](scope-2026-11-09-go-compression-security.md)：主模块 compress1.20.2，独立 Goose3.28.0 模块固定 compress1.20.2／brotli1.2.7 并保留 x/net0.62.0；产品版本、工具链与业务行为不变。完整本地验证及唯一独立终审通过，Task1–2 标准完成；最新提交 CodeRabbit 真实覆盖、正常集成及可恢复归档仍待完成，见[公开验收摘要](../implementation/2026-11-09-go-compression-security-acceptance.md)。完整 raw 是本地私有归档，新克隆不含原件。

v0.51.1 已由 [PR278](https://github.com/TomyJan/MoeURL/pull/278) 正常合并为 ca0b12a26ba90c442ccb18f8d20c59a96aa69860；3509 项前端／四 100%、220 项标准浏览器及准确产品验证、最终85b真实CodeRabbit覆盖、有效问题处置、三个标准任务、46 条裁决和可恢复归档均完成，见[前版验收](../implementation/v0.51.1-acceptance.md)。原两项文档 Minor 在本次维护落实访问边界和明确状态，不倒填为原 PR 修复。v0.51.0 合并事实、旧 CI 失败及原件缺失／归档缺口仍保留。不等待或伪称 CI 通过，未发布部署，下方旧阶段保持历史归属。

## 当前进展（2026-11-05）

v0.49.2 已通过 [PR268](https://github.com/TomyJan/MoeURL/pull/268) 完整交付，master `8d72dda0696d139194ebea6aaeb24605abbe8607`；最新真实审查覆盖、候选41890239146和master41894181402各九CI／完整日志、标准Task1–3、17条裁决及可恢复归档全部完成。未发布部署，详见[前版验收](../implementation/v0.49.2-acceptance.md)。

v0.49.3 已通过 [PR269](https://github.com/TomyJan/MoeURL/pull/269) 完整交付，master `4b5d4dc4db6d14a430cdc3cdf7238f3d9516da77`。最新真实审查、候选41919580747与master41924031590各九CI及完整日志、标准Task1–3、23条裁决报告和可恢复归档全部完成；未发布部署，见[验收](../implementation/v0.49.3-acceptance.md)。

v0.50.0 已通过 [PR270](https://github.com/TomyJan/MoeURL/pull/270) 完整交付，master `7ede77d48ff086209fd6d043a77000105d7c4870`。最新真实审查覆盖、[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41943898011)与 [master 自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41947207982)及完整日志、标准 Task1–4、22 条裁决与可恢复归档全部完成；未发布部署。首轮旧域名场景 211/212 失败根因未确认的限制保持原归属，见[验收](../implementation/v0.50.0-acceptance.md)。

v0.50.1 已通过 [PR271](https://github.com/TomyJan/MoeURL/pull/271) 完整交付，master `9bcf97bfafe3fd5e1747f692dea8ce2decbb6f53`；最新真实审查、[候选九项 CI](https://github.com/TomyJan/MoeURL/actions/runs/41956791078)和 [master 自身九项 CI](https://github.com/TomyJan/MoeURL/actions/runs/41959310355)及完整日志、三个标准任务、21 条裁决与可恢复归档均完成，未发布部署，见[验收](../implementation/v0.50.1-acceptance.md)。旧单元超时与前版浏览器失败根因未确认。

当前推进 [v0.51.0 当前选择标签重命名](scope-v0.51.0.md)：Task1–2 已标准完成。唯一终审 Important 已经真实目录 RED→GREEN 修复，3501 项前端测试、四项 100%、types／lint／双构建通过。修复候选 f32a81b 的完整 216 项浏览器、73 张相关原图和精确产品验证均通过；保存进度反馈一项 Minor 延期。13 条裁决与完整报告已整理，本地归档／标准收尾及远端交付仍待，见[验收](../implementation/v0.51.0-acceptance.md)和[计划](../implementation/v0.51.0-plan.md)。下方旧阶段按历史归属保留。

## 当前状态（2026-11-04）

v0.48.0 已通过 [PR262](https://github.com/TomyJan/MoeURL/pull/262) 完整交付，master `6aa7c0aa5a805446fae16e7d8453388763081f23`；最新真实审查、候选／master 各九 CI 与完整日志、标准 Task1–3、19 条裁决和可恢复归档均完成。每页 20／50／100，保持权限、私密筛选和全匹配 CSV；未发布部署，见[验收](../implementation/v0.48.0-acceptance.md)。

v0.49.0 已通过 [PR264](https://github.com/TomyJan/MoeURL/pull/264) 完整交付，master `bbdc95e6cce206f217666723a22375f967643d6f`；最终候选真实审查覆盖、候选和 master 各自九 CI／完整日志、标准 Task1–4、28 条裁决报告与可恢复归档均完成，未发布或部署。原运行时与失败保持归属，见[验收](../implementation/v0.49.0-acceptance.md)。

v0.49.1 已通过 [PR265](https://github.com/TomyJan/MoeURL/pull/265) 完整交付，master `81591816c6cde10c78a9f386fcec1ffc8513bc70`；候选最新真实审查覆盖、候选和 master 各九 CI／完整日志、标准 Task1–3、22 条完整裁决及可恢复归档均完成。F1 空 wrapper 间距、M5／M9 和页面鼠标入口边界按原范围保留，未发布部署。见[验收](../implementation/v0.49.1-acceptance.md)。

当前推进 [v0.49.2 空通知区域间距](scope-v0.49.2.md)：额外 14／16 px 间距已真实 RED→GREEN，3253 项前端、203 项完整浏览器／73 张原图和精确产品验证通过；唯一独立终审无 Critical／Important。Task1 标准完成，Task2 本地收尾中；候选真实审查、候选／master 各九 CI、守卫合并和最终归档仍待，见[计划](../implementation/v0.49.2-plan.md)和[验收](../implementation/v0.49.2-acceptance.md)。

[前端 glob 安全维护](../implementation/2026-11-04-frontend-glob-security-plan.md)已通过 [PR263](https://github.com/TomyJan/MoeURL/pull/263) 完整交付，保持 0.48.0 行为和版本号。最终候选与 master 各自九 CI 成功，最新真实审查覆盖和有效问题闭环、守卫合并、标准 Task1–3、28 条裁决完整报告及可恢复归档均已完成，见[验收](../implementation/2026-11-04-frontend-glob-security-acceptance.md)。

v0.47.0 已经 [PR261](https://github.com/TomyJan/MoeURL/pull/261) 完整交付，master `5ed2939c6de3f75e3cb46dac37fcb6ffa06ad74f`；最新真实审查、候选／master 各九 CI 与完整日志、标准 Task1–3、24 条完整裁决和可恢复归档均完成。保持不变集合的确定排序，不承诺跨请求快照；未发布部署，详见[验收](../implementation/v0.47.0-acceptance.md)。

PR260 文档维护已完整交付，master `47e170b455e6b2a8d02d89bcbdaef15a63b06df3`，真实覆盖、候选和 master 各九 CI、完整日志、标准 Task1–3 及可恢复归档均完成；未发布部署。下方旧阶段按原时点保留。

[v0.46.0 备注关键词筛选](scope-v0.46.0.md)已完整交付：[PR259](https://github.com/TomyJan/MoeURL/pull/259) 合并为 `f3beb002ca88c7f2e4e2398ef22edf1cc9eae267`。最终候选 `fedb65a` 已真实审查、有效问题闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41697764468) 与 [master 自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41701602969) 均成功，完整日志分别核至 EOF。标准 Task1–4、25 条裁决报告及可恢复归档完成，未正式发布或部署；详见[验收](../implementation/v0.46.0-acceptance.md)。

## 历史阶段摘要（v0.46.0 交付前，原文保留）

当前实施 [v0.46.0 备注关键词筛选](scope-v0.46.0.md)：私密只读 POST 与现有筛选取交集；唯一独立终审的两项私密词问题已修复，3097 项前端四 100%、183 项完整浏览器、38 张原图及精确产品验证通过。候选真实审查、候选／master 各九 CI、守卫合并与最终归档仍待；见[计划](../implementation/v0.46.0-plan.md)与[验收](../implementation/v0.46.0-acceptance.md)。

v0.45.0 已通过 [PR258](https://github.com/TomyJan/MoeURL/pull/258) 完整交付，master `51003145`；最新真实审查、候选／master 各九 CI、标准任务及可恢复归档完成，未发布部署。下方原阶段记录保留历史归属，最终证据见[验收](../implementation/v0.45.0-acceptance.md)。

[能力文档维护](../implementation/2026-11-03-capability-status-acceptance.md)已完整交付：PR256 合并为 `254fef0f`，最新真实审查、候选和 master 各自九 CI、标准 Task1–3 与可恢复归档完成，未发布部署。两个文档 Minor 继续保留。

当前推进 [v0.45.0 短链列表分页](scope-v0.45.0.md)：固定每页 20 条、前后翻页与单页选择，CSV 仍导出全部已应用筛选。实现和唯一独立终审修复完成，3011 项前端四项 100%、181 项浏览器、34 张相关原图及精确产品验证通过；标准收尾与远端交付继续，见[计划](../implementation/v0.45.0-plan.md)与[验收](../implementation/v0.45.0-acceptance.md)。

[v0.44.0 备注状态筛选](scope-v0.44.0.md)已完整交付：[PR257](https://github.com/TomyJan/MoeURL/pull/257)合并为 `e0072c2`，最新真实审查、候选与 master 各九 CI、标准 Task1–4、完整 37 条裁决及可恢复归档均完成。177 项浏览器、2963 项前端四项 100% 及精确产品验证保持实际运行归属，未发布部署；见[验收](../implementation/v0.44.0-acceptance.md)。下方旧阶段保持历史归属。

[v0.43.1 备注版本边界](scope-v0.43.1.md)已完整交付：[PR255](https://github.com/TomyJan/MoeURL/pull/255)合并为 `10d317e`，候选与 master 各自九项 CI、真实最新审查、标准任务及可恢复归档均完成，尚未发布或部署，详见[验收](../implementation/v0.43.1-acceptance.md)。

当前进行[能力文档维护](../implementation/2026-11-03-capability-status-plan.md)：对齐已经交付的页脚链接、时区显示、批量／CSV 创建、只读标签查找和内部备注，不增加产品行为。各版本原始失败、执行身份与未完成的生产验收保留原记录；本维护轮的审查和 CI 独立验收。

## 历史阶段摘要（原文保留）

当前 [v0.43.1 备注版本边界](scope-v0.43.1.md)已实现，真实 HTTP／客户端回归及完整本地门禁通过，前端 2940 项与四项 100% 覆盖率通过；clean61e938d 的完整 173 项浏览器、18 张原图及精确产品检查通过，Task1 标准完成；唯一独立终审无发现；本地归档与 Task2 标准完成，Task3 已启动，远端交付尚待，见[验收](../implementation/v0.43.1-acceptance.md)。不改数据库、权限、依赖或其他资源解析器。

v0.43.0 已完整交付：[PR254](https://github.com/TomyJan/MoeURL/pull/254)最终候选 fbe0fae 真实审查及有效问题闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41562059864)与合并 master646656 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41567605713)均通过，完整原日志分别核至 EOF。标准 Task1–4、25 条完整裁决报告及全 owned ZIP／解压核验、准确 leaf 可恢复迁出完成。M2 已解决，最终仅延期 M1，本补丁接续处理；未发布部署，见[验收](../implementation/v0.43.0-acceptance.md)。下方旧阶段叙述保留历史归属。

当前 [v0.43.0 短链内部备注](scope-v0.43.0.md)后端、前端、完整 171 项浏览器及精确产品验证通过，16 张原图已逐张检查。唯一独立终审无阻断问题；远端审查、CI、合并与 master 验证尚待；旧 metadata／公开访问／CSV 不增加备注，阶段见[验收](../implementation/v0.43.0-acceptance.md)。

v0.42.0 已完整交付：[PR253](https://github.com/TomyJan/MoeURL/pull/253)最终候选2eab6cd真实审查和有效意见闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41528785613)与合并master a680b224的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41533004155)均成功，完整原日志分别核至 EOF。标准 Task1–4、25条完整裁决报告、新 whole-owned ZIP／解压全集核与准确leaf可恢复迁出完成，无延期Minor。未发布部署，见[验收](../implementation/v0.42.0-acceptance.md)。下方旧阶段叙述保持历史归属。

v0.41.0／[PR249](https://github.com/TomyJan/MoeURL/pull/249)已完整交付：最终候选6829ba3真实审查和有效意见闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41496993103)与合并master9a71bea的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41505792542)均成功，完整日志分别核至 EOF；标准 Task1–4、32 条完整裁决、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出完成，无延期 Minor。未发布部署；见[验收](../implementation/v0.41.0-acceptance.md)。下方旧阶段文字保留历史归属，不代表当前仍待交付。

v0.40.1／[PR248](https://github.com/TomyJan/MoeURL/pull/248)已完整交付：最终候选 c43e600 的真实审查／有效问题闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41423729705)与合并 master 00c893ff 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41430855520)均成功，完整日志核至 EOF。标准 Task1–4、全部 20 条裁决、whole-owned ZIP／解压全集核和准确 leaf 可恢复迁出完成，无延期 Minor；未发布部署。详见[验收](../implementation/v0.40.1-acceptance.md)。下方旧开发阶段叙述保留历史归属。

当前 [v0.40.1 CSV 格式帮助与模板](scope-v0.40.1.md)已实现可折叠中英示例和固定公开模板下载。真实页面行为 RED→GREEN，78 项边界补验、完整 2690 项前端测试／四项 100%、types／lint／隔离 build 通过；下载不改草稿或文件读取，不改解析器、API、数据库、权限或依赖。clean9b14027的完整159项浏览器、精确产品及正常数据库更新的所选HIGH／CRITICAL扫描通过，原图已逐张阅读；唯一终审bc53c75无代码阻断，Task3文档与归档收尾后进入远端交付。候选自身审查／九CI、master及最终归档仍待，见[验收](../implementation/v0.40.1-acceptance.md)。

v0.40.0 已完整交付：[PR247](https://github.com/TomyJan/MoeURL/pull/247) 最新候选 `e2fee88036ab9637c455bbdccc56d1d3c00bfee5` 的真实审查与全部有效意见闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41401442214) 和合并 master `b4879c0ffd1e7a2048a68479d3fd487227f0926d` 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41408228013) 均成功，完整日志分别核至 EOF。标准 Task1–4、全部 26 条裁决报告、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出完成，格式示例 M1 当时延期；未发布部署。见[验收](../implementation/v0.40.0-acceptance.md)，下方旧阶段文字保留历史归属。

v0.39.0 已完整交付：[PR246](https://github.com/TomyJan/MoeURL/pull/246) 最终候选 `647b013fa1b04f4eb874ceb32d8df97f375c072e` 的真实审查与全部有效意见闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41367196539) 和合并 master `7bf680b3a487e2ad364589b79d325de15cb9e1bd` 的[九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41371662994) 均成功。master 原 8 项成功，运行器失联的 E2E 单独恢复后 149 项通过；完整成功日志为保留原件的可重建组合，内容核验至 EOF，未冒九项重跑。标准 Task1–4、30 条完整裁决报告、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出均完成，未发布或部署。下方旧阶段保留历史归属。

v0.38.0 已完成交付：[PR245](https://github.com/TomyJan/MoeURL/pull/245) 最终候选 b2d19823c70a59d479bbc8d452f97c174c32bb1d 的真实审查／有效意见已闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41340395109) 与合并 master07d4f6c3af23c4f50cd94021d2af13fe0a889c87 的[九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41344911045) 均成功，完整日志分别核读至 EOF。标准 Task1–4、完整 41 条裁决报告与 whole-owned ZIP／解压全集核、准确 leaf 可恢复迁出完成；未发布或部署。下方旧阶段保留历史归属。

当前迭代：v0.37.0／PR244 已完整交付，未正式发布；[v0.38.0 有界批量创建](scope-v0.38.0.md)后端 Task1 已标准完成，前端完整 2534 测试、四项 100%、types／lint／隔离 build 通过，Task2 已在 2b2ee2a 标准完成，Task3 已标准启动；手机提示已真实 RED→GREEN，clean bfb9828 的完整 144 项浏览器、八张原图实读和标准产品／精确镜像扫描通过，唯一终审、本地归档与远端交付仍待。它是最多 20 条网址的本人原子创建，不是 CSV 导出恢复。账号固定时区、精确时间、三个强调色预设与有界页脚均已交付；下方旧规划保持历史边界。

2026-11-01 下一阶段为 [v0.37.0 精确记录时间](scope-v0.37.0.md)：在已经交付的 v0.36.0 上解决两项显示问题，保持原协议、权限和数据；不据此扩展后台能力或宣称发布。当前已完成本地实现及定向验证，[正式计划](../implementation/v0.37.0-plan.md)按本地实现、独立终审、PR 与 master 自身验证分阶段推进。

2026-11-01 当前摘要：[v0.36.0 账号时区显示预设](scope-v0.36.0.md)按正式[实施计划](../implementation/v0.36.0-plan.md)实施：Task1–2 已分别标准完成（90674e6／070627a），完整前端 2443 测试及四项 100%、后端业务 100% 已通过。Task3 在 clean 544a0706 上完整 128 项浏览器通过，5 张原图已实读；标准产品 smoke 与同一精确镜像的正常漏洞库更新扫描通过，两次下载失败与官方镜像恢复分别保留。唯一终审已完成（Critical 0／Important 1／Minor 1），认证暂时失败后时区编辑器无法恢复的问题已真实 RED→GREEN；修复后完整 2449 项前端测试、四项 100%、types／lint／build 已通过。修复候选 b5a3dcea 的新完整 128 项浏览器（10.8 分钟）、5 张原图实读及标准产品／精确镜像扫描已通过；原重连超时失败及不变输入诊断分别留证，不称已证明其根因。本地归档／标准收尾与远端交付仍待；独立本人偏好／CAS、九固定 IANA 与身份轮次隔离，只改显示，不改 UTC 统计、CSV、到期输入或公开访问，无新依赖或权限。v0.35.0／PR239 已完成交付；其后 PR242 有界测试回滚维护已合并为 08b990d70bf30dbe54f885d0b7a3bc9490eacb89，真实审查、候选及 master 各九 CI、标准任务与可恢复归档均完成，未正式发布。下方带时间的旧待做叙述均保留其历史归属，不表示当前仍未交付，也不借旧证据给本版。

2026-10-30 19:06 UTC 文档状态同步（远端状态只据 2026-10-30 18:13:09 UTC 只读快照，非本次实时查询）：Task1–3 已标准完成，Task4 进行中且仅步骤 1 已完成。既有 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 已推送候选 `c44d23c0c7fe9ff41c52c19bd92dbe3c45636b08`；其自身 [CI run41097109781](https://github.com/TomyJan/MoeURL/actions/runs/41097109781) 九项 SUCCESS，完整 7331 行原始日志现已 ROOT 连续读至 EOF。真实 CodeRabbit review5716229915 的 kind=reviewed、sourceCommitId=coveredCommitId=该候选完整 SHA，review 与 overview 已全文读回；快照 effective open 为 0，但两条新增 outside 文档 Minor 仍须本次字段／状态同步及一次公开处置闭环，不与原五类延期 Minor 混合。本次文档后继的自身 CI、完整原始日志与真实 exact-head 审查仍待，不借 c44 证据；尚未合并、未完成 master 自身 CI／标准 Task4／最终归档清理，未 tag／release／deploy。以下旧阶段与失败记录均为历史，保留实际提交、输入、运行时和证据归属。

历史记录（原文保留）：当前有界迭代为 [v0.35.0 页脚链接](scope-v0.35.0.md)，落实已有自定义链接规划：最多 5 项有序文本／HTTP(S) URI、独立当前授权／CAS／审计，无抓取或上传。正式[规格](../specs/2026-10-30-v0.35.0-footer-links-design.md)与[计划](../implementation/v0.35.0-plan.md)对应的后端、前端和浏览器已实现，Task1–3 标准完成；[PR #239](https://github.com/TomyJan/MoeURL/pull/239) 的候选 CI 有三项失败，ACE 校验及旧 E2E 选择同步窄修中，未合并、未发布。Logo／Favicon、任意主题色与全站访问合并导出不混入本版；旧五类延期 Minor 不顺手修复。

[v0.34.0 站点强调色预设](scope-v0.34.0.md) 已由 [PR #237](https://github.com/TomyJan/MoeURL/pull/237) 于 2026-10-29T21:10:29Z 合并为 fc88c0e8b9192174e62b225fdc3cb0b87a253451。最终候选 99ebef5 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40949991695) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40955501280) 各九项成功，真实审查覆盖最终候选、全部有效意见闭环；标准 Task1–4、完整最终归档与准确 owned leaf 可恢复清理完成，未正式发布。固定 iris／ocean／forest 三预设、独立 CAS 与仅键名审计保持既有主题模式、个人偏好和公开访问；任意颜色编辑仍未开放；本次维护不改依赖、权限或 schema。原失败、逐候选运行时和当时延期三项 Minor 见[验收](../implementation/v0.34.0-acceptance.md)。当前[独立验证与文档维护](../implementation/2026-10-30-site-accent-closeout-plan.md)不新增业务版本；补验 Task1 已标准完成，维护自己的终审及 PR／CI／合并仍待做。

品牌方向中的 [v0.33.0 首屏标题与简介](scope-v0.33.0.md) 已由 [PR #231](https://github.com/TomyJan/MoeURL/pull/231) 合并为 `811d6c57`；[v0.33.1 反馈补丁](scope-v0.33.1.md) 已由 [PR #232](https://github.com/TomyJan/MoeURL/pull/232) 合并为 `cf5d5a64`。补丁最终 `91cf9d5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40885738492) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40892523382) 各九成功、真实审查／有效意见闭环、标准 Task1–3 及最终可恢复归档完成；未正式发布。纯文本、逐字段留空回退、独立资源与版本保持，不扩展 Logo、主题色、HTML、翻译管理或 CMS。原失败、执行归属与限制见[验收](../implementation/v0.33.1-acceptance.md)。

二维码样式的 [v0.32.0 三个固定外观预设](scope-v0.32.0.md) 已通过 [PR #230](https://github.com/TomyJan/MoeURL/pull/230) 合并为 `99f87709`，最终 PR CI40816638924 与合并 master CI40821882951 各九成功，真实最新审查／有效意见闭环，标准 Task1–4 和最终完整归档完成。未正式发布；原候选制品保持[验收](../implementation/v0.32.0-acceptance.md)归属，任意编辑、Logo 和持久模板仍未开发。

OIDC 创建模板 [v0.31.0](scope-v0.31.0.md) 已由 [PR #229](https://github.com/TomyJan/MoeURL/pull/229) 合并为 `c6712051`，最终 `e9c3025` 的 PR CI40741884841 与合并 master CI40748005532 各九成功，真实最终审查、有效意见闭环，标准 Task1–4 及完整最终归档完成。仅 Google／手动草稿，未正式发布；主动绑定、组映射、多租户与自定义模板继续未开发。原执行身份见[验收](../implementation/v0.31.0-acceptance.md)。

v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](../implementation/v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

[v0.29.0 每域名默认跳转方式](scope-v0.29.0.md) 已由 [PR #227](https://github.com/TomyJan/MoeURL/pull/227) 合并为 `8af05d60fb89769f7aaabf4da4906ed411fdad48`。最终 `4dfa4d43` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40629796924) 与合并 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40631422772) 各九成功、真实最新审查闭环，尚未正式发布。只做域名级模式配置和当前有权创建初选，不扩模板、DNS/TLS、个人／组跳转偏好或旧 API 省略语义；唯一终审、root 修复、原失败及逐候选见[验收](../implementation/v0.29.0-acceptance.md)。

MoeURL 按「基础可用闭环 → 发布质量补强 → 产品体验精细化 → MVP 增强闭环 → 统计分析闭环 → 增强能力」逐步推进。

截至 2026-10-28（Asia/Singapore），v0.26 个人默认、v0.27 域名排序、[v0.28 用户组默认](scope-v0.28.0.md)及 v0.29 每域名默认方式均已合并，各自最终 PR 与合并 CI 各九成功、真实审查闭环。v0.28 的逐候选和原失败仍见[验收](../implementation/v0.28.0-acceptance.md)，不以 v0.29 结果代替。旧 API 省略字段、已有短链及公开访问语义保持；旧手机 E2E 故障及恢复保留原归属，正式生产验收与发布独立记录。

## v0.26.0 个人默认短链域名

在个人设置显式保存当前可用域名，跨浏览器作为创建面板初始选择；独立版本、授权回退及身份隔离，保留后端省略语义。v0.26.0 已通过 [PR #224](https://github.com/TomyJan/MoeURL/pull/224) 合并为 `60b36fec2d063785a8c97855d5a6d38a950c4ad3`，最终候选 `0305c016` 的 [PR CI #40438886293](https://github.com/TomyJan/MoeURL/actions/runs/40438886293) 与合并提交的 [master CI #40444537045](https://github.com/TomyJan/MoeURL/actions/runs/40444537045) 各 9 项成功，实际 CodeRabbit 首审及最终增量覆盖最新变更，全部有效意见已处理；尚未正式发布。逐候选证据见[验收](../implementation/v0.26.0-acceptance.md)，边界见[范围](scope-v0.26.0.md)和[设计](../specs/2026-10-27-v0.26.0-personal-default-domain-design.md)，不包含组默认、排序管理或绑定。

## v0.25.0 操作审计 CSV 导出

管理员按已应用 UTC 日期与操作者／资源／动作筛选下载完整审计元数据，最多 1000 条，原文与最终 CSV 各 8 MiB，受保护 `audit:export` 叠加既有读取权限；同一只读快照重查当前账号、数据库权限和 180 天保留截止。保留完整 bigint、UTC 时间和字段数组，不包含业务值或秘密，不新增采集、归档、全站访问合并或后台任务。已通过 PR #222 合并，尚未正式发布；逐阶段验证及合并后 CI 修复跟进见[范围](scope-v0.25.0.md)、[设计](../specs/2026-10-27-v0.25.0-audit-export-design.md)与[验收](../implementation/v0.25.0-acceptance.md)。

## v0.24.0 匿名访问记录 CSV 导出

个人与管理单链分析的访问记录区域，按当前已应用的最多 90 天 UTC 日期及设备／国家筛选下载完整匿名成功事件，最多 1000 条、原始文本与最终 CSV 各 8 MiB；超限整体拒绝。独立导出权限叠加既有读取与归属，同一只读快照重查数据库授权；本版无新增采集、审计导出、全站合并或后台任务。已通过 PR #219 合并为 `5c3fee5c`，最终 PR 与合并提交 CI 各 9 项成功，尚未正式发布；逐候选证据见[范围](scope-v0.24.0.md)、[规格](../specs/2026-10-26-v0.24.0-visit-record-export-design.md)和[验收](../implementation/v0.24.0-acceptance.md)。

## v0.23.0 批量标签整理

补足原“批量整理”方向，在个人与全站当前列表对最多 100 条短链添加、移除或替换标签。逐条完整版本、事务内权限／归属重查、全量预检和全批回滚；只改实际变化的标签和版本，保留标题、访问配置与历史。无集中标签库、跨页选择或后台作业。已通过 PR #218 合并为 `5f6702d9`，最终 head `635b53ae` 的[目标 CI](https://github.com/TomyJan/MoeURL/actions/runs/40300323879)及[合并后 CI](https://github.com/TomyJan/MoeURL/actions/runs/40306786126)各 9 项成功；实际完整复审覆盖最终 44 文件且无有效意见，尚未正式发布。范围与证据见[范围](scope-v0.23.0.md)、[设计](../specs/2026-10-26-v0.23.0-batch-tags-design.md)、[验收](../implementation/v0.23.0-acceptance.md)。

## v0.22.0 批量短链归属转移

补足原后台规划：管理员对当前列表最多100条指定一个接收账号，每条固定完整精度版本；任一不存在／软删／陈旧版本／审计故障整批回滚。同owner不写版本或审计，保留原地址、访问条件、用量和历史统计。复用现有权限与模型，无跨页选择、个人赠送或部分成功。设计与执行见[范围](scope-v0.22.0.md)、[规格](../specs/2026-10-25-v0.22.0-batch-ownership-design.md)、[计划](../implementation/v0.22.0-plan.md)。

## v0.21.0 短链清单 CSV 导出

个人与全站列表按当前关键词、状态和标签筛选导出清单，新增独立导出权限，服务端同语句重查账号、权限与归属。最多 1000 条，累计原始文本读取与最终 CSV 各有独立 8 MiB 预算，超限拒绝，空结果可导出表头；UTF-8 BOM、标准转义与公式中和，保留原短链域名，不输出密码、令牌或原始访问记录。不含导入、无限量后台作业或访问明细／审计导出。设计与实施状态见 [范围](scope-v0.21.0.md)、[规格](../specs/2026-10-24-v0.21.0-link-list-export-design.md) 和 [验收](../implementation/v0.21.0-acceptance.md)。

## v0.20.0 短链归属转移

已通过 PR #214 合并为 `2d23dcfd`，尚未正式发布。补齐原管理规格中的单条短链所属用户调整：管理员准确指定接收账号，事务内重查授权和接收人状态，完整精度版本防止覆盖，owner_id 与审计原子提交。公开地址、访问条件及历史统计保留，新所有者接管个人管理和统计权限。不含批量转移、个人赠送、域名迁移或导入导出。详见 [范围](scope-v0.20.0.md)、[设计](../specs/2026-10-23-v0.20.0-link-ownership-design.md) 和 [验收](../implementation/v0.20.0-acceptance.md)。

## v0.0.1 基础可用闭环

v0.0.1 聚焦初始化、本地登录、创建短链、访问短链、基础权限和基础界面能力。

详细范围见 [v0.0.1 范围](scope-v0.0.1.md)。

## v0.0.2 发布后质量补强闭环

v0.0.2 聚焦 v0.0.1 合并后的发布质量、管理体验和验证闭环。

详细范围见 [v0.0.2 范围](scope-v0.0.2.md)。

v0.0.2 阶段范围：

- v0.0.1 验收记录闭环。
- 管理员用户列表。
- 管理员启用、禁用、修改昵称和重置普通用户密码。
- 我的短链状态筛选。
- 管理员全站短链状态筛选和关键词搜索。
- E2E、覆盖率和 Docker Compose 验证补强。
- README 和部署验证说明补强。

## v0.0.3 UI/UX 精细化重设计

v0.0.3 聚焦 MoeURL 的第一轮产品体验精细化，让已有功能从「能用」推进到「体验稳定、视觉完整、后续页面可扩展」。

详细范围见 [v0.0.3 范围](scope-v0.0.3.md)。

v0.0.3 阶段范围：

- 新浅色主题，采用「雾蓝石墨」方向下的冷白、雾蓝和石墨文字。
- 新深色主题，采用「雾蓝石墨」方向下的蓝黑、钢蓝表面和冰蓝主操作。
- 大圆角视觉系统和全局表面规则。
- 首页融合式顶部导航。
- 首页首屏短链快速生成。
- 首页轻量下翻介绍区。
- 可复用短链生成组件。
- 控制台「新建短链」浮窗。
- 桌面端控制台左侧导航。
- 移动端控制台汉堡菜单和抽屉导航。
- 控制台账号入口策略。
- 我的短链、全站短链、用户管理和创建用户页面迁移到统一控制台框架。

v0.0.3 当时不补充统计、访问密码、短链过期时间、中间页跳转、确认页跳转和二维码能力。上述业务能力已由后续版本实现；当前配色已由 [2026-10-15 配色规范](../specs/2026-10-15-color-refresh-design.md) 替代本节历史配色。

## v0.0.4 基础统计前置

v0.0.4 聚焦短链访问基础统计，让已有短链列表可以展示访问表现，并为 v0.1.0 的统计页打下数据基础。

详细范围见 [v0.0.4 范围](scope-v0.0.4.md)。

v0.0.4 阶段范围：

- 已成功写出跳转响应的短链事件持久化。
- 我的短链列表展示总访问量、今日访问量和最近访问时间。
- 管理员全站短链列表展示总访问量、今日访问量和最近访问时间。
- 统计查询和 API 响应测试。
- 控制台列表统计展示测试。

v0.0.4 不补充独立统计分析页、短链详情页、近 7 天趋势图、来源/设备/地区维度、访问明细、统计导出、访问密码、短链过期时间、中间页跳转、确认页跳转和二维码能力。

## v0.1.0 统计分析闭环

v0.1.0 在 v0.0.4 列表基础统计之上，补充独立统计分析页、近 7 天访问趋势，以及来源、设备和地区维度聚合统计。

该版本不保存访问 IP、完整 User-Agent、完整 Referer 或单次访问明细；不实现导出和任意日期范围。

v0.1.0 统计最低完成标准：

- 复用 v0.0.4 已提供的总访问量、今日访问量和最近访问时间。
- 每条短链展示近 7 天访问趋势。
- 支持按来源、设备类型、地区查看聚合统计。
- 不要求展示单次访问明细。
- 不要求导出统计数据。

## v0.1.1 控制台个人概览

v0.1.1 在既有控制台 Shell、短链列表统计和单短链分析之上，将 `/console` 从规划中占位页升级为当前用户的真实工作台。

详细范围见 [v0.1.1 范围](scope-v0.1.1.md)。

v0.1.1 最低完成标准：

- 展示当前用户的短链总数、启用数、总访问量和今日访问量。
- 展示最近创建的 5 条短链，并衔接我的短链和访问分析。
- 不通过当前分页推算全量统计，不展示伪造趋势。
- 不扩展为系统级管理员仪表盘。

## v0.1.2 个人设置基础闭环

v0.1.2 在既有控制台 Shell、登录态和前端偏好系统之上，补齐个人设置页与当前用户昵称自助修改，让用户中心从「可查看」推进到「可编辑」。

详细范围见 [v0.1.2 范围](scope-v0.1.2.md)。

v0.1.2 最低完成标准：

- 提供个人设置页，可查看当前账号信息并修改昵称。
- 首页账号入口和控制台账号入口可以进入个人设置页。
- 保留语言和主题偏好入口，并继续使用前端本地存储保存偏好。
- 不引入头像上传、密码修改、服务端偏好同步或系统设置表单。

## v0.2.0 短链访问体验与生命周期

v0.2.0 在既有直接跳转、短链管理和统计链路之上，补齐中间页跳转、可选过期时间、二维码和访问配置编辑。

详细范围见 [v0.2.0 范围](scope-v0.2.0.md)。

v0.2.0 最低完成标准：

- 既有短链继续默认直接跳转，中间页模式由权限控制并可配置 3 至 10 秒倒计时。
- 过期短链被访问流程拦截，不计入成功访问量。
- 创建结果、我的短链和全站短链可以生成二维码并维护访问配置。
- 中间页、继续跳转和访问统计使用一致的事件口径。
- 访问密码、确认页、二维码样式和完整权限管理不混入当前范围。

## v0.3.0 受保护短链访问

v0.3.0 在 v0.2.0 访问配置和中间页基础上交付访问密码的完整安全闭环。

详细范围见 [v0.3.0 范围](scope-v0.3.0.md)。

v0.3.0 最低完成标准：

- 有权限用户可以设置、修改和清除访问密码。
- 密码只保存 Argon2id 哈希；同一短链在 15 分钟内连续失败 5 次后限流 15 分钟。
- 正确密码签发 15 分钟短期授权；修改或清除密码后，现有授权立即失效。
- 受密码保护且无有效授权、禁用、软删除或过期短链不跳转、不增加访问量；无密码的 direct 和 intermediate 短链无需访问授权即可跳转。
- 创建、设置和公共密码页覆盖桌面与移动端 E2E。

## v0.4.0 确认页访问

v0.4.0 在 v0.3.0 公共访问页和密码授权基础上增加确认页跳转，让访问者查看目标主机名并主动确认后再进入目标地址。

详细范围见 [v0.4.0 范围](scope-v0.4.0.md)。

v0.4.0 最低完成标准：

- 有权限用户可以创建和编辑 `confirmation` 模式短链，并可切回 direct 或 intermediate。
- 无密码确认页不自动跳转；受密码保护确认页在解锁后仍要求主动继续。
- 公开预览只返回短码、目标主机名、跳转模式、可选倒计时和过期时间，不返回完整目标 URL、密码状态或授权状态。
- 确认页进入和点击不增加访问量，只有最终目标 `302` 成功写出后计量。
- 桌面与移动端 E2E 覆盖真实确认页、密码组合、二次访问条件检查和统计口径。

## v0.5.0 用户组权限管理

v0.5.0 在现有 `user_group.permissions` 动态权限数据源之上，将控制台用户组占位入口升级为真实管理闭环，并交付权限预设模型的第一个可用版本。

状态：已于 2026-08-29 完成版本验收，发布证据见 [v0.5.0 验收清单](../implementation/v0.5.0-acceptance.md)。

详细范围见 [v0.5.0 范围](scope-v0.5.0.md)。

v0.5.0 最低完成标准：

- 管理员可以查看 `guest`、`user`、`admin` 三个内置用户组的真实权限。
- `guest` 在访客资源归属与滥用防护实现前保持只读空权限，只编辑 `user` 和 `admin`。
- 权限按稳定目录和能力分类展示，支持逐项编辑以及 `restricted`、`basic`、`standard` 三个预设。
- 受保护管理权限不能从 `admin` 移除或授予其他内置组，避免管理员自锁和无效权限组合。
- 写入使用乐观并发，冲突不能静默覆盖；权限更新对后续 `auth/me` 和业务请求立即生效。
- 不实现自定义用户组、成员迁移、多用户组、域名授权、配额或审计日志。

## v0.6.0 生产就绪闭环

v0.6.0 不新增短链产品能力，聚焦把 v0.5.0 功能基线交付为可验证的单机生产部署。目标拓扑为 Docker Compose + 外部 TLS 反向代理。

当前代码实现已经完成；目标运行时、安全扫描、真实容器 smoke、隔离恢复和远程 CI 证据仍待补齐，版本尚未完成生产验收。

详细范围见 [v0.6.0 范围](scope-v0.6.0.md)。

v0.6.0 最低完成标准：

- 应用支持有界优雅退出、完整 HTTP 超时、请求 ID、panic 恢复、安全响应头和请求体限制。
- liveness 与 PostgreSQL readiness 分离，Compose 使用应用 readiness 健康检查。
- PostgreSQL 不默认暴露宿主机端口，应用默认只绑定回环地址，生产数据库密码和初始化 Token 必须显式配置。
- 登录具备数据库一致失败限流和未知用户等价密码校验路径，过期或撤销 Session 可以分批清理。
- 提供外部 TLS 反向代理、备份、隔离恢复、升级和灾难恢复演练说明。
- race、Go 漏洞、镜像扫描、Compose smoke test 和既有全部质量门禁通过。

v0.6.0 不实现高可用、Kubernetes、内置 TLS、完整指标/追踪平台、事件归档或新的产品管理页面。

## v0.7.0 多提供商 OIDC 登录

v0.7.0 在既有本地账号、数据库权限和 Cookie Session 之上增加可管理的多提供商 OIDC 登录，不建立第二套用户或权限模型。

状态：功能实现与本地可执行门禁已完成；目标 CI、race、外部 OIDC 互操作和生产发布验收待补。

详细范围见 [v0.7.0 范围](scope-v0.7.0.md)。

v0.7.0 最低完成标准：

- 管理员可以新增、编辑、启停和软删除多个标准 OIDC 提供商，Client Secret 加密保存且不回传。
- 登录使用 Authorization Code + PKCE，并完整校验 state、nonce、Issuer、Audience、签名和时间声明。
- 符合邮箱域名策略的新外部身份创建本地 `user`，重复登录复用既有身份和 Session 体系。
- 不按邮箱自动连接既有账号，不自动授予管理员权限。
- 登录页、身份认证管理页、migration、清理任务和端到端测试形成完整闭环。

v0.7.0 不实现禁用本地登录、账号主动绑定、提供商模板、组织同步、系统品牌和通用系统设置。

## v0.8.0 多域名管理

v0.8.0 已完成管理员管理多个短链域名、内置用户组授权、全局默认域名切换和用户创建选择的功能实现，公开访问限定在短链所属的启用域名。合并提交 `f818a7e8` 对应的 PR 合并验证已通过全量 CI、Linux race、安全扫描、Playwright 与 Compose smoke；域名 DNS/TLS 由部署者配置，不自动迁移旧链接或扩展个人、用户组默认域名，真实 DNS/TLS、隔离恢复和生产发布验收仍待证据。

详细范围见 [v0.8.0 范围](scope-v0.8.0.md)。功能与目标环境验收状态以该范围和对应验收清单为准。

## v0.9.0 系统设置与站点品牌基础闭环

v0.9.0 复用现有 `system_setting`、前端偏好和 OIDC Provider 管理，补齐站点名称、系统默认语言、系统默认主题、简单页脚和本地登录开关。关闭本地登录必须保留至少一个可用 OIDC Provider，并与 Provider 更新、停用和删除使用同一事务锁边界，避免管理员自锁。

状态：功能实现完成；本地可执行门禁已有阶段性证据，目标运行时、完整 Compose smoke、外部互操作和生产发布验收待补。

详细范围见 [v0.9.0 范围](scope-v0.9.0.md)。本版本不实现媒体上传、主题编辑器、自定义 CSS、OIDC 模板、审计日志或部署配置在线修改。

## v0.10.0 短链最大访问次数

补齐既有访问条件中的最大访问次数：有权限用户可设置、调整和清除限额，最终跳转通过数据库原子领取额度，公开访问在耗尽后统一拒绝。默认无限额不增加同步写入；额度用量与匿名访问统计独立，不从历史事件回填。

范围见 [v0.10.0](scope-v0.10.0.md)，实现与门禁证据见 [验收清单](../implementation/v0.10.0-acceptance.md)。不包含自动重置、手动清零、额度历史或告警。

## v0.11.0 短链标题与标签

已实现创建、编辑、清空、列表展示、关键词与精确标签筛选，并保持管理权限和公开响应隔离。范围见 [v0.11.0](scope-v0.11.0.md)，本地门禁及未完成的容器、CI、发布证据见 [验收清单](../implementation/v0.11.0-acceptance.md)。独立标签库、颜色、层级和批量整理不混入该版本。

## v0.12.0 自定义短码

已合并创建时指定 3–32 位 ASCII 字母数字短码，大写规范化为小写。默认仍随机生成；指定值受独立权限控制，禁止固定路由、全局重复及软删除短码复用。既有短链地址不可编辑，不增加在线可用性探测。范围见 [v0.12.0](scope-v0.12.0.md)，本地验证、独立审查与待补齐的目标环境证据见 [验收清单](../implementation/v0.12.0-acceptance.md)；未据此声明正式发布。

## v0.13.0 个人密码修改

已通过 PR #186 合并已有本地账号的密码修改：证明当前密码，原值提交新密码，事务内撤销全部旧 Session 后重新登录。复用登录失败窗口与并发限制，纯 OIDC 账号不通过此入口建立本地密码。不包含找回密码、会话列表或账号绑定。范围见 [v0.13.0](scope-v0.13.0.md)，本地验证与尚缺的目标环境证据见 [验收记录](../implementation/v0.13.0-acceptance.md)。

## v0.14.0 统计日期范围

已通过 PR #187 合并近 7／30／90 天与最多 90 天的自定义 UTC 日期范围，尚未据此声明发布。趋势、区间访问量和三类维度统一按区间计算，保留全生命周期概览；不增加事件采集、详细统计、导出或全局仪表盘。范围见 [v0.14.0](scope-v0.14.0.md)，执行与原分支证据见 [实施计划](../implementation/v0.14.0-plan.md) 和 [验收记录](../implementation/v0.14.0-acceptance.md)。

## v0.15.0 账号语言与主题偏好

已通过 PR #190 合并为 `2ec7eaa4`，完成个人设置的账号保存与登录加载，语言和主题可分别沿用浏览器设置；原分支门禁不替代合并或发布验证。浏览器即时切换保持本地行为，账号覆盖层在退出时清除；保存通过版本检查避免静默覆盖。不包含头像、时区、默认域名或后台代改。范围见 [v0.15.0](scope-v0.15.0.md)，执行与实际证据见 [实施计划](../implementation/v0.15.0-plan.md) 和 [验收记录](../implementation/v0.15.0-acceptance.md)。

## v0.16.0 聚合统计 CSV 导出

已通过 PR #191 合并为 `bd4c2625`，未正式发布。复用既有分析结果并新增导出权限；只包含匿名聚合，不实现原始访问记录、全站批量导出或后台任务。范围见 [v0.16.0](scope-v0.16.0.md)，原分支执行与实际证据见 [实施计划](../implementation/v0.16.0-plan.md) 和 [验收记录](../implementation/v0.16.0-acceptance.md)。

## v0.17.0 短链批量管理

已通过 PR #198 合并为 `3eda85de`，实现个人／全站列表的多选、批量启用、停用和软删除。历史主分支候选 `c4928a85` 包含当时的依赖与 Go 安全修复，完整目标 CI 9 项通过；当前提交的 CI 与生产验收另行记录。每次最多 100 条，服务端重新核验当前授权并原子执行，删除前确认；不包含跨页全选、批量导入或归属转移。边界见 [范围](scope-v0.17.0.md)，原分支历史结果和主分支证据分别见 [计划](../implementation/v0.17.0-plan.md) 和 [验收记录](../implementation/v0.17.0-acceptance.md)。

## v0.18.0 全站统计、访问明细与操作审计

已通过 PR #208 合并为 `0f01a2e5`，提供受权限交集控制的全站快照和只读审计页，匿名访问记录位于个人／管理的单短链分析二级区域。日期最多 90 个 UTC 日，分页有界；浏览器／系统只保存类别，审计只保存标识、动作和字段名。关键写入和日志同事务，审计在线保留 180 天，备份策略独立维护。范围见 [v0.18.0](scope-v0.18.0.md)，本地、候选、远端与发布状态分开记录在 [验收](../implementation/v0.18.0-acceptance.md)。

## v0.19.0 用户组成员迁移

已通过 [PR #211](https://github.com/TomyJan/MoeURL/pull/211) 合并为 `c08b67b2`，尚未正式发布。管理员可为其他非内置账号切换 user／admin；事务内重查当前授权，按完整精度版本拒绝冲突，改组、全部旧会话撤销与审计原子提交。同组 no-op，前端保留账号快照并等待身份就绪。原候选完整本地门禁与修复后复测、远端 CI 分开记录，见 [范围](scope-v0.19.0.md)、[计划](../implementation/v0.19.0-plan.md) 和 [验收](../implementation/v0.19.0-acceptance.md)。

## 待开发能力

2026-11-05：已交付增量截至 v0.50.1，含确定列表顺序、有无备注、每页 20／50／100 条（默认 20）、最多 100 码点私密备注关键词交集筛选，以及当前页 1–100 条备注原子清空（PR264）、统一替换（PR270）和保存文案维护（PR271）；v0.49.1–2 通知布局维护及 v0.49.3 手机通知与导航维护均已交付，没有新增导航入口。候选与主分支 CI 保留各自归属，尚未正式发布；v0.51.0 标签重命名已完成前后端标准任务，终审 Important 已 TDD 修复，完整前端、216 项浏览器、73 张相关原图检查和精确产品验证均已通过，本地归档及 Task1–3 标准收尾已完成，远端交付仍待。下表列剩余扩展，不重复列已交付能力。历史“本版不实现”仅描述该版本范围。

以下为后续能力；自定义短码已合并，个人密码修改已单列为 v0.13.0。每项启动前须收敛独立范围、权限和验收标准。生产验证缺口另见进度清单，不作为新功能重复列入。

| 方向 | 当前基础 | 尚待开发 | 规格来源 |
| --- | --- | --- | --- |
| 账号与用户组 | 本地／OIDC、昵称／密码、语言／主题、内置组及有界成员迁移；Google／手动创建模板、九固定 IANA 时区显示及个人默认方式已交付。 | 头像、任意时区目录、其他偏好、自定义组／多用户组、自定义 OIDC 模板、主动绑定和组映射。 | [认证](../specs/users-and-auth.md)、[成员迁移](scope-v0.30.0.md)、[创建模板](scope-v0.31.0.md)、[时区显示](scope-v0.36.0.md)、[默认方式](scope-v0.39.0.md) |
| 短链组织与交换 | 标题／标签、单条／批量转移、有界清单 CSV、批量标签整理；最多 20 条原子创建、单列 CSV 录入／模板、本人／全站只读标签查找、内部备注及有无备注筛选、每页 20／50／100 条（默认 20）及单页选择、最多 100 码点私密备注关键词交集筛选、当前页 1–100 条备注原子清空（PR264）及统一替换（PR270）均已交付。列表／CSV 不返回备注正文，CSV 导出全部匹配元数据。 | 个人赠送、导出清单恢复、多列／历史导入、独立标签实体及重命名／合并／颜色层级、全文搜索、备注追加／历史／撤销、跨页全选；尚未正式发布。 | [短链](../specs/short-links.md)、[批量创建](scope-v0.38.0.md)、[CSV 录入](scope-v0.40.0.md)、[格式帮助](scope-v0.40.1.md)、[本人查找](scope-v0.41.0.md)、[全站查找](scope-v0.42.0.md)、[备注](scope-v0.43.0.md)、[补丁](scope-v0.43.1.md)、[备注状态](scope-v0.44.0.md)、[分页](scope-v0.45.0.md)、[私密关键词](scope-v0.46.0.md)、[每页条数](scope-v0.48.0.md)、[批量清空](scope-v0.49.0.md)、[统一替换](scope-v0.50.0.md) |
| 分析与操作追溯 | 个人概览、匿名单链接聚合、有界日期和聚合 CSV、全站仪表盘、匿名访问明细与事务审计已合并；v0.24.0 单链匿名记录 CSV、v0.25.0 审计 CSV 已合并。 | 尚未正式发布，v0.25.0 合并后 CI 修复见验收；超出 90 天或任意时区分析、全站访问合并导出、访问事件归档、独立安全事件中心未实现。 | [统计与事件](../specs/statistics-and-events.md)、[v0.24.0 范围](scope-v0.24.0.md)、[v0.25.0 范围](scope-v0.25.0.md)、[管理后台](../specs/admin.md) |
| 域名与默认策略 | 管理员域名、组授权及全局默认；v0.26 个人偏好、v0.27 排序、v0.28 用户组默认及 v0.29 每域名默认跳转方式已合并。模式仅用于创建面板有权初选，旧 API 与既有短链不变。 | 尚未正式发布；自助绑定及自动 DNS/TLS 未实现。 | [域名](../specs/domains.md)、[多域名](scope-v0.8.0.md)、[个人默认](scope-v0.26.0.md)、[排序](scope-v0.27.0.md)、[组默认](scope-v0.28.0.md)、[默认模式](scope-v0.29.0.md) |
| 品牌与模板 | 站点名称、默认语言／主题、纯文本页脚及固定署名；首页文案、三个固定强调色和最多五项有序页脚链接已交付。 | Logo／Favicon 上传、任意主题色、自定义 Open Graph、更多跳转页模板、高级编辑和自定义 CSS；尚未正式发布。 | [主题](../specs/themes-and-i18n.md)、[首页文案](scope-v0.33.0.md)、[强调色](scope-v0.34.0.md)、[页脚链接](scope-v0.35.0.md) |
| 集成与权限扩展 | Cookie Session API 和按能力校验权限。 | 程序化接口鉴权、Webhook、与新增能力对应的更细粒度权限。 | [管理后台](../specs/admin.md)、[权限](../specs/permissions.md) |
| 风控与滥用治理 | 认证及访问密码安全、访问条件检查。 | 目标域名黑白名单、自动审核、外部安全数据源、管理员复审、举报及创建配额。 | [统计与事件](../specs/statistics-and-events.md) |

## 非目标

以下是 v0.0.1 的历史非目标，不是已经排期的后续交付承诺：

- 公开 SaaS 多租户计费。
- 团队空间或组织空间。
- 用户自定义域名绑定。
- 高级风控审核。
- Webhook。
- 批量导入和批量导出。
- 自定义 CSS。
- 高级模板编辑。
- 完整统计分析平台。

这些能力可以在后续版本中按实际需求单独规划，不应阻塞 v0.0.1 的基础可用闭环。
