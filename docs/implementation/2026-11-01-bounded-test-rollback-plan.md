# 测试事务回滚有界维护实现计划

> **面向 AI 代理的工作者：** 使用 executing-plans 在当前会话内联执行，标准 task-start／task-done；不派 builder 或逐任务实现者，仅在本地完成后一次独立整分支终审。持续自主授权覆盖普通产品和实现取舍，不重复询问。

**目标：** 旧测试的事务回滚使用独立 5 秒清理上下文，避免异常网络无限等待，保留原清理时序。

**架构：** 仅 `internal/testdb` 共享测试工具及其测试调用者，不改生产 API、数据库或前端。

**技术栈：** 既有 Go／pgx／PostgreSQL／testcontainers；无依赖变更。

**规格：** [有界测试回滚设计](../specs/2026-11-01-bounded-test-rollback-design.md)。

## 全局约束

- 起点为独立 API／fresh fetch 相等的 `2737d503f3d272f315378d8ed3f76aa7a537a692`；源码仅原 linked worktree，分支 `fix/bounded-test-rollback`，无 upstream。
- 外置证据 `.tmp/test-rollback-evidence`；本计划 owned leaf 独立，旧 v0.35.0 档案、合同、原五类 Minor 的历史文字不回写。
- Host Go 显式 `GOTOOLCHAIN=go1.26.10`；Docker 必须，禁本地日常 DB 回退；不触 18080、日常 DB、未知容器、其他 plan。
- 仅进程环境可调，继承环境未全捕获须注明；完整输入集合／SHA／bytes与实际命令、退出码和 runtime 留证，不降阈值、不伪 RED、不借历史 CI。
- 标准生成器和前端本地 suite 的输入不变则不重做。新 head 自身九 CI、真实审查、有效问题公开闭环、match-head squash、独立 master 验证后才交付。
- 不碰 PR240，不 tag／release／deploy。任务完成后持续下一轮，不停止 `moeurl` 十分钟保底任务。

## 审查重点（Review Focus）

1. 调用者上下文已取消时，回滚仍能释放真实 PG 事务和锁，而不是复用取消状态。
2. 外部回滚 IO 等待时确有截止时间，不用 goroutine 提前返回掩盖后台残留。
3. 成功、错误和 panic 均取消 context，panic 原样传播。
4. 已提交／已回滚事务不制造额外失败，其他清理错误不被静默吞掉，也不截断后续清理。
5. 批量采用工具不能改变 defer／Cleanup 注册时间或先后顺序，尤其最早 require 失败前的保护。

## Task 1：工具与旧调用者修复

文件：新增 `internal/testdb/transaction.go`、`transaction_test.go`；机械修改实际存在直接 Background 回滚的 Go 测试，保留时序；新增本设计和验收记录。

- [ ] **步骤1：等价提取与真实 PG 补验。** 先写 `TestRollbackCleanupReportsResult`、`TestRollbackCleanupRealTransactionAfterCallerCancellation`，提取原 Background 调用语义。Expected: 真正 PG 行回滚且另一连接可写，诊断符合约定；不把首次通过冒 RED。
- [ ] **步骤2：真实有界行为 RED。** 加 `TestRollbackCleanupBoundsIO`、`TestRollbackCleanupCancelsContextAfterReturn`、`TestRollbackCleanupCancelsContextAfterPanic`，旧 helper 仍无 deadline／cancel。Expected: 断言失败而非 import/编译故障；保存 raw。
- [ ] **步骤3：最小 GREEN。** 独立 5 秒 WithTimeout、defer cancel、ErrTxClosed 过滤、其他错误 Errorf。Expected: 所有具名回归与真实 PG 通过。
- [ ] **步骤4：替换旧调用者与完整门禁。** 保持每处注册和时序；完整 Go／Linux race／vet／canonical 业务100与checker通过。Expected: 原始失败保留，资源清理核，当前输入稳定；前端／SQLC不变。
- [ ] **步骤5：原子提交与标准完成。** commit显式禁签名，标准 task-done 只复核本轮已成功原件及输入。Expected: Task1 complete，clean，全部命令/环境/原件可追溯。

## Task 2：独立审查与受守卫交付

文件：本轮验收、owned ledger／最终报告，外置完整证据和可恢复归档。

- [ ] **步骤1：唯一整分支终审。** 标准 review-package，附设计、计划五Focus与全部裁决；所有 finding／declined 按事实裁决，必要修复真实 REDGREEN及受影响门禁。Expected: 不以作者自审冒独立审查。
- [ ] **步骤2：候选自身目标验证。** fresh预检后同名push/upstream与唯一PR；自身九CI、完整raw和真实exact-head review、全部有效意见闭环。Expected: 不借旧CI／空review／skip。
- [ ] **步骤3：合并及主分支自身验证。** guarded squash match-head，独立API／fetch／SHA／tree／唯一父、master自身九CI与完整raw。Expected: 所有归属独立。
- [ ] **步骤4：标准完成与可恢复归档。** 全部裁决及延期、失败／文件／commits完整报告；新whole-owned ZIP/extract集合核后仅准确leaf可恢复清理。Expected: 标准Task1–2 complete；保底任务保持ACTIVE，继续下一合理增量。
