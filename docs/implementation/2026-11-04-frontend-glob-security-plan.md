# 前端 glob 工具链安全维护实施计划

> 面向 AI 代理的工作者：使用 executing-plans 原生执行；末段唯一 fresh 最强 supported 整分支终审，不派 builder 或逐任务实现者。无人值守自主交付已有授权。

**目标：** 关闭两个已核开发依赖公告，保持 v0.48.0 行为与版本。

**架构：** 精确父版本 override，标准 pnpm 生成锁文件；Docker 首次安装读取完整 workspace 合同。所有本地验证使用新隔离依赖和新产品制品。

**技术栈：** 既有 Node 26、pnpm 11.5、Vue、Vitest、Playwright、Docker。

**规格：** [维护规格](../specs/2026-11-04-frontend-glob-security.md)。

## 全局约束

- 基线 `6aa7c0aa5a805446fae16e7d8453388763081f23`，分支 `fix/frontend-glob-security`，package 保持 0.48.0。
- minimatch 11.0.2／glob 14.0.3，按规格五条精确父版本覆盖；标准生成锁文件，禁止手改。
- 不污染 host node_modules、web/dist、全局配置、日常资源或其他计划；不碰 PR240，不发布部署。
- 完整原始输出、退出码、cwd、显式环境、继承未全捕获边界、运行时、HEAD／dirty、全输入 hash／bytes 和 owned 资源分别留证。
- 复用成功原件，不重复成功 suite、审查、API 或归档；缺失或失败按事实最小恢复，不覆盖原件。

## 审查重点

1. override 没匹配父依赖请求：任务1核 frozen 安装后的完整 list／why 和两个 GHSA，不能仅核配置文字。
2. minimatch 删除 API 或 partial／escape／globSync 语义变化：任务1运行真实 lint／types 和完整覆盖测试，不禁规则或改期望。
3. Docker 首次安装遗漏 workspace：任务2真实标准 Docker 构建、smoke／restart 和精确新镜像扫描，不用字符串测试冒行为证明。
4. 后端复用掩盖部署输入改变：任务2核完整 Go／SQLC 输入，产品和浏览器必须新跑。
5. 安全与交付状态混淆：任务1 audit 全严重度、任务2产品选定严重度、任务3真实审查及两套 CI 分别验收。

## 文件职责

`web/pnpm-workspace.yaml` 定义五条约束；`web/pnpm-lock.yaml` 为标准生成的解析结果；`Dockerfile` 首次安装消费完整合同。维护 spec／plan／tasks／acceptance 记录范围和实际证据；docs 入口及 v0.48.0 文档同步已完成交付，不重写历史失败。

## 任务 1：依赖解析、安装与完整前端回归

**Interfaces：** 产生标准生成的 lock、五条 workspace 规则、新精确依赖 image ID 与完整前端证据，供任务2消费。

- [x] 只读核磁盘、Docker 接口和 owned 资源；核原 baseline audit hash 与旧依赖合同，复用实际 2 moderate／exit1，不伪产品 RED。标准 task-start1／读 brief。
- [x] 外置解析目录复制 package／lock／workspace，加入规格五条覆盖；精确 Node26／pnpm11.5 容器执行 `pnpm install --lockfile-only --ignore-scripts --registry=https://registry.npmjs.org`。Expected：exit0，标准 lock diff 仅目标闭包；异常无关升级先定位。
- [x] 将标准生成 lock 和 workspace 带回源码；Dockerfile 首次 COPY 加 workspace。新 owned 依赖镜像执行 `pnpm install --frozen-lockfile`。Expected：读取相同三文件合同，安装成功，旧 image 和 host 依赖不变。
- [x] 新镜像运行 `pnpm list --depth Infinity --json`、`pnpm why minimatch glob`、官方 `pnpm audit --json --registry=https://registry.npmjs.org`。Expected：全部目标路径安全、两个 GHSA 消失；其他公告按实际记录，不忽略。
- [x] 新依赖顺序运行 lint、typecheck、`pnpm test:coverage --maxWorkers=2 --coverage.reportsDirectory=/output/coverage`、`pnpm build --outDir /output/dist --emptyOutDir`。Expected：完整至少3119项通过、四100%、命令exit0；无新增构建警告，完整输入稳定、owned容器空。
- [x] 同步准确阶段记录，完整diff／链接／输入核后原子提交8d2195dc；标准task-done1实际0，只验证已有证据，不重suite。

## 任务 2：真实产品、浏览器和唯一终审

**Interfaces：** 消费任务1的新依赖合同与clean提交；产生完整本地合同、独立审查处置和阶段归档供任务3使用。

- [x] 标准start2／读brief；核独占端口与准确compose项目三资源为空。完整187项Playwright使用当前Dockerfile构建的新产品，驱动仅在实际依赖闭包和对应lock块全部相同时复用host Playwright1.64.1，不安装host依赖、不借旧工具链结果；不skip／mock／fallback。raw／exit及完整输入稳定、结束三空已核，46原图逐张检查。
- [x] 标准产品build／smoke／restart／version，核binary／static身份、精确image与正常数据库更新启用的Trivy选定HIGH／CRITICAL三目标。各exit0；23个BuildKit缓存步骤及未过期seed DB实际复用分别记录。
- [x] Go／SQLC完整对应519输入与原成功合同set／hash／bytes相等，复用原身份，未重跑。Dockerfile变化单独验证，不声明整个非web集合全等。
- [x] 末段唯一fresh最强supported整分支终审；Critical／Important零，无产品修复轮；M1随计划文档收尾。五项Declined逐项裁决及错误代价、旧M5／M9延期保留，不派第二席。
- [ ] 完整报告、完成合同与阶段whole-owned ZIP／extract全集核后标准done2；阶段档案不冒最终交付。

## 任务 3：远端交付与可恢复归档

**Interfaces：** 消费任务2clean合同；产生最终独立远端证据与可恢复档案。

- [ ] 标准start3／brief、显式同名push／upstream、唯一PR；最新head自身九CI完整raw至EOF，全部新／编辑讨论实读，旧正文逐hash复用。
- [ ] 额度停止依据当前PR评论updated_at和明示时长加分钟余量；到点fresh无running／本head已有manual才一次请求，真正启动与完成分别核。最新head真实kind reviewed／source covered及全部有效问题闭环open0。
- [ ] fresh完整guard、独立synthetic父[base,head]／tree、match-head squash；独立merge／commit／ref API和唯一fetch核master SHA／tree／唯一父。
- [ ] master自身九CI与完整rawEOF、全部裁决及延期完整报告、标准done3、新whole-owned ZIP／extract全集核、准确leaf可恢复迁出／siblings不变。不删branch／worktree。
- [ ] 更新简明状态并短通知完成，继续下一增量；automation ACTIVE／10分钟仅兜底。

## 自检与标准完成

五个风险均由对应实际安装／工具链／产品／远端门禁覆盖。任务1三文件合同和image供任务2使用，任务2clean本地合同供任务3使用；职责无重叠执行。配置与生成物不伪造产品RED，基线audit是已实际失败的安全诊断。每项标准done运行外置证据验证器，核原始退出与输入而不重跑成功门禁；缺证据必须拒绝完成。
