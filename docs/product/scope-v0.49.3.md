# v0.49.3 手机通知与导航范围

最终状态：已由 [PR269](https://github.com/TomyJan/MoeURL/pull/269) 完整交付，master `4b5d4dc4db6d14a430cdc3cdf7238f3d9516da77`。候选真实审查、候选／master 各九 CI 与完整日志、标准 Task1–3、23 条裁决报告和可恢复归档完成。未发布部署；下方原阶段保留历史归属，完整证据见[验收](../implementation/v0.49.3-acceptance.md)。

从已交付 PR268 的 master `8d72dda0696d139194ebea6aaeb24605abbe8607` 启动，分支 `fix/v0.49.3-mobile-toast-navigation`。导航避让和唯一终审两项 Important 修复均经真实 RED→GREEN；3270 项前端四项 100%、修复后 clean19cdba9 的完整 208 项浏览器、83 张原图和精确产品／正常漏洞库扫描通过。Task1 标准完成，Task2 标准收尾中；远端审查、候选和 master 各九 CI、守卫合并及最终归档仍待，未发布部署。起点已成功的 fetch、空 PR 列表、分支切换及 1326 输入基线保持原件，不重复执行。见[设计](../specs/2026-11-05-v0.49.3-mobile-toast-navigation-design.md)、[计划](../implementation/v0.49.3-plan.md)与[验收](../implementation/v0.49.3-acceptance.md)。

## 目标与必须实现

- 修复前版 M1：页面通知仍可见时，手机控制台菜单、新建、账号与展开的偏好菜单可以真实触摸操作。
- 只在 body 目标且实际可见手机 header 存在时，依据 header 和其内部展开菜单真实下边界避让；不在 JavaScript 中复制 CSS 断点。
- 通知区域有界、原生滚动，短屏长内容和关闭按钮可触及；桌面、首页与 modal 保持原定位规则。
- 保持单一 Toaster、原消息节点、剩余六秒默认生命周期、五条可见、安全文本与焦点规则。
- 真实未过期业务消息下 tap 的 RED→GREEN、单元边界、完整前端及浏览器、精确产品、真实审查和独立远端交付。

## 非目标与选择

不增加业务入口、API、权限、schema、Go、SQLC 或依赖，不开展批量备注替换、CSV 多列或上传。优先解决已有可用性缺口，M5／M9 保留历史归属。极短到不能同时容纳导航和消息的视口不承诺同时完整展示；320 px 高须实际滚动验证。测试通过不代替最新提交真实审查、候选和 master 自身 CI。
