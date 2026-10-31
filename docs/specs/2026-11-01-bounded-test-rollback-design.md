# 测试事务回滚有界维护

## 目标与依据

主分支 `2737d503f3d272f315378d8ed3f76aa7a537a692` 仍有旧测试直接以 `context.Background()` 回滚。正常路径可用，但数据库网络异常时没有调用级截止时间；长期延期的测试清理隐患应单独维护，不再混入产品增量。该轮不新增业务版本。

用户已授权持续主动循环开发、沿用内联执行及既有交付流程；本设计的具体取舍由执行者决定，不冒逐条用户批准。

## 方案

在 `internal/testdb/transaction.go` 提供 `Rollback(reporter rollbackReporter, rollback func(context.Context) error)`。调用者传入测试报告者及事务的 `Rollback` 方法值；报告接口只需 `Helper` 和 `Errorf`。该工具仅供测试，不增加生产 service 方法。

每次调用创建独立的 Background 派生、5 秒 timeout context，defer cancel，避免沿用已取消的测试上下文。正常返回和 panic 都取消 context；不吞 panic。nil 与可由 `errors.Is` 识别的 `pgx.ErrTxClosed` 无额外失败，其他回滚错误经 `Errorf` 报告，不用 Fatal 中断后续清理。

将现有测试中直接 `Rollback(context.Background())` 的回调改用工具，保持原 defer／Cleanup 注册时间、LIFO 顺序及锁释放时机。显式用于同步释放 gate 的回滚调用也用同一工具，不改变业务期望。已自行设置正确 timeout 的新测试不改。

## 验证

先对原行为做等价提取并以真实 PostgreSQL 验证正常回滚和已取消测试上下文下的清理；首次通过只记补验，不伪 RED。随后在同一 helper 上运行有界 IO、返回后取消和 panic 后取消测试，观察旧 Background 行为真实失败，再实现 5 秒截止时间使其通过。受控回滚回调只替代外部网络 IO，不为业务逻辑建 mock；真实 PG 测试证明事务未提交数据被丢弃、锁释放后另一连接可继续写。

最终运行完整 Go、Linux race、vet、业务覆盖率 100% 及覆盖率检查器；目标 CI 的九项检查与真实最新提交审查分别核。前端、SQLC 和产品运行时输入不变时不重复本地成功 suite、生成器或镜像构建；CI 自身检查不能借旧提交。

## 非目标与边界

不改生产事务策略、schema、权限、HTTP API、前端、依赖、产品版本或既有历史验收。5 秒不是对不遵守 context 的任意恶意回调提供强制终止，实际 pgx 回滚尊重 context；不启动 goroutine 假装取消后已停止 IO。其他四类旧文档 Minor 保留，PR240 不触。

隔离 linked worktree 复用；新分支 `fix/bounded-test-rollback`，原分支及工作树不删。仅外置本轮证据和本计划 owned leaf 可写。持续开发保底任务为 `moeurl`，每 10 分钟 ACTIVE；只在用户明确要求时停止，不因本轮交付而删除。
