# v0.33.0 首页文案范围

状态：已由 [PR #231](https://github.com/TomyJan/MoeURL/pull/231) 合并为 `811d6c57`，最终 `34a520b` 的 PR CI40852026042 与合并 master CI40858639758 各九成功，真实最新审查／有效意见闭环，标准 Task1–4、完整最终归档及准确 leaf 可恢复清理完成，未正式发布。唯一 fresh 终审 Important 已真实 RED→GREEN 修复；三个 Minor 在本版延期，后继 [v0.33.1](scope-v0.33.1.md) 独立修复。原99f877起点、各次dirty输入／失败／SQLC恢复和be7本地产品保持[验收](../implementation/v0.33.0-acceptance.md)归属，不冒合并提交实际本地执行。

## 目标

补足品牌方向中最小的首页文案配置：管理员可保存首页首屏标题与简介，访问者看到站点自己的介绍。留空的字段独立使用当前界面语言的既有默认文案。

## 必须实现

- 仅两个可选纯文本值：标题最多 80 个 Unicode 码点，简介最多 200 个；保存时裁剪首尾空白，禁止控制字符。两个字段整份提交，空字符串表示恢复该字段的默认文案。
- 复用系统设置页面，但使用独立表单、独立资源及完整精度版本；不改变旧 public-config／settings DTO 或旧完整更新契约。
- 使用当前数据库账号及用户组重新判断 `admin:access` 与 `system:manage`。乐观并发冲突不覆盖草稿、不自动重试写入。
- 实际变更与只含资源键的审计同事务；no-op 不写版本或审计，陈旧版本即使内容相同仍冲突。
- 首页读取失败或尚未完成时可用既有本地化文案；自定义文本不经过 HTML、Markdown 或 i18n 插值。中英、桌面／手机及长不可断文本可读且不横向撑开页面。
- 当前账号或权限改变后隐藏编辑状态，迟到响应不得恢复旧身份草稿或产生成功提示。

## 不在本版

Logo／Favicon、图片上传、自定义主题色／CSS、HTML／Markdown、链接、按钮配置、翻译管理、SEO／Open Graph、下翻介绍区编辑、跳转页模板和通用 CMS。无新权限、依赖或在线部署参数。

## 验证与交付

[规格](../specs/2026-10-29-v0.33.0-homepage-copy-design.md)、[计划](../implementation/v0.33.0-plan.md)、[任务](../implementation/v0.33.0-tasks.md)和[验收](../implementation/v0.33.0-acceptance.md)共同判定完成状态。真实 RED→GREEN、完整 Go／前端业务 100%、生成零漂移、隔离浏览器与精确产品、唯一 fresh 终审以及每个 PR head／合并 master 各自九 CI 分别留证。无 tag、release 或正式部署。
