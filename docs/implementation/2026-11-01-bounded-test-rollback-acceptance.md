# 测试事务回滚有界维护验收

当前为设计和原始问题核查阶段，尚未实现或运行新测试，不宣称修复、可合并或交付。

- [ ] 等价提取的错误报告／已关闭事务语义和真实 PG 补验。
- [ ] 无deadline／未cancel的原行为真实失败，随后5秒有界清理GREEN。
- [ ] 全部旧直接Background测试回滚调用采用工具且时序不变。
- [ ] 完整Go、Linux race、vet、canonical业务100／checker及当前输入稳定。
- [ ] 唯一独立整分支终审、候选自身九CI及真实审查闭环。
- [ ] guarded squash与master自身九CI／完整日志，标准任务和可恢复全量归档。

范围见[设计](../specs/2026-11-01-bounded-test-rollback-design.md)及[计划](2026-11-01-bounded-test-rollback-plan.md)。无业务版本、依赖、生产API、权限或schema变更；其他旧文档Minor不借本轮声称已修。持续开发十分钟保底任务保持ACTIVE，不因单轮结束自动停止。
