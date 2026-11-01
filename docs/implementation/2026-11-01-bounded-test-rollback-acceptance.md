# 测试事务回滚有界维护验收

当前已实现独立 5 秒回滚清理；真实缺陷回归已 RED→GREEN，旧调用者已采用，完整 Go／Linux race／vet 与业务覆盖率全部通过。尚未独立终审、远程验证或交付。

- [x] 等价提取的错误报告／已关闭事务语义和真实 PG 补验：baseline 实际 0，24.755 秒。
- [x] 无 deadline／未 cancel 的三个原行为断言实际失败 1；5 秒有界清理后完整 testdb 实际 0，8.513 秒。
- [x] 19 个旧测试文件、39 处直接 Background 回滚采用工具；逐一 diff 核原 defer／Cleanup 时序不变。
- [x] 完整 Go、Linux race、vet 实际 0；canonical 业务 100.00%／checker 10 PASS；各自完整 779 个输入稳定，最终容器为空。
- [ ] 唯一独立整分支终审、候选自身九CI及真实审查闭环。
- [ ] guarded squash与master自身九CI／完整日志，标准任务和可恢复全量归档。

范围见[设计](../specs/2026-11-01-bounded-test-rollback-design.md)及[计划](2026-11-01-bounded-test-rollback-plan.md)。无业务版本、依赖、生产API、权限或schema变更；其他旧文档Minor不借本轮声称已修。持续开发十分钟保底任务保持ACTIVE，不因单轮结束自动停止。

原件在外置 test-rollback-evidence：rollback-baseline、rollback-deadline-red、rollback-deadline-green 的 before／after／runtime／raw／exit；运行时为显式 Go1.26.10 windows/amd64，Docker 必须、Ryuk 禁用，继承环境未全捕获。相应原输入集合各自稳定；新完整门禁仍按其实际最终结果另记，不借定向通过代替全套。

完整验证：仓库 cwd，Host 使用 go test -p=2 -count=1 -timeout=15m -coverprofile=外置 rollback-full-coverage.out ./...，一次全套同时采 profile，18 个测试包通过、2 个无测试包；go vet ./... 实际 0。显式 Node26.3.0 运行标准 go-coverage-threshold.mjs 和自身 10 项测试，原 include／exclude 规则不改。原单字符串版本查询虽 exit0 但 raw 为空，不作版本证据，已单独显式 --version 留证，不重跑检查器。

Linux 使用精确 cached runner b0674632、Go1.26.10 linux/amd64、CGO1、source readonly、新 owned cache；只读复制旧缓存，robocopy 实际 1 属正常成功。进程 GOPROXY=https://goproxy.cn，其余显式环境与命令见 rollback-linux-attempt.json／*-command.json；完整 go test -race -p=2 -count=1 ./... 实际 0，raw1177 bytes／SHA F6CEDCD00B5B46D88E6535E2D92275D4075B1D05354B8A13E22DA9CF6377811B 已全文读取。最终 docker ps -a 为空；Host 先结束时曾有并发 Linux 容器，不把那个中间快照冒最终为空。本轮没有新本地 govulncheck、安全镜像、前端 suite、SQLC 或浏览器结论；相关源输入未改，不重复旧成功运行。
