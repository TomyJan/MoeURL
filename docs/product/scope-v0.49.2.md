# v0.49.2 空通知区域间距范围

## 最终交付（2026-11-05）

本版已完整交付。PR268 最终候选47811e6568815e375ceccac4d13abd164e58b54b真实审查覆盖、有效问题闭环；候选41890239146和master41894181402各九SUCCESS，完整日志均ROOT至EOF。合并master8d72dda0696d139194ebea6aaeb24605abbe8607、tree06a4513cc3ee5b94164f5c695b641929340cb993与候选一致，唯一父81591816c6cde10c78a9f386fcec1ffc8513bc70已独立核验。master E2E203 passed，前端3253项及既定四100；运行时分别保留，不混借。

标准Task1–3与全部17条裁决完整报告、whole-owned ZIP／extract核验和准确leaf可恢复迁出均完成。ZIP191035bytes／SHA256 E4F5300E443C611892510FD09FD439B6A05FC684F9CD02A7FE703414353EF9E1，17文件586651bytes全集核等，siblings不变。外置v0492-evidence/task3-v0492-final-delivery-archive-extracted/delivery-complete-report.md保存最终报告；原leaf移动至worktree父级.moeurl-v0492-completed-owned-leaf，代码和分支保留。M1手机通知遮挡导航由v0.49.3独立处理，M5／M9保留历史归属；未发布部署。下方未勾选项与阶段表仅为当时历史，不代最终状态。

2026-11-04 从已完整交付 PR265 的 master `81591816c6cde10c78a9f386fcec1ffc8513bc70` 启动；分支 `fix/v0.49.2-empty-toast-gap`。空区域布局已实现，真实业务几何 RED→GREEN，3253 项前端、13 项定向和 203 项完整浏览器、73 张完整回归原图及精确产品验证通过；唯一独立终审无 Critical／Important。Task1 标准完成，Task2 本地收尾中，远端交付尚未完成，见[计划](../implementation/v0.49.2-plan.md)和[验收](../implementation/v0.49.2-acceptance.md)。

## 目标

解决 v0.49.1 延期 F1：没有通知时，空 wrapper 仍在自定义 flex／grid 中贡献 14／16 px 额外间距。弹窗第一业务内容应从原 border＋padding 后开始。

## 必须实现

- modal 目标实际没有任何 toast DOM 节点时，空 wrapper 脱离正常流且零尺寸；初始空、手动关闭末条和自然退出后均适用。
- 退出中的真实消息继续占用有界正常流，真正移除后再消除结构间距；下一条消息恢复原可见区域。
- 单一 Toaster 和原节点、队列、六秒默认、五条可见、30dvh 有界区域、逐条关闭、主题语言、安全文本、原生滚动与焦点行为保持。
- 真实业务手机抽屉与创建框几何 RED→GREEN；fixture 另验证完整生命周期，不相互冒作证据。

## 非目标

不改父容器 gap，不隐藏或卸载 live region，不增加通知历史或依赖，不修页面通知挡鼠标入口，不扩 M5／M9 风格和历史表述，无 API、schema、权限、Go 或 SQLC 变化。

## 选择理由

先收敛已审查确认、能独立验证的共享布局缺口；批量备注替换、CSV 多列和头像等属于独立协议与安全范围，本版不纳入。具体盘点、约束与验证见[设计](../specs/2026-11-04-v0.49.2-empty-toast-gap-design.md)。
