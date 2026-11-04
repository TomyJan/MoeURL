# MoeURL 产品总览

## 当前状态（2026-11-04）

v0.48.0 已通过 [PR262](https://github.com/TomyJan/MoeURL/pull/262) 完整交付，master `6aa7c0aa5a805446fae16e7d8453388763081f23`；最新真实审查、候选／master 各九 CI 与完整日志、标准 Task1–3、19 条裁决和可恢复归档均完成。每页 20／50／100，保持权限、私密筛选和全匹配 CSV；未发布部署，见[验收](../implementation/v0.48.0-acceptance.md)。

当前推进[前端 glob 安全维护](../implementation/2026-11-04-frontend-glob-security-plan.md)：修复 minimatch／glob 两项开发依赖公告，保持 0.48.0 行为和版本号；新安装、完整本地门禁和唯一独立终审已完成，本地归档与标准 Task2 已完成，Task3 已启动；PR263 已创建，候选审查已完成一轮并正在处理文档意见，候选 CI 运行中；最终候选覆盖、守卫合并、master CI 和最终归档尚待，见[验收](../implementation/2026-11-04-frontend-glob-security-acceptance.md)。

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

当前 [v0.43.0 短链内部备注](scope-v0.43.0.md)后端、前端、完整 171 项浏览器及精确产品验证通过，16 张原图已逐张检查。唯一独立终审无阻断问题，两项 Minor 延后；远端审查、CI、合并与 master 验证尚待；旧 metadata／公开访问／CSV 不增加备注，阶段见[验收](../implementation/v0.43.0-acceptance.md)。

v0.42.0 已完整交付：[PR253](https://github.com/TomyJan/MoeURL/pull/253)最终候选2eab6cd真实审查和有效意见闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41528785613)与合并master a680b224的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41533004155)均成功，完整原日志分别核至 EOF。标准 Task1–4、25条完整裁决报告、新 whole-owned ZIP／解压全集核与准确leaf可恢复迁出完成，无延期Minor。未发布部署，见[验收](../implementation/v0.42.0-acceptance.md)。下方旧阶段叙述保持历史归属。

v0.41.0／[PR249](https://github.com/TomyJan/MoeURL/pull/249)已完整交付：最终候选6829ba3真实审查和有效意见闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41496993103)与合并master9a71bea的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41505792542)均成功，完整日志分别核至 EOF；标准 Task1–4、32 条完整裁决、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出完成，无延期 Minor。未发布部署；见[验收](../implementation/v0.41.0-acceptance.md)。下方旧阶段文字保留历史归属，不代表当前仍待交付。

v0.40.1／[PR248](https://github.com/TomyJan/MoeURL/pull/248)已完整交付：最终候选 c43e600 的真实审查／有效问题闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41423729705)与合并 master 00c893ff 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41430855520)均成功，完整日志核至 EOF。标准 Task1–4、全部 20 条裁决、whole-owned ZIP／解压全集核和准确 leaf 可恢复迁出完成，无延期 Minor；未发布部署。详见[验收](../implementation/v0.40.1-acceptance.md)。下方旧开发阶段叙述保留历史归属。

当前 [v0.40.1 CSV 格式帮助与模板](scope-v0.40.1.md)已实现可折叠中英示例和固定公开模板下载。真实页面行为 RED→GREEN，78 项边界补验、完整 2690 项前端测试／四项 100%、types／lint／隔离 build 通过；下载不改草稿或文件读取，不改解析器、API、数据库、权限或依赖。clean9b14027的完整159项浏览器、精确产品及正常数据库更新的所选HIGH／CRITICAL扫描通过，原图已逐张阅读；唯一终审bc53c75无代码阻断，Task3文档与归档收尾后进入远端交付。候选自身审查／九CI、master及最终归档仍待，见[验收](../implementation/v0.40.1-acceptance.md)。

v0.40.0 已完整交付：[PR247](https://github.com/TomyJan/MoeURL/pull/247) 最新候选 `e2fee88036ab9637c455bbdccc56d1d3c00bfee5` 的真实审查与全部有效意见闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41401442214) 和合并 master `b4879c0ffd1e7a2048a68479d3fd487227f0926d` 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41408228013) 均成功，完整日志分别核至 EOF。标准 Task1–4、全部 26 条裁决报告、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出完成，格式示例 M1 当时延期；未发布部署。见[验收](../implementation/v0.40.0-acceptance.md)，下方旧阶段文字保留历史归属。

v0.39.0 已完整交付：[PR246](https://github.com/TomyJan/MoeURL/pull/246) 最终候选 `647b013fa1b04f4eb874ceb32d8df97f375c072e` 的真实审查与全部有效意见闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41367196539) 和合并 master `7bf680b3a487e2ad364589b79d325de15cb9e1bd` 的[九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41371662994) 均成功。master 原 8 项成功，运行器失联的 E2E 单独恢复后 149 项通过；完整成功日志为保留原件的可重建组合，内容核验至 EOF，未冒九项重跑。标准 Task1–4、30 条完整裁决报告、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出均完成，未发布或部署。下方旧阶段保留历史归属。

v0.38.0 已完成交付：[PR245](https://github.com/TomyJan/MoeURL/pull/245) 最终候选 b2d19823c70a59d479bbc8d452f97c174c32bb1d 的真实审查／有效意见已闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41340395109) 与合并 master07d4f6c3af23c4f50cd94021d2af13fe0a889c87 的[九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41344911045) 均成功，完整日志分别核读至 EOF。标准 Task1–4、完整 41 条裁决报告与 whole-owned ZIP／解压全集核、准确 leaf 可恢复迁出完成；未发布或部署。下方旧阶段保留历史归属。

2026-11-01 最新交付为 v0.37.0／PR244，master617c12cc8cb07c2ea3173b8d0cc65239aec4f49c，自身九 CI、真实审查、标准任务和可恢复归档已完成，未发布部署。当前 [v0.38.0](scope-v0.38.0.md)实现最多 20 条网址的本人原子批量创建，不等同 CSV 恢复或替代单条高级创建；Task1 已标准完成，前端完整 2534 测试、四项 100%、types／lint／隔离 build 通过。Task2 已在 2b2ee2a 标准完成，Task3 已标准启动；手机提示已真实 RED→GREEN，clean bfb9828 的完整 144 项浏览器、八张原图实读和标准产品／精确镜像扫描通过，唯一终审、本地归档与远端交付仍待。下方旧摘要为历史。

2026-11-01 当前交付：[v0.36.0 账号时区](scope-v0.36.0.md)已通过 PR243 合并及自身 master 九 CI、真实审查、标准任务和完整可恢复归档，未正式发布。下一步 [v0.37.0](scope-v0.37.0.md)仅补精确记录时间的可访问展开与手机提示留白，不新增后台、数据库或权限；已完成两表详情和手机提示的本地实现及定向验证，整版交付仍待，实际门禁见[本版验收](../implementation/v0.37.0-acceptance.md)。旧执行与失败保持各自原归属。

2026-11-01 当前摘要：[v0.36.0 账号时区显示预设](scope-v0.36.0.md)按正式[实施计划](../implementation/v0.36.0-plan.md)实施：Task1–2 已分别标准完成（90674e6／070627a），完整前端 2443 测试及四项 100%、后端业务 100% 已通过。Task3 在 clean 544a0706 上完整 128 项浏览器通过，5 张原图已实读；标准产品 smoke 与同一精确镜像的正常漏洞库更新扫描通过，两次下载失败与官方镜像恢复分别保留。唯一终审已完成（Critical 0／Important 1／Minor 1），认证暂时失败后时区编辑器无法恢复的问题已真实 RED→GREEN；修复后完整 2449 项前端测试、四项 100%、types／lint／build 已通过。修复候选 b5a3dcea 的新完整 128 项浏览器（10.8 分钟）、5 张原图实读及标准产品／精确镜像扫描已通过；原重连超时失败及不变输入诊断分别留证，不称已证明其根因。本地归档／标准收尾与远端交付仍待；独立本人偏好／CAS、九固定 IANA 与身份轮次隔离，只改显示，不改 UTC 统计、CSV、到期输入或公开访问，无新依赖或权限。v0.35.0／PR239 已完成交付；其后 PR242 有界测试回滚维护已合并为 08b990d70bf30dbe54f885d0b7a3bc9490eacb89，真实审查、候选及 master 各九 CI、标准任务与可恢复归档均完成，未正式发布。下方带时间的旧待做叙述均保留其历史归属，不表示当前仍未交付，也不借旧证据给本版。

2026-10-30 19:06 UTC 文档状态同步（远端状态只据 2026-10-30 18:13:09 UTC 只读快照，非本次实时查询）：Task1–3 已标准完成，Task4 进行中且仅步骤 1 已完成。既有 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 已推送候选 `c44d23c0c7fe9ff41c52c19bd92dbe3c45636b08`；其自身 [CI run41097109781](https://github.com/TomyJan/MoeURL/actions/runs/41097109781) 九项 SUCCESS，完整 7331 行原始日志现已 ROOT 连续读至 EOF。真实 CodeRabbit review5716229915 的 kind=reviewed、sourceCommitId=coveredCommitId=该候选完整 SHA，review 与 overview 已全文读回；快照 effective open 为 0，但两条新增 outside 文档 Minor 仍须本次字段／状态同步及一次公开处置闭环，不与原五类延期 Minor 混合。本次文档后继的自身 CI、完整原始日志与真实 exact-head 审查仍待，不借 c44 证据；尚未合并、未完成 master 自身 CI／标准 Task4／最终归档清理，未 tag／release／deploy。以下旧阶段与失败记录均为历史，保留实际提交、输入、运行时和证据归属。

历史记录（原文保留）：2026-10-30 12:07 UTC 标准状态：Task1–3 均已实际标准完成，Task3 范围 d7e071f..1e177c5 的 evidence-only gate actual 0；完整 owned 15 文件／933437 bytes 已 ZIP／extract 全集合核（ZIP 313107 bytes），原 12 文件／845867 bytes dispatch 与合同、失败原件保持冻结，live leaf 保留。Task4 已从 1e177c5 标准启动，当前仅准备远端交付；尚无 push／PR／候选 CI／远端审查／merge／master CI／最终档案清理／tag／release／deploy。下方 11:50 的浏览器与精确产品成功仍只归 clean 6e3cd9b，不借给后继文档 SHA，不重复成功 suite、生成器、产品或原图。

2026-10-30 11:50 UTC 当前本地结论：clean 6e3cd9ba7c5df30656af864c132d99f0870966af 的完整浏览器 actual 0／125 passed（12.0m），标准 18178 smoke、精确 image binary／static V0.35.0-6e3cd9b 与完整 sourceURL、同 image Trivy 0.74 正常 DB 下载及 HIGH／CRITICAL（ignore-unfixed=false）三目标均实际通过。完整 777 非 Markdown／769 runtime 路径与 hash／bytes 稳定，准确 owned 资源已收尾；唯一终审 Important 已真实修复并完成受影响门禁，五类旧 Minor 继续延期。Task1–2 标准完成，Task3 仅余本地档案和标准完成，Task4 全部远端待做，无 push／PR／merge／tag／release／deploy。下文带时间的旧 pending／失败为原执行历史，不代当前结论，也不把本地门禁冒候选或 master CI。

2026-10-30 11:11 UTC 最新：clean bc60c4e 的完整 125 项 actual 1，122 passed／3 failed；三个页脚场景、通知回归及 v0.26 双视口均通过，失败为旧 v0.28 双视口通知按钮 detach 与 v0.29 桌面实际未提交目标域名。真实 trace 已逐项核，不据此认定后端或页脚回归。仅两旧 E2E 复用已验证通知 helper／同步真实 pointer 选择并断言实际值后，初始化及两场景双视口共 5 项 actual 0（2.5m），当前隔离 types／lint actual 0；777／769 完整输入稳定、准确 owned 三空。门禁仍归 bc60c4e 加当时两测试 dirty，产品运行时未变；新 clean 完整门禁及精确产品仍待。Task3 in_progress／Task4 pending，无 push／PR／merge；旧执行保持原归属。

2026-10-30 后继浏览器读回：clean 10e0e7a 的通知集成定向 7 项通过；其唯一完整 125 项 actual 1，124 passed／1 failed，三个新页脚场景及旧 v0.29 双视口均通过。失败是旧 v0.26 手机场景未提交预期系统选择，真实 trace 的 POST 仍为 Personal，服务端正确返回 300104，不据此认定页脚或持久化回归。仅同步旧测试的真实 pointer 选择并加精确冲突 payload 断言后，初始化与双视口共 3 项 actual 0，当前隔离 types／lint actual 0；产品运行时不改。新 clean 完整门禁及精确产品仍待，Task3 in_progress／Task4 pending，无 push／PR／merge。下文旧执行保持原提交与环境归属。

历史候选快照（632c619，原文保留）：当前实施迭代为 [v0.35.0 有界页脚链接](scope-v0.35.0.md)：独立资源最多 5 项，管理员排序／保存，公开安全新窗口导航。Task1–3 已标准完成，后端、前端、完整浏览器和精确产品本地证据分别保留；Task4 的 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 候选 632c619 的目标 CI 三项失败，ACE 校验及旧 E2E 选择同步窄修中，未合并、未发布。旧纯文本页脚、固定 Powered by 与既有偏好不变。详见[规格](../specs/2026-10-30-v0.35.0-footer-links-design.md)与[验收](../implementation/v0.35.0-acceptance.md)，带时间的旧阶段记录不替代修复后的完整门禁、当前候选真实审查及 master 自身 CI。

2026-10-30 09:26 UTC 最新：唯一 fresh 整分支终审已完成（Critical 0／Important 1／新 Minor 0）。ROOT 真实共享语料与已登录 App/session/PG 复现普通 ASCII 双连字符主机前后端分歧；仅 Go 改为逐 ACE 标签 IDNA 校验，92 项同源语料、真实保存和原 API／HTTP 协议已局部 GREEN。原 clean afed568 的 121 项浏览器和精确产品／扫描仍仅属历史，不借给新运行时；当前完整 Go、vet、canonical 业务 100% 与 checker 10 项均 actual 0，隔离 types／lint 已通过；完整 775 非 Markdown 输入逐项稳定，Linux 完整 race／scanner 也已 actual 0；scanner called 0／imported 0／required 3，不冒零公告，新 clean 浏览器及精确产品仍待。Task1–2 标准完成、Task3 in_progress／Task4 pending，原五类 Minor 延期，无 push／PR／merge。

[v0.34.0 站点强调色预设](scope-v0.34.0.md) 已由 [PR #237](https://github.com/TomyJan/MoeURL/pull/237) 于 2026-10-29T21:10:29Z 合并为 fc88c0e8b9192174e62b225fdc3cb0b87a253451。最终候选 99ebef5 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40949991695) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40955501280) 各九项成功，真实审查覆盖最终候选、全部有效意见闭环；标准 Task1–4、完整最终归档与准确 owned leaf 可恢复清理完成，未正式发布。固定 iris／ocean／forest 三预设、独立 CAS 与仅键名审计保持既有主题模式、个人偏好和公开访问；任意颜色编辑仍未开放；本次维护不改依赖、权限或 schema。原失败、逐候选运行时和当时延期三项 Minor 见[验收](../implementation/v0.34.0-acceptance.md)。当前[独立验证与文档维护](../implementation/2026-10-30-site-accent-closeout-plan.md)不新增业务版本；补验 Task1 已标准完成，维护自己的终审及 PR／CI／合并仍待做。

[v0.33.1 首页文案反馈补丁](scope-v0.33.1.md) 已由 [PR #232](https://github.com/TomyJan/MoeURL/pull/232) 合并为 `cf5d5a64`，最终 `91cf9d5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40885738492) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40892523382) 各九成功，真实审查／有效意见闭环、标准 Task1–3 与最终归档清理完成。原本地产品、失败、pointer 覆盖取舍及截图／扫描限制保持[验收](../implementation/v0.33.1-acceptance.md)归属，未正式发布。

[v0.33.0 首页文案](scope-v0.33.0.md) 已由 [PR #231](https://github.com/TomyJan/MoeURL/pull/231) 合并为 `811d6c57`，最终 `34a520b` 的 PR CI40852026042 与合并 master CI40858639758 各九成功，真实审查／有效意见闭环，标准 Task1–4 与完整最终归档、准确 leaf 可恢复清理完成。管理员首屏标题与简介纯文本、逐字段回退、独立版本和身份隔离；三个 Minor 在该版延期，原证据见[验收](../implementation/v0.33.0-acceptance.md)，未正式发布。

[v0.32.0 二维码外观预设](scope-v0.32.0.md) 已由 [PR #230](https://github.com/TomyJan/MoeURL/pull/230) 合并为 `99f87709`。最终 `28214ef` 的 PR CI40816638924 与合并 master CI40821882951 各九成功，真实最新审查／有效意见闭环，标准 Task1–4 及最终完整归档均完成；未正式发布。原候选和执行环境见[验收](../implementation/v0.32.0-acceptance.md)。

[v0.31.0 OIDC 创建模板](scope-v0.31.0.md) 已通过 [PR #229](https://github.com/TomyJan/MoeURL/pull/229) 于 2026-10-28T18:44:58Z 合并为 `c671205182f92d7a5396ebf4e3589d85d155dd2b`。最终候选 `e9c3025` 的 PR CI40741884841 与合并 master CI40748005532 各九成功，真实最终审查、全部有效意见闭环，标准 Task1–4 和最终完整 SDD 归档完成。仅 Google／手动创建草稿，未正式发布或验收真实 Google 外部互通；原单元及各候选制品见[验收](../implementation/v0.31.0-acceptance.md)。

v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](../implementation/v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

## 产品定位

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

产品标语建议为：

> MoeURL：现代、轻量、可控的自托管短链系统。

系统优先面向自托管和私有化部署场景，强调部署者自有域名、数据控制、权限可控和轻量维护。后续如需扩展公开 SaaS 或商业化能力，应在现有权限、鉴权、审计和风控扩展点之上继续演进。

## 长期核心目标

[v0.29.0 每域名默认跳转方式](scope-v0.29.0.md) 已通过 [PR #227](https://github.com/TomyJan/MoeURL/pull/227) 合并为 `8af05d60fb89769f7aaabf4da4906ed411fdad48`；最终 `4dfa4d43` 的 PR CI #40629796924 与合并 master CI #40631422772 各九成功，实际 CodeRabbit 覆盖最终且有效 open0。只影响有权创建者的新面板初选，不改旧省略 API 或已有短链。尚未正式发布，唯一终审、root 修复及各候选制品见[验收](../implementation/v0.29.0-acceptance.md)。

本节描述 MoeURL 的完整目标形态。v0.26 个人默认、v0.27 域名排序和 [v0.28 用户组默认](scope-v0.28.0.md) 均已合并。v0.28 的 PR #226 合并为 `b1b1e4112ba92708becf59c875cff8bff109c3ec`，最终 `0280081` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40575287235) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40586040807) 各九成功，真实 CodeRabbit 覆盖最终且全部有效意见闭环；逐候选、原失败与制品见[验收](../implementation/v0.28.0-acceptance.md)。具体能力见[开发进度](development-status.md)，正式发布与生产验收仍未执行，生产化边界继续见 [v0.6.0 范围](scope-v0.6.0.md)。

[v0.17.0 短链批量管理](scope-v0.17.0.md) 已合并当前列表多选、原子启停与软删除。包含后续依赖及 Go 安全修复的历史主分支候选 `c4928a85` 完整目标 CI 已通过；该结果属于历史记录，不代表当前主分支基线或当前 CI 结果，生产演练与正式发布仍待完成。不包含跨页全选、导入或归属转移。原分支与历史主分支候选的证据分开保留，见 [本版计划](../implementation/v0.17.0-plan.md) 和 [验收记录](../implementation/v0.17.0-acceptance.md)。

MoeURL 的长期核心目标包括：

- 让用户可以创建、管理和统计短链。
- 让管理员可以统一控制用户、用户组、权限、域名、主题和系统行为。
- 让短链访问支持直接跳转、中间页跳转、确认页跳转、访问密码等多种模式。
- 采用 `https://xxx.com/abcd` 这类简洁短链访问形式。
- 让所有可开放能力都通过权限系统控制，而不是散落在各个独立开关中。
- 让系统具备现代化体验，包括多语言、自动深色模式、响应式布局、前端样式主题化和基础品牌自定义。

## 核心设计原则

### 权限优先

MoeURL 的核心控制逻辑是权限系统。

凡是涉及「能不能使用某个功能」「能不能使用某个域名」「能不能使用某种跳转方式」「能不能配置某类跳转页」的问题，都应优先通过权限系统表达。

系统不单独设计「是否允许游客创建短链」这类割裂配置。游客能力由内置的 `guest` 用户组和 `guest` 用户决定。

### 能力即权限

系统中所有重要功能都应抽象为能力，再由用户组权限开放。

例如：

- 创建短链是一种权限。
- 使用某个域名是一种权限。
- 创建直接跳转短链是一种权限。
- 创建中间页短链是一种权限。
- 创建确认页短链是一种权限。
- 使用访问密码是一种权限。
- 使用某个跳转页模板是一种权限。
- 使用某个模板的可编辑元数据是一种权限。
- 查看详细统计是一种权限。
- 创建长期有效短链是一种权限。

为了降低配置复杂度，管理界面可以在细粒度权限之上提供权限包或权限预设。权限包用于降低管理员配置成本，不替代底层权限模型。

### 默认简单，高级折叠

普通用户的主流程应尽可能简单：

```text
粘贴链接 → 生成短链 → 复制使用
```

高级功能放在折叠区域或高级设置中，只在用户有对应权限时可用。

对于短链创建这类常见、普适的核心组件，无权限时不应直接隐藏，而应置灰并给出友好提示，以保持体验一致。

### 现代化体验

默认目标形态具备：

- 多语言。
- 自动深色模式。
- 响应式布局。
- 清晰的空状态、错误状态和加载状态。
- 移动端友好的短链访问页。
- 可配置的页脚、站点名称、Logo 和主题。

其中，中英双语和自动深色模式已经实现；v0.9.0 已交付站点名称、默认语言／主题与纯文本页脚配置。Logo、Favicon 上传和主题编辑器仍未实现。当前 Powered by 版本署名固定展示，不能关闭。

## 当前维护入口

当前以顶部和[能力清单](development-status.md)为准。下面两段日期更新保留当时归属，随后为当前能力概览。

2026-10-28 更新：[v0.27 验收](../implementation/v0.27.0-acceptance.md)已记录最终 `64751e5` 与合并 `8c024b5` 各九项 CI 成功及真实审查闭环。[v0.28 用户组默认](scope-v0.28.0.md)已通过 [PR #226](https://github.com/TomyJan/MoeURL/pull/226) 于 2026-10-27T21:21:01Z 合并为 `b1b1e4112ba92708becf59c875cff8bff109c3ec`；最终 `028008114edda315cfaef0f2effbc0c6c127ae7c` 的 PR CI #40575287235 与该合并的 master CI #40586040807 各九成功，真实 CodeRabbit 覆盖最终且有效意见闭环。首候选 `7c84ba5`、独立终审与集中修复的各阶段证据保留在[v0.28 验收](../implementation/v0.28.0-acceptance.md)，不替代最终候选／合并结果。v0.25 的历史失败及后继维护、v0.24／v0.26 的 PR／合并 CI 保持独立归属；以上均未正式发布。

2026-10-26 更新：[v0.19.0 用户组成员迁移](scope-v0.19.0.md) 已通过 PR #211 合并为 `c08b67b2`；[v0.20.0 单条归属转移](scope-v0.20.0.md) 已通过 PR #214 合并为 `2d23dcfd`；[v0.21.0 清单 CSV](scope-v0.21.0.md) 已通过 PR #216 合并为 `dfc9a5a1`。v0.22.0 批量归属转移已通过 PR #217 合并为 `ba2073cf`，最终修复候选 `7e41d438` 和实际合并提交 CI 各 9 项成功，尚未正式发布，具体提交及证据见[本版验收](../implementation/v0.22.0-acceptance.md)。本页旧版本状态与分支验证保留历史归属，合并不替代正式发布。

当前能力按模块集中维护在 [开发进度与能力清单](development-status.md)，待开发方向见 [路线图](roadmap.md)。总览保留产品原则，不重复维护每个历史版本的详细任务和验证结果。

主分支已经实现的主要闭环包括：

- 短链创建、个人与全站管理、三种跳转模式、过期时间、访问密码、二维码、最大访问次数、标题和标签。
- 个人概览、最近短链、最长 90 天 UTC 区间的单链匿名分析与聚合／匿名记录 CSV、管理员全站仪表盘及单链访问明细；单链分析从对应短链进入。
- 本人／全站每页 20／50／100 条（默认 20）、前后翻页和单页选择；最多 100 条原子批量启停／软删除、转移和标签整理，最多 20 条原子创建及单列 CSV 录入；只读标签查找、内部纯文本备注、有无备注及最多 100 码点私密备注关键词交集筛选和事务审计。CSV 导出全部匹配元数据，不含备注正文。
- 本地账号、个人昵称与改密、账号语言／主题和九固定 IANA 时区显示偏好、单账号／有界批量成员迁移、内置组权限、多提供商 OIDC 及多域名授权。
- 站点名称、默认语言／主题、首页标题／简介、三个固定强调色、纯文本页脚、最多五个有序链接和安全的本地登录开关。
- 中英双语、响应式浅深色界面、PWA 基础、统一 Toast 与标准列表，以及固定展示的构建版本署名。

最近已交付 [v0.48.0 每页条数](scope-v0.48.0.md)、[v0.47.0 列表确定顺序](scope-v0.47.0.md)、[v0.46.0 私密备注关键词筛选](scope-v0.46.0.md)、[v0.45.0 固定分页](scope-v0.45.0.md)和 [v0.44.0 备注状态筛选](scope-v0.44.0.md)，此前包括[内部备注](scope-v0.43.0.md)、[版本边界补丁](scope-v0.43.1.md)、[本人标签查找](scope-v0.41.0.md)、[全站标签查找](scope-v0.42.0.md)、[批量创建](scope-v0.38.0.md)、[CSV 录入](scope-v0.40.0.md)、[格式帮助](scope-v0.40.1.md)和[个人默认方式](scope-v0.39.0.md)。维护不另算业务版本，合并不视为正式发布。

[v0.12.0 自定义短码](scope-v0.12.0.md) 已通过 PR #185 合并至 `master` 的 `17e1f766`，支持创建时指定地址，不加入改码、释放、复用或批量能力；原分支的本地验证和独立审查见 [验收清单](../implementation/v0.12.0-acceptance.md)，合并不等于正式发布。

[v0.13.0 个人密码修改](scope-v0.13.0.md) 已通过 PR #186 合并为 `a52733cc`；校验当前密码后原子更新并撤销全部旧 Session，要求重新登录。本地验证与待补齐的目标环境证据见 [验收记录](../implementation/v0.13.0-acceptance.md)。

主分支已通过 PR #208 合并 [v0.18.0 全站统计、匿名访问明细与操作审计](scope-v0.18.0.md)：管理员全站快照、已有单链分析页内的匿名记录，以及关键业务写入同事务审计和 180 天在线保留。各阶段证据见 [验收](../implementation/v0.18.0-acceptance.md)；已合并，尚未正式发布，不将主分支历史 CI 当作本版验证。

尚未实现的主要方向包括自定义组、头像、自定义 OIDC 模板和账号绑定、独立标签实体与治理、导出清单恢复、超出 90 天或任意时区分析、全站访问合并导出、品牌上传及模板编辑。固定时区显示、有界 CSV 创建、固定强调色和只读标签查找已经交付，不作为全新功能重复规划；其他方向仍须独立收敛范围。

## 验证与发布边界

功能实现、主分支合并和正式发布是不同状态。当前各版本的门禁证据保留在对应 acceptance；最新已交付版本的本地前端、浏览器、候选及 master 门禁见 [v0.48.0 验收](../implementation/v0.48.0-acceptance.md)。[标准列表验收](../implementation/2026-10-15-standard-lists-acceptance.md) 和 [配色验收](../implementation/2026-10-15-color-refresh-acceptance.md) 是 2026-10-15 的历史基线，各自执行归属不变。

单机 Compose 与外部 TLS 代理仍是支持的生产部署方向。候选提交的目标 CI、Linux race、安全扫描、完整容器流程、真实 DNS/TLS、外部 OIDC、隔离恢复和生产发布验收须按各自环境补齐；历史提交的 CI 或本地回退结果不能替代这些证据。缺口与证据索引统一见 [开发进度与能力清单](development-status.md)。
