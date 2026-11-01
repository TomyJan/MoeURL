# MoeURL 文档中心

2026-11-01 当前摘要：[v0.36.0 账号时区显示预设](product/scope-v0.36.0.md)按正式[实施计划](implementation/v0.36.0-plan.md)实施：Task1–2 已分别标准完成（90674e6／070627a），完整前端 2443 测试及四项 100%、后端业务 100% 已通过。Task3 双视口定向浏览器已通过，完整浏览器、精确产品、独立终审与远端交付仍待；独立本人偏好／CAS、九固定 IANA 与身份轮次隔离，只改显示，不改 UTC 统计、CSV、到期输入或公开访问，无新依赖或权限。v0.35.0／PR239 已完成交付；其后 PR242 有界测试回滚维护已合并为 08b990d70bf30dbe54f885d0b7a3bc9490eacb89，真实审查、候选及 master 各九 CI、标准任务与可恢复归档均完成，未正式发布。下方带时间的旧待做叙述均保留其历史归属，不表示当前仍未交付，也不借旧证据给本版。

2026-10-30 19:06 UTC 文档状态同步（远端状态只据 2026-10-30 18:13:09 UTC 只读快照，非本次实时查询）：Task1–3 已标准完成，Task4 进行中且仅步骤 1 已完成。既有 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 已推送候选 `c44d23c0c7fe9ff41c52c19bd92dbe3c45636b08`；其自身 [CI run41097109781](https://github.com/TomyJan/MoeURL/actions/runs/41097109781) 九项 SUCCESS，完整 7331 行原始日志现已 ROOT 连续读至 EOF。真实 CodeRabbit review5716229915 的 kind=reviewed、sourceCommitId=coveredCommitId=该候选完整 SHA，review 与 overview 已全文读回；快照 effective open 为 0，但两条新增 outside 文档 Minor 仍须本次字段／状态同步及一次公开处置闭环，不与原五类延期 Minor 混合。本次文档后继的自身 CI、完整原始日志与真实 exact-head 审查仍待，不借 c44 证据；尚未合并、未完成 master 自身 CI／标准 Task4／最终归档清理，未 tag／release／deploy。以下旧阶段与失败记录均为历史，保留实际提交、输入、运行时和证据归属。

历史记录（原文保留）：2026-10-30 12:07 UTC 标准状态：Task1–3 均已实际标准完成，Task3 范围 d7e071f..1e177c5 的 evidence-only gate actual 0；完整 owned 15 文件／933437 bytes 已 ZIP／extract 全集合核（ZIP 313107 bytes），原 12 文件／845867 bytes dispatch 与合同、失败原件保持冻结，live leaf 保留。Task4 已从 1e177c5 标准启动，当前仅准备远端交付；尚无 push／PR／候选 CI／远端审查／merge／master CI／最终档案清理／tag／release／deploy。下方 11:50 的浏览器与精确产品成功仍只归 clean 6e3cd9b，不借给后继文档 SHA，不重复成功 suite、生成器、产品或原图。

2026-10-30 11:50 UTC 当前本地结论：clean 6e3cd9ba7c5df30656af864c132d99f0870966af 的完整浏览器 actual 0／125 passed（12.0m），标准 18178 smoke、精确 image binary／static V0.35.0-6e3cd9b 与完整 sourceURL、同 image Trivy 0.74 正常 DB 下载及 HIGH／CRITICAL（ignore-unfixed=false）三目标均实际通过。完整 777 非 Markdown／769 runtime 路径与 hash／bytes 稳定，准确 owned 资源已收尾；唯一终审 Important 已真实修复并完成受影响门禁，五类旧 Minor 继续延期。Task1–2 标准完成，Task3 仅余本地档案和标准完成，Task4 全部远端待做，无 push／PR／merge／tag／release／deploy。下文带时间的旧 pending／失败为原执行历史，不代当前结论，也不把本地门禁冒候选或 master CI。

2026-10-30 11:11 UTC 最新：clean bc60c4e 的完整 125 项 actual 1，122 passed／3 failed；三个页脚场景、通知回归及 v0.26 双视口均通过，失败为旧 v0.28 双视口通知按钮 detach 与 v0.29 桌面实际未提交目标域名。真实 trace 已逐项核，不据此认定后端或页脚回归。仅两旧 E2E 复用已验证通知 helper／同步真实 pointer 选择并断言实际值后，初始化及两场景双视口共 5 项 actual 0（2.5m），当前隔离 types／lint actual 0；777／769 完整输入稳定、准确 owned 三空。门禁仍归 bc60c4e 加当时两测试 dirty，产品运行时未变；新 clean 完整门禁及精确产品仍待。Task3 in_progress／Task4 pending，无 push／PR／merge；旧执行保持原归属。

2026-10-30 后继浏览器读回：clean 10e0e7a 的通知集成定向 7 项通过；其唯一完整 125 项 actual 1，124 passed／1 failed，三个新页脚场景及旧 v0.29 双视口均通过。失败是旧 v0.26 手机场景未提交预期系统选择，真实 trace 的 POST 仍为 Personal，服务端正确返回 300104，不据此认定页脚或持久化回归。仅同步旧测试的真实 pointer 选择并加精确冲突 payload 断言后，初始化与双视口共 3 项 actual 0，当前隔离 types／lint actual 0；产品运行时不改。新 clean 完整门禁及精确产品仍待，Task3 in_progress／Task4 pending，无 push／PR／merge。下文旧执行保持原提交与环境归属。

历史候选快照（632c619，原文保留）：[v0.35.0 有界页脚链接](product/scope-v0.35.0.md) 已实现最多 5 项有序导航、独立当前权限／完整 CAS／仅键名审计，保留旧纯文本与固定署名。Task1–3 标准完成，后端、前端、完整浏览器和精确产品本地证据保持各自输入归属；Task4 的 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 候选 632c619 的 [CI](https://github.com/TomyJan/MoeURL/actions/runs/41054453846) 有三项失败，ACE 校验及旧 E2E 选择同步窄修中，当前不可合并、未发布。[规格](specs/2026-10-30-v0.35.0-footer-links-design.md)、[计划](implementation/v0.35.0-plan.md)、[矩阵](implementation/v0.35.0-test-matrix.md)、[任务](implementation/v0.35.0-tasks.md)和[验收](implementation/v0.35.0-acceptance.md)为当前入口；带时间的旧阶段记录不代新候选及 master 门禁。

2026-10-30 09:26 UTC 最新：唯一 fresh 整分支终审已完成（Critical 0／Important 1／新 Minor 0）。ROOT 真实共享语料与已登录 App/session/PG 复现普通 ASCII 双连字符主机前后端分歧；仅 Go 改为逐 ACE 标签 IDNA 校验，92 项同源语料、真实保存和原 API／HTTP 协议已局部 GREEN。原 clean afed568 的 121 项浏览器和精确产品／扫描仍仅属历史，不借给新运行时；当前完整 Go、vet、canonical 业务 100% 与 checker 10 项均 actual 0，隔离 types／lint 已通过；完整 775 非 Markdown 输入逐项稳定，Linux 完整 race／scanner 也已 actual 0；scanner called 0／imported 0／required 3，不冒零公告，新 clean 浏览器及精确产品仍待。Task1–2 标准完成、Task3 in_progress／Task4 pending，原五类 Minor 延期，无 push／PR／merge。

[v0.34.0 站点强调色预设](product/scope-v0.34.0.md) 已由 [PR #237](https://github.com/TomyJan/MoeURL/pull/237) 于 2026-10-29T21:10:29Z 合并为 fc88c0e8b9192174e62b225fdc3cb0b87a253451。最终候选 99ebef5 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40949991695) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40955501280) 各九项成功，真实审查覆盖最终候选、全部有效意见闭环；标准 Task1–4、完整最终归档与准确 owned leaf 可恢复清理完成，未正式发布。固定 iris／ocean／forest 三预设、独立 CAS 与仅键名审计保持既有主题模式、个人偏好和公开访问；任意颜色编辑仍未开放；本次维护不改依赖、权限或 schema。原失败、逐候选运行时和当时延期三项 Minor 见[验收](implementation/v0.34.0-acceptance.md)。当前[独立验证与文档维护](implementation/2026-10-30-site-accent-closeout-plan.md)不新增业务版本；补验 Task1 已标准完成，维护自己的终审及 PR／CI／合并仍待做。

[v0.33.1 首页文案反馈补丁](product/scope-v0.33.1.md) 已由 [PR #232](https://github.com/TomyJan/MoeURL/pull/232) 合并为 `cf5d5a64`。最终候选 `91cf9d5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40885738492) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40892523382) 各九成功，真实最新 CodeRabbit 覆盖最终候选、有效意见闭环；标准 Task1–3、完整最终归档及准确 leaf 可恢复清理完成。原本地执行 SHA、失败、42 项裁决和限制保持[验收](implementation/v0.33.1-acceptance.md)归属；未正式发布。当前文档同步属于独立[维护轮](implementation/2026-10-29-delivery-status-plan.md)，不将上述 CI 归属本轮文档提交。

[v0.33.0 首页文案](product/scope-v0.33.0.md) 已通过 [PR #231](https://github.com/TomyJan/MoeURL/pull/231) 合并为 `811d6c57`。最终 `34a520b` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40852026042) 与合并 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40858639758) 各九成功，真实最新审查／全部有效意见闭环，标准 Task1–4、完整最终归档与准确 owned leaf 可恢复清理完成。三个 Minor 在该版延期，原候选／运行时及失败保持[验收](implementation/v0.33.0-acceptance.md)归属，未正式发布。

[v0.32.0 二维码外观预设](product/scope-v0.32.0.md) 已由 [PR #230](https://github.com/TomyJan/MoeURL/pull/230) 合并为 `99f87709`。最终候选 `28214ef` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40816638924) 与合并 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40821882951) 各九成功，真实最新审查／有效意见闭环；标准 Task1–4 与最终完整归档均完成。原单元、各候选浏览器／七图与精确产品仍按[验收](implementation/v0.32.0-acceptance.md)归属，未正式发布。

v0.31.0 已通过 [PR #229](https://github.com/TomyJan/MoeURL/pull/229) 于 2026-10-28T18:44:58Z 合并为 `c671205182f92d7a5396ebf4e3589d85d155dd2b`。最终候选 `e9c3025` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40741884841) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40748005532) 各九项成功，真实 CodeRabbit 覆盖最终候选，全部有效意见闭环；标准 Task1–4 和完整最终 SDD 归档核验已完成。仅 Google／手动创建草稿，无正式发布或外部 Google 互通验收。逐候选及原失败见[验收](implementation/v0.31.0-acceptance.md)。

v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](implementation/v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

[v0.29.0 每域名默认跳转方式](product/scope-v0.29.0.md) 已通过 [PR #227](https://github.com/TomyJan/MoeURL/pull/227) 于 2026-10-28T04:16:45Z 合并为 `8af05d60fb89769f7aaabf4da4906ed411fdad48`。最终 `4dfa4d43` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40629796924) 与合并 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40631422772) 各九成功，实际 CodeRabbit 覆盖最终且有效意见全部闭环。旧 API 省略 redirectMode 仍 direct，默认只用于新面板初选，不改已有短链；唯一独立终审、root 修复、原失败及逐候选制品见[任务](implementation/v0.29.0-tasks.md)和[验收](implementation/v0.29.0-acceptance.md)。尚未正式发布。

此前功能 [v0.25.0 操作审计 CSV](product/scope-v0.25.0.md) 已由 PR #222 合并，其旧合并 CI 的手机 E2E 失败保持历史归属。后继[维护 PR #223](https://github.com/TomyJan/MoeURL/pull/223) 已合并为 `cafacf15`，精确最终 head 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40415038034) 与新合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40421454231) 各 9 成功，实际 CodeRabbit 已覆盖最终变更，无有效未解决问题。恢复证据见[维护验收](implementation/2026-10-27-frontend-security-dependencies-acceptance.md)；尚未正式发布。

v0.26.0 个人默认已由 PR #224 合并，逐候选证据见[验收](implementation/v0.26.0-acceptance.md)。[v0.27.0 域名排序](product/scope-v0.27.0.md) 已通过 [PR #225](https://github.com/TomyJan/MoeURL/pull/225) 合并为 `8c024b5035226285ea76571c8b6a50ceb2d19440`，最终 `64751e5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40486914108) 与合并 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40493457478) 各 9 成功，真实 CodeRabbit 覆盖最终且有效意见闭环，尚未发布；原始候选／制品和失败仍按[验收](implementation/v0.27.0-acceptance.md)独立归属。

[v0.28.0 用户组默认域名](product/scope-v0.28.0.md) 已通过 [PR #226](https://github.com/TomyJan/MoeURL/pull/226) 于 2026-10-27T21:21:01Z 合并为 `b1b1e4112ba92708becf59c875cff8bff109c3ec`。最终 `028008114edda315cfaef0f2effbc0c6c127ae7c` 的 [PR CI #40575287235](https://github.com/TomyJan/MoeURL/actions/runs/40575287235) 与该合并的 [master CI #40586040807](https://github.com/TomyJan/MoeURL/actions/runs/40586040807) 各九项成功；真实 CodeRabbit 覆盖最终候选，全部有效意见闭环。设计、唯一独立终审、集中修复、原失败和逐候选制品归属见[验收](implementation/v0.28.0-acceptance.md)。尚未正式发布。

[v0.25.0 操作审计 CSV 导出](product/scope-v0.25.0.md) 已合并按 UTC 日期与操作者／资源／动作筛选的完整元数据下载，最多 1000 条／8 MiB，新增受保护管理员权限并保持业务值与秘密隔离。设计与逐候选证据见[规格](specs/2026-10-27-v0.25.0-audit-export-design.md)、[计划](implementation/v0.25.0-plan.md)、[任务](implementation/v0.25.0-tasks.md)及[验收](implementation/v0.25.0-acceptance.md)。当前[开发依赖安全维护](implementation/2026-10-27-frontend-security-dependencies-plan.md) 同时处理 4 条工具链公告及上述 E2E 提示关闭同步，不新增产品版本；进度见[维护验收](implementation/2026-10-27-frontend-security-dependencies-acceptance.md)。

v0.24.0 整分支终审已完成，统一修复候选 `7cd277b2` 补齐真实父页授权恢复、服务端日期权威及固定 E2E 分类／已加载页面撤权回归；新门禁、工作树生成物隔离偏差及已通过的独立定向复审结论见本版验收。

主分支已合并 [全站统计、匿名访问明细与操作审计](product/scope-v0.18.0.md)。管理页为 `/admin/dashboard`、`/admin/audit`，访问明细保留在单短链分析页中；权限、隐私、事务与保留边界见 [设计](specs/2026-10-22-v0.18.0-analytics-audit-design.md)。分阶段本地门禁、候选树及剩余远端／发布验证分别记录在 [验收](implementation/v0.18.0-acceptance.md)，功能已通过 PR #208 合并为 `0f01a2e5`，尚未正式发布。

整分支终审的统一修复已通过定向复审，范围往返、卸载重建、跨 UTC 午夜与父聚合身份隔离均有回归。原完整门禁候选 `721206c` 的前端、68 项 E2E、production smoke、精确镜像扫描及证据 ZIP 另行保留；原分支最后实现候选 `e476f87d` 包含权限集合审计修复，已重跑后端门禁，尚未重跑前端、完整浏览器及镜像门禁，详见 v0.18.0 验收。

MoeURL 文档按实施导向组织，目标是让产品规划、功能规格、技术基线和实施计划各自边界清晰，便于后续按阶段开发。

## 阅读顺序

先阅读 [开发进度与能力清单](product/development-status.md)：按模块查看已实现、部分实现、待开发和待验证事项；再阅读 [产品总览](product/overview.md) 与 [路线图](product/roadmap.md)。进度清单集中维护当前状态，scope 定义版本边界，acceptance 保留指定提交和环境的证据。

此前 [v0.11.0 短链标题与标签](product/scope-v0.11.0.md) 的设计见 [元数据规格](specs/2026-10-13-v0.11.0-link-metadata-design.md)，执行与证据见 [实施计划](implementation/v0.11.0-plan.md)、[任务清单](implementation/v0.11.0-tasks.md) 和 [验收清单](implementation/v0.11.0-acceptance.md)。[v0.10.0 最大访问次数](product/scope-v0.10.0.md) 已实现，其 [验证记录](implementation/v0.10.0-acceptance.md) 与其他版本保持独立。

[v0.12.0 自定义短码](product/scope-v0.12.0.md) 已通过 PR #185 合并为 `17e1f766`。只允许创建时指定短码，不修改已发布地址；规则见 [设计](specs/2026-10-15-v0.12.0-custom-slugs-design.md)，原分支本地门禁与独立审查见 [验收清单](implementation/v0.12.0-acceptance.md)，不据此声称正式发布。

[v0.13.0 个人密码修改](product/scope-v0.13.0.md) 已通过 PR #186 合并为 `a52733cc`；校验当前密码后原子更新并撤销旧会话。见 [设计](specs/2026-10-15-v0.13.0-password-change-design.md)、[实施计划](implementation/v0.13.0-plan.md)、[任务清单](implementation/v0.13.0-tasks.md) 和 [验收记录](implementation/v0.13.0-acceptance.md)。合并不替代目标 CI 或生产验收证据。

[v0.14.0 统计日期范围](product/scope-v0.14.0.md) 已通过 PR #187 合并为 `c864ce3a`，支持近 7／30／90 天和有界自定义 UTC 区间；见 [设计](specs/2026-10-15-v0.14.0-analytics-date-range-design.md)、[实施计划](implementation/v0.14.0-plan.md)、[任务清单](implementation/v0.14.0-tasks.md) 与 [原分支验收记录](implementation/v0.14.0-acceptance.md)。

[v0.15.0 账号语言与主题偏好](product/scope-v0.15.0.md) 已通过 PR #190 合并为 `2ec7eaa4`；显式账号保存、登录加载和浏览器偏好隔离的原分支证据见 [验收记录](implementation/v0.15.0-acceptance.md)，不替代合并提交或发布验证。

[v0.16.0 聚合统计 CSV 导出](product/scope-v0.16.0.md) 已通过 PR #191 合并为 `bd4c2625`，未正式发布；仅导出单短链已应用 UTC 区间的匿名聚合。见 [设计](specs/2026-10-16-v0.16.0-analytics-export-design.md)、[实施计划](implementation/v0.16.0-plan.md)、[任务清单](implementation/v0.16.0-tasks.md) 与 [原分支验收记录](implementation/v0.16.0-acceptance.md)。

[v0.17.0 短链批量管理](product/scope-v0.17.0.md) 已通过 PR #198 合并为 `3eda85de`，支持当前列表多选与最多 100 条的原子批量启停／软删除。历史主分支候选 `c4928a85` 包含当时的依赖与 Go 证书安全修复，其完整目标 CI 9 项通过；功能合并和历史 CI 不等于当前候选或正式发布通过。范围与实际证据见 [设计](specs/2026-10-16-v0.17.0-bulk-link-management-design.md)、[计划](implementation/v0.17.0-plan.md)、[任务清单](implementation/v0.17.0-tasks.md) 和 [验收记录](implementation/v0.17.0-acceptance.md)。

2026-10-14 全站前端视觉更新沿用既有业务范围，设计见 [视觉与交互规范](specs/2026-10-14-ui-refresh-design.md)，执行与证据见 [实施计划](implementation/2026-10-14-ui-refresh-plan.md) 和 [本地验收](implementation/2026-10-14-ui-refresh-acceptance.md)。

2026-10-15 配色更新为 [鸢尾蓝与薄荷青](specs/2026-10-15-color-refresh-design.md)，替代前述灰蓝配色，保留标准列表与布局；执行与证据见 [实施计划](implementation/2026-10-15-color-refresh-plan.md) 和 [本地验收](implementation/2026-10-15-color-refresh-acceptance.md)。

需要了解既有模块的设计和实施过程时，继续按以下索引阅读；列表中的早期版本范围不代表当前全部能力：

1. [产品总览](product/overview.md)：了解 MoeURL 的定位、目标和核心原则。
2. [v0.9.0 范围](product/scope-v0.9.0.md)：确认已实现的系统设置、站点品牌和本地登录开关边界，以及仍待补齐的目标环境证据。
   详细技术设计见 [v0.9.0 系统设置与站点品牌基础闭环设计](superpowers/specs/2026-10-09-v0.9.0-system-settings-design.md)。
   工程推进参见 [v0.9.0 实施计划](implementation/v0.9.0-plan.md)、[详细实现计划](implementation/v0.9.0-detailed-plan.md)、[任务清单](implementation/v0.9.0-tasks.md) 与 [验收清单](implementation/v0.9.0-acceptance.md)。
3. [v0.8.0 范围](product/scope-v0.8.0.md)：确认多域名管理范围、升级边界及历史合并提交的 CI 与容器验证记录。
   工程推进参见 [v0.8.0 实施计划](implementation/v0.8.0-plan.md)、[任务清单](implementation/v0.8.0-tasks.md) 与 [验收清单](implementation/v0.8.0-acceptance.md)。
4. [v0.7.0 范围](product/scope-v0.7.0.md)：确认多提供商 OIDC 登录的范围、账号供应规则和非目标。
5. [v0.7.0 OIDC 登录设计](specs/2026-09-11-v0.7.0-oidc-login-design.md)：确认协议、密钥、外部身份、并发和回滚设计。
6. [v0.7.0 详细实现计划](implementation/v0.7.0-detailed-plan.md)：查看 OIDC 的 TDD 切片，并在 [v0.7.0 验收清单](implementation/v0.7.0-acceptance.md) 跟踪真实证据。
7. [v0.6.0 范围](product/scope-v0.6.0.md)：回看生产就绪版本的边界、部署目标和仍待补齐的目标环境证据。
8. [v0.6.0 生产就绪设计](specs/2026-08-29-v0.6.0-production-readiness-design.md)：确认单机 Compose、外部 TLS 反向代理、安全、生命周期和运维设计。
9. [v0.5.0 范围](product/scope-v0.5.0.md)：回看已完成的内置用户组权限管理边界。
10. [v0.5.0 功能设计](specs/2026-08-20-v0.5.0-user-group-permission-management-design.md)：回看权限目录、预设、保护规则、并发和页面状态。
11. [v0.4.0 范围](product/scope-v0.4.0.md)：回看已完成的确认页访问边界。
12. [v0.4.0 功能设计](specs/2026-08-13-v0.4.0-confirmation-page-access-design.md)：回看模式、权限、访问状态机和统计口径。
13. [v0.3.0 范围](product/scope-v0.3.0.md)：回看受保护短链访问的实现边界。
14. [v0.3.0 功能设计](specs/2026-08-04-v0.3.0-protected-link-access-design.md)：回看密码、限流、授权和访问流程设计。
15. [v0.2.0 范围](product/scope-v0.2.0.md)：回看短链访问体验与生命周期的实现边界。
16. [v0.2.0 功能设计](specs/2026-08-02-v0.2.0-link-experience-design.md)：回看中间页、过期时间、二维码和事件设计。
17. [统计与事件](specs/statistics-and-events.md)：确认短链访问事件、基础统计和维度统计口径。
18. [短链](specs/short-links.md)：确认短链访问、状态和事件记录调用点。
19. [跳转模式](specs/redirect-modes.md)：确认直接跳转、中间页和确认页边界。
20. [功能规格](specs/)：按模块查看权限、短链、用户、域名、页面、跳转、统计、主题和后台设计。
21. [技术选型决策](implementation/technical-decision.md)：确认 Go + Vue 技术栈和选型理由。
22. [技术基线](implementation/technical-baseline.md)：确认仓库结构、模块边界、API、数据库、测试和部署约定。
23. [Agent 自主交付规范](implementation/agent-delivery-guidelines.md)：确认新版本、跨模块、review 修复、CI 门禁和生产化任务的统一执行约定。
24. [实施文档](implementation/)：查看工程计划、阶段任务和验收记录。

## 此前合并：v0.19.0

[用户组成员迁移](product/scope-v0.19.0.md) 已通过 PR #211 合并为 `c08b67b2`，尚未正式发布。原候选和后续 CI 修复证据见 [验收](implementation/v0.19.0-acceptance.md)，不替代新合并提交目标 CI。

## 此前合并：v0.18.0

[全站统计、匿名访问明细与操作审计](product/scope-v0.18.0.md) 已通过 PR #208 合并为 `0f01a2e5`，尚未正式发布。原分支统一终审修复与本地验证保持原候选归属。查询权限、隐私和事务原子性见 [设计](specs/2026-10-22-v0.18.0-analytics-audit-design.md)，执行与证据见 [计划](implementation/v0.18.0-plan.md)、[任务](implementation/v0.18.0-tasks.md) 和 [验收](implementation/v0.18.0-acceptance.md)。

## 部署与运维

- [单机 Docker Compose 部署](deployment/single-host-compose.md)：准备秘密、首次启动、Caddy/Nginx TLS 和来源级限流。
- [PostgreSQL 备份与隔离恢复](deployment/backup-and-restore.md)：创建自定义格式备份并在隔离 project 验证恢复。
- [升级、回退与灾难恢复](deployment/upgrade-and-recovery.md)：执行升级前检查、显式 migration、失败回退和主机丢失演练。

## 文档分层

### 产品层

产品层文档位于 [product](product/) 目录，用于描述产品方向、版本边界和路线图。

- [产品总览](product/overview.md)
- [开发进度与能力清单](product/development-status.md)
- [v0.24.0 匿名访问记录导出范围](product/scope-v0.24.0.md)
- [v0.25.0 操作审计导出范围](product/scope-v0.25.0.md)
- [v0.0.1 范围](product/scope-v0.0.1.md)
- [v0.0.2 范围](product/scope-v0.0.2.md)
- [v0.0.3 范围](product/scope-v0.0.3.md)
- [v0.0.4 范围](product/scope-v0.0.4.md)
- [v0.1.0 范围](product/scope-v0.1.0.md)
- [v0.1.1 范围](product/scope-v0.1.1.md)
- [v0.1.2 范围](product/scope-v0.1.2.md)
- [v0.2.0 范围](product/scope-v0.2.0.md)
- [v0.3.0 范围](product/scope-v0.3.0.md)
- [v0.4.0 范围](product/scope-v0.4.0.md)
- [v0.5.0 范围](product/scope-v0.5.0.md)
- [v0.6.0 范围](product/scope-v0.6.0.md)
- [v0.7.0 范围](product/scope-v0.7.0.md)
- [v0.8.0 范围](product/scope-v0.8.0.md)
- [v0.9.0 范围](product/scope-v0.9.0.md)
- [v0.10.0 范围](product/scope-v0.10.0.md)
- [v0.11.0 范围](product/scope-v0.11.0.md)
- [v0.12.0 范围](product/scope-v0.12.0.md)
- [v0.13.0 范围](product/scope-v0.13.0.md)
- [v0.14.0 范围](product/scope-v0.14.0.md)
- [v0.15.0 范围](product/scope-v0.15.0.md)
- [路线图](product/roadmap.md)

### 功能规格层

功能规格层文档位于 [specs](specs/) 目录，用于描述各模块的稳定产品规格。实施计划应引用这些文档，而不是在计划中重复定义产品规则。

- [权限模型](specs/permissions.md)
- [v0.9.0 系统设置与站点品牌基础闭环设计](superpowers/specs/2026-10-09-v0.9.0-system-settings-design.md)
- [v0.7.0 多提供商 OIDC 登录设计](specs/2026-09-11-v0.7.0-oidc-login-design.md)
- [v0.6.0 生产就绪设计](specs/2026-08-29-v0.6.0-production-readiness-design.md)
- [v0.5.0 用户组权限管理设计](specs/2026-08-20-v0.5.0-user-group-permission-management-design.md)
- [v0.4.0 确认页访问设计](specs/2026-08-13-v0.4.0-confirmation-page-access-design.md)
- [v0.3.0 受保护短链访问设计](specs/2026-08-04-v0.3.0-protected-link-access-design.md)
- [用户与认证](specs/users-and-auth.md)
- [个人密码修改设计](specs/2026-10-15-v0.13.0-password-change-design.md)
- [短链](specs/short-links.md)
- [v0.11.0 短链标题与标签设计](specs/2026-10-13-v0.11.0-link-metadata-design.md)
- [v0.12.0 自定义短码设计](specs/2026-10-15-v0.12.0-custom-slugs-design.md)
- [域名](specs/domains.md)
- [跳转模式](specs/redirect-modes.md)
- [统计与事件](specs/statistics-and-events.md)
- [v0.24.0 匿名访问记录导出设计](specs/2026-10-26-v0.24.0-visit-record-export-design.md)
- [v0.25.0 操作审计导出设计](specs/2026-10-27-v0.25.0-audit-export-design.md)
- [v0.14.0 统计日期范围设计](specs/2026-10-15-v0.14.0-analytics-date-range-design.md)
- [v0.15.0 账号语言与主题偏好设计](specs/2026-10-16-v0.15.0-account-preferences-design.md)
- [导航与页面](specs/navigation-and-pages.md)
- [主题与多语言](specs/themes-and-i18n.md)
- [管理后台](specs/admin.md)

### 实施层

实施层文档位于 [implementation](implementation/) 目录，用于承载技术决策、技术基线、工程计划、任务拆分和验收记录。

v0.9.0 系统设置与站点品牌基础闭环的功能实现已经完成；功能提交 `900037d` 的 Go、前端单元覆盖率、静态检查、构建、SQLC 和 Compose 配置门禁已完成复验，该提交的全量 Playwright、目标 Node.js 26、完整 Compose smoke、目标 CI、Linux race、安全扫描、外部真实 OIDC 和生产发布验收仍待补齐。v0.8.0 多域名管理的功能实现已完成；合并提交 `f818a7e8` 对应的 PR 合并验证已通过全量 CI、Linux race、安全扫描、Playwright 与 Compose smoke。真实 DNS/TLS、隔离恢复和生产发布验收仍待目标环境证据，不能视为已发布能力。v0.7.0 多提供商 OIDC 登录的功能实现与本地门禁已完成，外部互操作和发布验收仍待证据；v0.6.0 生产就绪闭环的代码实现已完成、生产验收仍待目标环境证据。涉及认证扩展时先阅读 v0.9.0 与 v0.7.0 范围、设计、实施计划和验收清单；涉及生产部署时继续阅读 v0.6.0 对应文档。

当前实施层文档包括：

- [Agent 自主交付规范](implementation/agent-delivery-guidelines.md)
- [v0.24.0 计划](implementation/v0.24.0-plan.md)
- [v0.24.0 任务](implementation/v0.24.0-tasks.md)
- [v0.24.0 验收](implementation/v0.24.0-acceptance.md)
- [v0.25.0 计划](implementation/v0.25.0-plan.md)
- [v0.25.0 任务](implementation/v0.25.0-tasks.md)
- [v0.25.0 验收](implementation/v0.25.0-acceptance.md)
- [技术选型决策](implementation/technical-decision.md)
- [技术基线](implementation/technical-baseline.md)
- [初始化、密码与操作反馈本地验证记录](implementation/2026-10-14-auth-feedback-acceptance.md)
- [控制台导航、版本标识与界面细节计划](implementation/2026-10-14-ui-details-plan.md)
- [控制台导航、版本标识与界面细节本地验收](implementation/2026-10-14-ui-details-acceptance.md)
- [标准列表与页脚链接调整](implementation/2026-10-15-standard-lists-plan.md)
- [标准列表与页脚链接本地验收](implementation/2026-10-15-standard-lists-acceptance.md)
- [v0.11.0 实施计划](implementation/v0.11.0-plan.md)
- [v0.12.0 实施计划](implementation/v0.12.0-plan.md)
- [v0.13.0 实施计划](implementation/v0.13.0-plan.md)
- [v0.13.0 任务清单](implementation/v0.13.0-tasks.md)
- [v0.13.0 验收记录](implementation/v0.13.0-acceptance.md)
- [v0.14.0 实施计划](implementation/v0.14.0-plan.md)
- [v0.14.0 任务清单](implementation/v0.14.0-tasks.md)
- [v0.14.0 验收记录](implementation/v0.14.0-acceptance.md)
- [v0.12.0 任务清单](implementation/v0.12.0-tasks.md)
- [v0.12.0 验收清单](implementation/v0.12.0-acceptance.md)
- [v0.11.0 任务清单](implementation/v0.11.0-tasks.md)
- [v0.11.0 验收清单](implementation/v0.11.0-acceptance.md)
- [v0.9.0 实施计划](implementation/v0.9.0-plan.md)
- [v0.9.0 任务级实施清单](implementation/v0.9.0-tasks.md)
- [v0.9.0 验收清单](implementation/v0.9.0-acceptance.md)
- [v0.9.0 详细实现计划](implementation/v0.9.0-detailed-plan.md)
- [v0.8.0 实施计划](implementation/v0.8.0-plan.md)
- [v0.8.0 任务级实施清单](implementation/v0.8.0-tasks.md)
- [v0.8.0 验收清单](implementation/v0.8.0-acceptance.md)
- [v0.7.0 实施计划](implementation/v0.7.0-plan.md)
- [v0.7.0 详细实现计划](implementation/v0.7.0-detailed-plan.md)
- [v0.7.0 任务级实施清单](implementation/v0.7.0-tasks.md)
- [v0.7.0 验收清单](implementation/v0.7.0-acceptance.md)
- [v0.6.0 实施计划](implementation/v0.6.0-plan.md)
- [v0.6.0 详细实现计划](implementation/v0.6.0-detailed-plan.md)
- [v0.6.0 任务级实施清单](implementation/v0.6.0-tasks.md)
- [v0.6.0 验收清单](implementation/v0.6.0-acceptance.md)
- [v0.2.0 实施计划](implementation/v0.2.0-plan.md)
- [v0.2.0 详细实现计划](implementation/v0.2.0-detailed-plan.md)
- [v0.2.0 任务级实施清单](implementation/v0.2.0-tasks.md)
- [v0.2.0 验收清单](implementation/v0.2.0-acceptance.md)
- [v0.3.0 实施计划](implementation/v0.3.0-plan.md)
- [v0.3.0 详细实现计划](implementation/v0.3.0-detailed-plan.md)
- [v0.3.0 任务级实施清单](implementation/v0.3.0-tasks.md)
- [v0.3.0 验收清单](implementation/v0.3.0-acceptance.md)
- [v0.4.0 实施计划](implementation/v0.4.0-plan.md)
- [v0.4.0 详细实现计划](implementation/v0.4.0-detailed-plan.md)
- [v0.4.0 任务级实施清单](implementation/v0.4.0-tasks.md)
- [v0.4.0 验收清单](implementation/v0.4.0-acceptance.md)
- [v0.5.0 实施计划](implementation/v0.5.0-plan.md)
- [v0.5.0 详细实现计划](implementation/v0.5.0-detailed-plan.md)
- [v0.5.0 任务级实施清单](implementation/v0.5.0-tasks.md)
- [v0.5.0 验收清单](implementation/v0.5.0-acceptance.md)
- [v0.0.1 工程实施合同](implementation/v0.0.1-implementation-contract.md)
- [v0.0.1 实施规划](implementation/v0.0.1-plan.md)
- [v0.0.1 工程实施计划](implementation/v0.0.1-engineering-plan.md)
- [v0.0.1 任务级实施清单](implementation/v0.0.1-tasks.md)
- [v0.0.1 验收清单](implementation/v0.0.1-acceptance.md)
- [v0.0.2 实施计划](implementation/v0.0.2-plan.md)
- [v0.0.2 任务级实施清单](implementation/v0.0.2-tasks.md)
- [v0.0.2 验收清单](implementation/v0.0.2-acceptance.md)
- [v0.0.3 实施计划](implementation/v0.0.3-plan.md)
- [v0.0.3 任务级实施清单](implementation/v0.0.3-tasks.md)
- [v0.0.3 验收清单](implementation/v0.0.3-acceptance.md)
- [v0.0.4 实施计划](implementation/v0.0.4-plan.md)
- [v0.0.4 任务级实施清单](implementation/v0.0.4-tasks.md)
- [v0.0.4 验收清单](implementation/v0.0.4-acceptance.md)
- [v0.1.0 实施计划](implementation/v0.1.0-plan.md)
- [v0.1.0 任务级实施清单](implementation/v0.1.0-tasks.md)
- [v0.1.0 验收清单](implementation/v0.1.0-acceptance.md)
- [v0.1.1 实施计划](implementation/v0.1.1-plan.md)
- [v0.1.1 任务级实施清单](implementation/v0.1.1-tasks.md)
- [v0.1.1 验收清单](implementation/v0.1.1-acceptance.md)
- [v0.1.2 实施计划](implementation/v0.1.2-plan.md)
- [v0.1.2 任务级实施清单](implementation/v0.1.2-tasks.md)
- [v0.1.2 验收清单](implementation/v0.1.2-acceptance.md)
