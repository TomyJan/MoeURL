# 前端开发依赖安全维护实现计划

> **面向 AI 代理的工作者：** 使用 executing-plans 原生执行，最终由全新最强模型审查整个分支。用户已授权持续自主交付，无需常规确认。

**目标：** 清除 4 条已核实的开发工具链公告，保持既有产品行为、100% 门禁和完整真实交付验证。

**架构：** 仅同步 Vitest／coverage 补丁与兼容传递依赖解析；不新增运行时框架、权限或数据库变更。

**技术栈：** Node 26、pnpm 11.5、既有 Vue／Vitest／Playwright／Docker。

**规格：** [安全维护规格](../specs/2026-10-27-frontend-security-dependencies.md)。

## 全局约束

- 实际基线 `6933f94c20c508c879f50b7ed7afa673cc1e5e40`，独立无 upstream 分支 `fix/frontend-security-dependencies`，不等待主分支后台 CI。
- package 保持 0.25.0；mocker 解析最低 5.0.3、source-map-js 最低 1.2.2、ini 最低 1.3.6，优先同主版本最小补丁。
- 标准 pnpm 更新与 frozen-lockfile 安装；不手工编辑锁文件、不降低覆盖／安全策略、不用忽略规则隐藏公告。
- 输出隔离到 `D:/Dev/TomyJan/MoeURL/.tmp/frontend-security-20261027/`，无多余 pnpm `--`；不写主检出源码、日常服务／DB 或 web/dist。

## 审查重点

- mocker 与 coverage／runner 不同补丁的兼容风险：依赖树、1704 项真实单测与原覆盖配置共同检查。
- 锁文件看似安全但父依赖仍保留受影响副本：核对完整解析树及 4 个 GHSA，而非只看顶层版本。
- 小升级掩盖 UI、下载或公开访问变化：完整 Playwright 95 项与生产 smoke。
- 用旧制品冒充新依赖产物：新冻结 HEAD／输入、精确 image ID／扫描对象与静态版本分别核对。
- v0.25 合并与发布状态混淆：入口与页尾同步实际 PR／merge／CI，未完成事项继续未勾选。

### 任务 1：补丁解析与前端回归

**文件：** 修改 `web/package.json`、标准生成 `web/pnpm-lock.yaml`；本维护验收记录。本任务不改产品源码或测试实现。

- [ ] 保存真实 `pnpm audit --json`、完整依赖路径及基线输入。Expected：命令结果能明确证明上述受影响版本／GHSA；网络失败只记录准备问题，不冒充安全失败。
- [ ] 用 pnpm 标准入口同步 Vitest／coverage-v8 至 5.0.3，并在现有兼容范围解析传递 ini／source-map-js 的安全补丁。Expected：无受影响副本，无无关主版本更新；必要约束裁决留账。
- [ ] `pnpm install --frozen-lockfile` 后核查完整树和 audit，再顺序运行 `pnpm test:coverage --maxWorkers=2 --coverage.reportsDirectory=<隔离绝对目录>`、lint、typecheck、`pnpm build --outDir <隔离绝对目录> --emptyOutDir`。Expected：原 1704 项通过、四项 100%、命令 exit0、无新增构建警告；准确记录 runtime／输入／退出码。
- [ ] 原子提交 `fix(依赖): 修补前端测试与构建工具链安全公告`。Expected：仅必要 package／锁文件和准确阶段记录，不改阈值、排除、runner 或业务实现。

### 任务 2：真实制品、文档与交付闭环

**文件：** 本维护验收记录；最小修改 `web/e2e/v0.25.0-audit-export.spec.ts` 的下载反馈同步；更新 `docs/README.md`、`docs/product/{overview,roadmap,development-status,scope-v0.25.0}.md`、`docs/implementation/v0.25.0-{acceptance,tasks,plan}.md` 的实际集成状态；按真实依赖约定影响同步技术文档。不批量重写历史证据。

- [ ] 优先修复实际后台 CI #40406334592 的 390px Toast 遮挡失败。Expected：像其他导出用例一样验证成功提示、用可访问关闭按钮清除并等待消失，再继续菜单；定向真实浏览器通过，不使用 force／sleep 或更改产品通知。

- [ ] 在专用 Compose 项目／端口运行完整 Playwright 与标准 production smoke／精确 image Trivy；先验证资源／端口为空，终态检查资源清理。Expected：95 项真实浏览器、smoke、HIGH／CRITICAL 扫描 exit0；新镜像对应真实新 HEAD，旧后端输入复用有完整集合／hash 证据，不重复无变化 Go／race。
- [ ] 同步 v0.25 PR #222 最终 `d250b4b` 的 9 项 CI #40404362865、CodeRabbit run `5500f594-8bf3-4135-b13a-72fcb9566588` 全 50 文件、merge `6933f94c`；主分支 CI #40406334592 后台如实查询，不阻塞，发布仍未完成。Expected：入口／页尾无“v0.25 未合并”现行措辞，历史保留明确归属。
- [ ] 记录精确验证、已跳过项及理由，原子文档提交；`git diff --check`／status。Expected：所有完成项有原始证据，工作树干净。
- [ ] 一次全分支独立终审；有效问题按风险修复；显式同名 push、PR／attach、最新 head 9 CI 与实际 CodeRabbit 无误后 squash＋match-head 合并。Expected：不绕保护、不强推，主分支 CI 后台跟进后继续下一轮。
