# v0.33.1 首页文案反馈稳定性

状态：已由 [PR #232](https://github.com/TomyJan/MoeURL/pull/232) 合并为 `cf5d5a647febf6d7c5ee306605432066ca5bd2e8`，最终候选 `91cf9d5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40885738492) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40892523382) 各九成功，真实最新 CodeRabbit 覆盖／有效意见闭环，标准 Task1–3 与完整最终归档、准确 leaf 可恢复清理完成。原两项行为 RED→GREEN、本地候选与产品、失败及旧选择 helper 改键盘的覆盖取舍保持[验收](../implementation/v0.33.1-acceptance.md)归属。基线 `811d6c57`；未正式发布、tag 或部署。

## 版本选择

本轮先完成首页文案已有闭环的稳定性补丁，再引入路线图上的新能力。v0.33.0 的三项延期 Minor 均有准确事实和可验证边界：旧保存提示会误导新草稿状态，后台刷新会短暂显示默认文案，路线图仍写旧阶段。选择补丁版本而非新功能版本，是 Agent 在长期自主授权下的取舍，不冒充逐项人工批准；原延期记录、原 ZIP 与 CI 原件不改写。

## 必须实现

- 管理员成功保存后，任一字段发生新的编辑，应立即移除上次成功提示；保留新草稿及服务器完整版本，不自动保存。冲突、保存失败及校验错误反馈不因普通编辑而被误清，仍须显式保存或重载处理。
- 同一首页挂载已成功读到文案后，后台 invalidation／reconnect 刷新期间继续呈现该次成功的内容；新请求成功后替换，失败后回退默认文案。首次读取、重新挂载后的未完成读取仍使用当前语言默认，不能闪现旧缓存。
- 逐字段空值回退、纯文本呈现、当前语言默认、创建入口、身份 generation、权限和 CAS 原契约不变。
- 当前文档入口、路线图及 v0.33.0 验收补记独立真实 PR／master CI 与最终归档，明确修复前延期事实；本补丁自己的证据另行记录。

## 非目标

不新增 API、数据库 migration、权限、依赖、媒体、主题配置或新品牌能力；不改变全局 QueryClient 重试／刷新策略，不保留失败后的旧文案，不改其他设置表单的提示行为。无正式发布、tag 或部署。

## 验收

真实组件回归先 RED 后 GREEN；完整前端四项 100%、lint、types、隔离 build；实际桌面／移动管理编辑反馈及首页受控后台刷新 E2E；完整浏览器、精确产品 smoke／扫描；唯一 fresh 最强支持模型整分支终审。最终候选自身九 CI、真实最新 CodeRabbit 覆盖／有效意见闭环、guarded squash、独立合并证明与 master 自身九 CI、完整证据归档和可恢复清理均实际完成后才整体通知。详见[设计](../specs/2026-10-29-v0.33.1-homepage-feedback-design.md)、[计划](../implementation/v0.33.1-plan.md)和[验收](../implementation/v0.33.1-acceptance.md)。
