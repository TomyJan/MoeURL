# 站点强调色验证与交付文档收尾计划

> **面向 AI 代理的工作者：** 使用 executing-plans 内联执行；标准 task-start／task-done 与独立 owned 账本。不得派 builder、逐任务审查者或第二次整分支终审。长期自主授权覆盖常规询问，普通进度静默。

**目标：** 在不增加业务版本或修改生产行为的前提下，补齐 v0.34.0 延期的双独立管理员验证、修正当前交付文档与 E2E 文件末尾空行。

**架构：** 复用真实 App／Cookie Session／PostgreSQL 和 AppearanceService；两个独立账号属于有效的内置 admin 组。同一完整版本、不同预设同步竞争，直接核对最终值与唯一审计的实际赢家 actor。

**技术栈：** 既有 Go、Chi、SQLC、Goose、PostgreSQL、Vue、Vitest、Playwright；无依赖、API、权限、schema 或主题目录变化。

**依据：** [v0.34.0 范围](../product/scope-v0.34.0.md)、[设计](../specs/2026-10-30-v0.34.0-site-accent-design.md)、[原验收](v0.34.0-acceptance.md)、[自主交付规范](agent-delivery-guidelines.md)。本轮完整评估与原审查证据在外置 `.tmp/v034-next-assessment/next-iteration-assessment.md`；v0.34.0 已完成的任务、原件与归档不重做。

## 全局约束

- 独立基线为 API 与 fresh fetch 一致的 master `fc88c0e8b9192174e62b225fdc3cb0b87a253451`，tree `a39419689248f4500c4830a0df1a48c11e2d470d`，唯一父 `6d45adceec060991ee9955dcda13e9c609922638`。分支 `test/site-accent-closeout` 无 upstream，复用现有 C: linked worktree，不创建或删除旧 worktree／branch。
- 标准 owned leaf 仅 `.superpowers/sdd/2026-10-30-site-accent-closeout-plan`；证据仅 `D:/Dev/TomyJan/MoeURL/.tmp/site-accent-closeout-evidence`。禁止重建已删除的旧 v034 leaf，不修改其冻结 ZIP、提取集、报告或合同。
- 本轮只改测试、E2E 无语义 EOF 与相关 Markdown。保留同身份 CAS 的有效断言；新测试初次通过仅称补验，不伪造产品 RED，不为得到红灯修改生产代码。若发现真实 runtime 缺陷，保留原失败并重新评估范围，不暗扩。
- SQLC／权限目录输入未变，不重复生成；不降覆盖率、不扩大排除、不加固定 sleep、不通过 mock callcount 替代数据库状态。
- 当前输入、完整路径集合／hash／bytes、cwd、显式环境、继承未全捕获、实际 Go／Node／image 与 rawexit 分别留证。主机 Go 固定 `GOTOOLCHAIN=go1.26.10`，Linux race 使用既有精确 runner 与新 owned cache；前端只用 nvm Node26.3.0／pnpm11.5，禁止自动安装。分支基线的 manifest／lock 与旧安装状态须先核，不能把旧依赖组合冒作新组合验证。
- 不触 18080、日常 DB、webdist、未知 Docker／reaper、其他 plan、全局网络／Git 配置、tag／release／deploy。CodeGraph 按长期用户约束跳过。GitHub 只用既有进程 GCM wrapper；提交签名 false。同名 push、唯一 PR／attach、match-head guarded squash，不 force 或绕保护。PR236 保持不触。

## 审查重点（Review Focus）

1. 两个账号 ID、用户名及 Session 独立，数据库都属于当前有效内置 admin 组；不得只复用同一 Cookie 或伪造 actor 代替 App 验证。
2. 两个写请求使用同一原始完整版本和两个不同的非当前预设；ready／start 与真实 PostgreSQL 锁观测证明两请求同时排队，失败等待有界且不会遗留 goroutine／事务。
3. 胜负从各请求真实返回值独立识别；恰一成功／一冲突，最终预设与完整版本等于赢家，唯一 appearance 审计的 actor 精确等于赢家，而非任选有效管理员或只比较 count。
4. 同身份旧断言、no-store、版本推进及仅键名审计仍保留；不将覆盖补强误报为已修生产漏洞，不将旧 suite 或制品归于本轮提交。
5. 当前入口准确区分 PR237 已合并／候选与 master 各九 CI／标准任务与归档完成和未正式发布；原失败、三个 Minor 当时延期及各 SHA 原身份不改写。

## Task 1：真实双身份并发补验与 EOF

**Interfaces — Produces：** 真实 App／Session 和 Service 的独立管理员 CAS 补验；保留旧同身份测试。**Consumes：** 原三 API、完整 updatedAt、900207 和现有事务审计契约。

- [ ] **步骤 1：核对生产与夹具。** 精读 `internal/app/appearance_test.go`、`internal/system/appearance_service_test.go`、现有账号创建／登录与审计 helper；两个真实账号用既有支持方式建立，App 从独立登录 Cookie 读取实际身份。记录原两个测试只验证同身份的真实边界。
- [ ] **步骤 2：补测试。** 在上述两个测试文件增加具名独立管理员场景，同版本 ocean／forest 竞争；channel 与真实行锁同步。核成功响应与请求预设、完整版本推进、最终公开／管理值、冲突未覆盖及唯一审计 actor／resource／changed_fields。保留原同身份 CAS 断言，只修 App 原失实注释。Expected: 初次通过称补验；失败先分类并留原件。
- [ ] **步骤 3：EOF 与受影响门禁。** `web/e2e/v0.34.0-site-accent.spec.ts` 只移除额外一个 LF，正常 terminal LF 与全部断言保留。固定 Go 下定向真实测试、全仓 `go test -p=2 -count=1 ./...`、vet、原 14 包 coverage＋checker10／selected100、Linux 全仓 race；完整输入稳定、仅本轮 owned 资源清理。前端 manifest／安装核验后运行适当 lint／types，不安装、不冒新 runtime E2E；无语义 EOF 的二进制比较单独核。生产／SQLC 输入完整不变，不重无关 generator、browser 或 image；本轮 PR 和 master 各自九 CI 仍必须独立通过。
- [ ] **步骤 4：原子提交及标准完成。** 提交测试与 EOF，记录原输入／实际运行／失败；owned `verify-task1.ps1` 只核完整成功原件、当前完整输入与冻结生产边界，不重复 suite。标准验证命令：`pwsh -NoProfile -File .superpowers/sdd/2026-10-30-site-accent-closeout-plan/verify-task1.ps1`。Expected: 实际 PASS 才完成。

## Task 2：当前文档与历史交付状态同步

- [ ] **步骤 1：修正主题规格。** 更新 `docs/specs/themes-and-i18n.md` 中“仅设计”文字为准确已实现／已合并、尚未正式发布；只说明已有三个预设和边界，不增加主题能力。
- [ ] **步骤 2：同步当前入口。** 检查 `README.md`、`docs/README.md`、`docs/product/{overview,roadmap,development-status,scope-v0.34.0}.md`、`docs/implementation/{technical-decision,technical-baseline,v0.34.0-tasks,v0.34.0-acceptance}.md` 及必要实施索引。准确回填 PR237／fc88、候选99eb／CI40949991695与master／CI40955501280各九成功、标准 Task1–4、完整最终归档与准确 leaf 可恢复清理。保留原 SHA、失败、运行时／漏洞／截图限制以及 Minor 当时未修；本轮补验按本轮身份另记，不提前宣称本维护已合并。
- [ ] **步骤 3：门禁与原子提交。** 全部分支 diff-check、变更 Markdown 本地链接、状态交叉一致性、无 runtime／依赖／schema 漂移，核 Task1 完整输入仍相同；原子 docs 提交。标准验证命令：`pwsh -NoProfile -File .superpowers/sdd/2026-10-30-site-accent-closeout-plan/verify-task2.ps1`。Expected: 不修改历史原件，不重复未变 suite，实际 PASS 才完成。

## Task 3：唯一整分支终审与本地档案

- [ ] **步骤 1：标准审查包。** 精确 fc88..HEAD、完整计划／原规格、五 Review Focus 原文和全部 Ruling 交给唯一 fresh 最强 actually supported reviewer；不派 builder／阶段 reviewer／下级或第二次审查。
- [ ] **步骤 2：逐项核事实。** 包括 declined／outside／nitpick，每项裁决保留完整原文、理由与错误代价。Minor 依技能延期披露；有效 Important／Critical 仅一轮真实 RED→GREEN、受影响完整门禁，不能暗改范围或以复审替测试。
- [ ] **步骤 3：wholeowned 本地 ZIP。** 全部 owned 文件逐路径 set／hash／bytes 与提取集相同，保留 live leaf 供远端阶段。标准验证命令：`pwsh -NoProfile -File .superpowers/sdd/2026-10-30-site-accent-closeout-plan/verify-task3.ps1`。Expected: 标准完成、原件冻结，不提前把后继文件归入旧 ZIP。

## Task 4：独立远端交付与最终收尾

- [ ] **步骤 1：fresh 预检与唯一 PR。** master／openPR／branch／输入核对后显式同名 push／upstream、ls-remote 独立核，唯一 create＋attach。任何上游漂移先只读评估，不触 PR236。
- [ ] **步骤 2：候选九 CI 与真实审查。** 成功后唯一完整 raw 下载、actualexit／ROOT 连续 EOF；真实最新 kindreviewed、sourceCommitId＝coveredCommitId＝精确 head，comments／reviews／inline／threads／checks 全部分页及 nested 完整。有效 inline 原位 reply／resolve，outside 公开处置；运行中不催／重复 manual，empty reply／skip／neutral 不代覆盖。
- [ ] **步骤 3：guarded squash 与独立 master。** match-head、无冲突／有效 open0／不绕保护；独立 API＋fetch＋SHA＋tree＋唯一父证明，master 自身九 CI 与完整原始日志另核，不借候选门禁。
- [ ] **步骤 4：标准完成与准确清理。** 标准验证命令：`pwsh -NoProfile -File .superpowers/sdd/2026-10-30-site-accent-closeout-plan/verify-task4.ps1`。实际 PASS 后完整最终裁决／Minor／文件／提交／运行时与限制报告，wholeowned 最终 ZIP／extract 完整核，再只清准确新 leaf、siblings 不变，旧分支／worktree 保留；全部完成才通知。

## 计划自检

Task1→Task2 保持完整生产输入冻结，Task2→Task3 提供精确文档事实与新补验证据，Task3→Task4 是唯一完整候选。五 Focus 分别由双身份夹具、真实锁同步、赢家／audit 断言、输入与原失败证明、文档交叉核覆盖。没有新产品范围、依赖、SQLC 或发布承诺。
