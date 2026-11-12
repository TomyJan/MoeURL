# v0.65.1 用量卡片浏览器身份切换补测

交付结论（2026-11-12）：本维护已通过 PR318 正常 squash 为 master `a4c956b6f60148077c0b0d249810f3d83513d94b`。最终 bce0e 的真实 CodeRabbit、有效意见处置、独立 API／fetch／tree／唯一父、两个标准任务及 9 成员可恢复归档均已核准。18 条完整裁决、原失败、原 fulfilled 调用返回与修复后 31.1s／5 项浏览器保持各自归属；产品仍 0.65.0，未查 CI 或发布部署。完整报告见本机 `.tmp/v0651-evidence/v0651-owned-live-recovery/final-report.md`，原冻结合同不改。下方为原交付前检查点。

状态：Task1 标准完成。唯一独立终审发现一项测试结果判定问题，已补真实请求终结和浏览器处理边界；真实取消诊断 RED→GREEN，完整中英×桌面／390px 四场景及 setup 再次通过（31.1s），E2E strict types／lint 通过。原 29.6s 及四份 fulfilled 附件只证明路由调用返回，原件不改。自身真实 CodeRabbit 与正常交付尚待。基线为 PR317 已交付 master `a716d42474994f7ba6e9deac37371396adff4852`；产品保持 0.65.0。

## 盘点与选择

| 来源及现状 | 本版处理 | 影响与风险 |
| --- | --- | --- |
| PR317 Ruling25：旧 E2E 在退出后 page.goto，销毁 JS 运行时 | 先用运行时标记证明旧流程不足，再走真实 UI 退出、登录和控制台导航 | 仅测试；防止把刷新页面误当身份通知接线验证 |
| 原单元测试覆盖同 composable 的 epoch、换人及迟到响应 | 保留原归属，补浏览器整合证据，不替换原结论 | 不声称路由卸载后的原 composable 仍活着 |
| v0.65.0 已合并归档，当前文档仍停在审查前 | 更新当前入口及原版任务状态；原失败、组合结果和 Minor 延期原件不改 | 文档维护，不倒填旧执行 |
| 全站访问 CSV 合并导出 | 本版不纳入，后续独立收敛 | 避免测试维护扩为权限／查询功能 |

## 必须实现

- 中英 × 1280／390px 四个既有用量场景，退出和再次登录期间保留同一 window 标记；只能走真实 SPA UI，不注入 QueryClient 或手改 auth 缓存。
- A 已用 1，B 是新建普通账号已用 0；截留 A 的真实服务端响应，B 登录并看到 0 后才放行。按准确 Request 的 requestfinished／requestfailed 观察终结；成功读取已完成的 A 响应，失败记录实际 failure，跨浏览器渲染边界后 B 仍为 0。不能按 fulfill 调用返回判定投递或取消，实际 B 请求的 expected-owner header 属于 B。
- guest 阶段用量卡片消失；真实登录与退出返回成功，并以真实 auth/me 对照身份。账号、短链与共享设置在 finally 精确恢复。
- 先运行旧 goto 流程加运行时断言，预期标记丢失；这是测试证明能力的 RED，不冒产品缺陷。最小替换为真实 UI 后运行完整受影响 spec、E2E types 和 lint。
- 唯一 fresh 整分支独立终审、最终真实 CodeRabbit、正常合并独立核验及 whole-owned 可恢复归档。

## 非目标与资源

不改产品版本、生产代码、API、权限、迁移、生成物、依赖或视觉样式。不重跑未受影响的完整 Go／单元 suite、产品编译、smoke 或扫描；复用逐 hash 相同的原产品，明确原执行 SHA。不要把浏览器路由切换当成未卸载 composable 测试。

不查 CI，不安装、不发布部署，不碰 PR240／266／267、18080、日常 DB 或未知资源。活动版本 ≤4 GiB，两根 `.tmp` 合计 ≤12 GiB，Docker 可回收缓存 ≤6 GiB；大型操作先预算，用完立即精确清理。

见[设计](../specs/2026-11-12-v0.65.1-usage-identity-browser-design.md)、[计划](../implementation/v0.65.1-plan.md)、[验收](../implementation/v0.65.1-acceptance.md)。
