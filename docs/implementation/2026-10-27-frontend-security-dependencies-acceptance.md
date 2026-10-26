# 前端开发依赖安全维护验收

2026-10-27：从 `6933f94c` 开始的独立维护已通过 [PR #223](https://github.com/TomyJan/MoeURL/pull/223) 合并为 `cafacf1520e4ea59934af4c1339a56224c2fdcd0`。最终 `a9a53b98574ffb665ae64ce5dad4dace12939c11` 的 [PR CI #40415038034](https://github.com/TomyJan/MoeURL/actions/runs/40415038034) 与该新合并的 [master CI #40421454231](https://github.com/TomyJan/MoeURL/actions/runs/40421454231) 各 9 项成功，手机 E2E 失败已远端闭环。真实 CodeRabbit 首审 `7a64a01c` 与最终增量 `96713c38` 覆盖最终变更，无有效未解决意见；锁文件按既有过滤排除，不冒称机器人审读锁文件。独立本地全分支终审仍保持原 `6933f94c..472efc0f` 归属和零发现。本维护不新增业务版本，package 保持 0.25.0，尚未正式发布。

GitHub 4 条 development 公告及实际 `pnpm why` 已确认，分别为 Vitest mocker 5.0.0、magicast 路径的 source-map-js 1.2.1、Vue test-utils／js-beautify／config-chain 路径的 ini 1.3.4。生产可达性与开发依赖公告分开记录；现有 production 扫描不替代本轮新依赖镜像验证。

- [x] 独立分支、实际基线与公告路径核验。
- [x] 原始 audit 与最小补丁解析。
- [x] frozen-lockfile、完整前端／四项 100%、静态及隔离构建。
- [x] 完整真实 Playwright、新 production smoke 与精确镜像扫描。
- [x] 上一版合并及各入口状态同步。
- [x] 独立终审、有效修复、原子提交（`6933f94c..472efc0f`，无未解决问题）。
- [x] 本轮最新 PR CI／实际 CodeRabbit／合并（最终 a9／PR #223／新合并 cafacf15）。
- [x] 合并后 CI 后台跟进（#40421454231，实际 9 成功，95 完整 E2E／1704 前端／四项100）。

证据目录：`D:/Dev/TomyJan/MoeURL/.tmp/frontend-security-20261027/`。上一版原始 CI／CR／合并证据仍在 `v025-evidence/`；不将其写成本维护依赖更新后的验证。

本维护执行账本、完整报告和审查包校验归档于证据目录的 `sdd-final-archive.zip` 与 `sdd-final-archive-check/`；完整工程裁决及错误时的代价见 `delivery-decisions.md`。原始证据 manifest 共 692 项，独立终审逐项核实 hash／字节全部相符；后续阶段文档与远端证据另留，不冒充原 manifest 范围或构建注入。最终 PR 与新 master 的完整 metadata／原始日志／下载 exit0 为 `pr223-a9-ci-complete.*` 和 `pr223-master-ci-complete.*`；新 master 原始日志核实 95 完整 E2E（8.6 分钟）、1704 前端和四项100，其余安全／Go／构建检查亦实际成功。完整集成及最终可选语法建议核验理由见 `pr223-integration-receipt.md`／`pr223-final-review-decision.md`。这些结果属于 cafacf15，不把旧693失败改写成成功。

## 补丁与前端证据

默认 npmmirror 的 audit endpoint 不存在，原始 `baseline-audit.json` 是准备错误，不当作安全 RED。使用命令级官方 registry 的 `baseline-audit-official.json/.exit` 实际报告 2 high／2 moderate，精确对应上述 4 个 GHSA。标准 pnpm 更新 Vitest／coverage-v8 至 5.0.3；刷新现有 `@testing-library/vue@8.1.0` 的兼容子树后为 test-utils 2.5.1／js-beautify 2.0.3／ini 1.3.8，source-map-js 仅剩 1.2.2。传递 beautifier 主版本变化明确保留供审查；没有新增 override、根运行时包升级或手改锁文件。frozen install 退出 0，官方 `audit-after.json/.exit` 为 0，420 个依赖、所有严重度均为 0。

完整门禁发生于设计提交 `9d3cdd7` 上待提交依赖树，Node 26.3.0／pnpm 11.5.0／Vitest 5.0.3。`frontend-gates.ps1` 与 `frontend-*-command.json/.log/.exit` 保存实际参数和退出码：95 文件／1704 项通过，Statements 3995/3995、Branches 2851/2851、Functions 1304/1304、Lines 3324/3324，四项 100%；lint／typecheck／隔离 build 均 0、无新增构建警告。新 patch 的覆盖计数与旧 runner 不同，不沿用旧分母。249 项完整 web 输入运行前后集合／hash／字节一致，产物仅在证据目录 coverage／dist，不冒称后续提交的构建注入。

## 合并后 CI 的实际失败

v0.25 实际合并提交 `6933f94c` 的后台 [CI #40406334592](https://github.com/TomyJan/MoeURL/actions/runs/40406334592) 为 8 成功／E2E 失败，不能用 PR 的 9 项成功替代。失败是新审计用例 390px 在下载后直接点菜单，成功 Toast 拦截指针；其他导出 E2E 先验证提示并通过可访问关闭按钮退出提示。修复 `2aabdccfd67bbd52a619eff759bce47e8921be01` 仅补 5 行相同用户流程的确定性同步，不使用 force click、固定休眠或调整超时，不改产品通知行为。旧 CI 失败是原始 RED，新真实定向及完整浏览器是修复后的 GREEN，不伪造产品实现前时序；远端恢复由本维护实际 PR #223／新合并 cafacf15 的独立9成功CI证明。原失败日志在上一版证据目录 `pr222-master-ci-failed.log`。

## 新浏览器与精确制品

`browser.ps1` 使用应用／OIDC 端口 18195／19195、`moeurl-e2e-security-targeted`／`moeurl-e2e-security-full`，Docker enabled、独立真实 PostgreSQL，无 skip／mock／fallback。实际 Node 26.3.0、pnpm 11.5.0、Playwright 1.64.1；目录为工作树 web。定向命令 `pnpm test:e2e e2e/v0.25.0-audit-export.spec.ts --output D:/Dev/TomyJan/MoeURL/.tmp/frontend-security-20261027/security-targeted-1-results --reporter=line`：5 passed／3.3 分钟／exit0，注入实际 `bbb84873`、待提交 5 行测试随后提交为 `2aabdccf`。修复后 lint／专用 E2E tsc 各 exit0，`toast-fix-{lint,typecheck}.log/.exit` 保留原始结果；类型配置仅复用上一版同一工作树的专用 E2E tsconfig，未改仓库配置。

完整命令 `pnpm test:e2e --output D:/Dev/TomyJan/MoeURL/.tmp/frontend-security-20261027/security-full-1-results --reporter=line`：精确 `2aabdccfd67bbd52a619eff759bce47e8921be01` 上 95 passed／6.4 分钟／exit0。原始 before／after、log／exit 保留 253 项完整 web／部署执行输入，前后集合／hash／字节一致、每轮专用容器／网络／卷均空。真实手机菜单和双语、5 个原始 CSV、撤权、native URL 清理仍由原场景验证；新截图不再要求成功 Toast 保持遮挡，实际关闭提示也属于用户流程。没有把旧 95 项或新定向结果替代本次完整运行。

新 `production.ps1` 在同一精确 `2aabdccf` 上执行标准 `scripts/compose-smoke.sh`，独占项目 `moeurl-compose-smoke`、端口 18171，smoke／静态元数据／精确镜像 Trivy／输入检查／资源检查均 exit0。新 image 为 `sha256:008087883f5579c962c46e0f6720e5185696ec899873bbd428ae15e9291cbc19`，assets 实际匹配 `V0.25.0-2aabdcc` 与完整 commit URL。Trivy 0.74.0、官方 schema2 DB、正常自动更新、`ignore-unfixed=false`，精确 ArtifactName 匹配该 image，HIGH／CRITICAL 为 0，不称全部严重度零漏洞。

扫描缓存由上一版官方缓存预热，非新下载；`security-final-trivy-cache-provenance.json`／`security-final-trivy-db-after.json` 保留来源、DB SHA256 `FEEFBADC2AC95624D885203A353F131072C2EE4A03700D8FF4462151ABC4CE0A`、UpdatedAt `2026-10-26T01:20:01.38093772Z`、NextUpdate `2026-10-27T01:20:01.380937429Z` 与真实 DownloadedAt。完整 Backend323／核心 Frontend215／Deployment7 新输入前后不变，专用资源三类为空；新依赖制品没有借用旧 `974ffa89` 的镜像扫描。后端 323 项与本维护起点一致，复用实际 `6933f94c` CI 中已通过的 Go／race／安全／SQLC，不重新运行不变本地 Go 套件。后续纯文档提交不冒充 `2aabdccf` 的构建或扫描 SHA。
