# 前端开发依赖安全维护验收

2026-10-27：从实际合并的 `6933f94c` 创建独立分支 `fix/frontend-security-dependencies`。已完成兼容补丁解析、官方 audit 及完整前端门禁；真实浏览器、精确制品与远端交付尚未完成。本维护不新增产品版本；package 保持 0.25.0。

GitHub 4 条 development 公告及实际 `pnpm why` 已确认，分别为 Vitest mocker 5.0.0、magicast 路径的 source-map-js 1.2.1、Vue test-utils／js-beautify／config-chain 路径的 ini 1.3.4。生产可达性与开发依赖公告分开记录；现有 production 扫描不替代本轮新依赖镜像验证。

- [x] 独立分支、实际基线与公告路径核验。
- [x] 原始 audit 与最小补丁解析。
- [x] frozen-lockfile、完整前端／四项 100%、静态及隔离构建。
- [ ] 完整真实 Playwright、新 production smoke 与精确镜像扫描。
- [ ] 上一版合并及各入口状态同步。
- [ ] 独立终审、有效修复、原子提交。
- [ ] 本轮最新 PR CI／实际 CodeRabbit／合并。
- [ ] 合并后 CI 后台跟进。

证据目录：`D:/Dev/TomyJan/MoeURL/.tmp/frontend-security-20261027/`。上一版原始 CI／CR／合并证据仍在 `v025-evidence/`；不将其写成本维护依赖更新后的验证。

## 补丁与前端证据

默认 npmmirror 的 audit endpoint 不存在，原始 `baseline-audit.json` 是准备错误，不当作安全 RED。使用命令级官方 registry 的 `baseline-audit-official.json/.exit` 实际报告 2 high／2 moderate，精确对应上述 4 个 GHSA。标准 pnpm 更新 Vitest／coverage-v8 至 5.0.3；刷新现有 `@testing-library/vue@8.1.0` 的兼容子树后为 test-utils 2.5.1／js-beautify 2.0.3／ini 1.3.8，source-map-js 仅剩 1.2.2。传递 beautifier 主版本变化明确保留供审查；没有新增 override、根运行时包升级或手改锁文件。frozen install 退出 0，官方 `audit-after.json/.exit` 为 0，420 个依赖、所有严重度均为 0。

完整门禁发生于设计提交 `9d3cdd7` 上待提交依赖树，Node 26.3.0／pnpm 11.5.0／Vitest 5.0.3。`frontend-gates.ps1` 与 `frontend-*-command.json/.log/.exit` 保存实际参数和退出码：95 文件／1704 项通过，Statements 3995/3995、Branches 2851/2851、Functions 1304/1304、Lines 3324/3324，四项 100%；lint／typecheck／隔离 build 均 0、无新增构建警告。新 patch 的覆盖计数与旧 runner 不同，不沿用旧分母。249 项完整 web 输入运行前后集合／hash／字节一致，产物仅在证据目录 coverage／dist，不冒称后续提交的构建注入。

## 合并后 CI 的实际失败

v0.25 实际合并提交 `6933f94c` 的后台 [CI #40406334592](https://github.com/TomyJan/MoeURL/actions/runs/40406334592) 为 8 成功／E2E 失败，不能用 PR 的 9 项成功替代。失败是新审计用例 390px 在下载后直接点菜单，成功 Toast 拦截指针；其他导出 E2E 先验证提示并通过可访问关闭按钮退出提示。当前优先补齐相同用户流程的确定性同步，不使用 force click、固定休眠或降低超时来掩盖。失败原始日志保存在上一版证据目录 `pr222-master-ci-failed.log`；修复与新浏览器证据尚待完成。
