# 当前能力与交付状态对齐设计

v0.43.1 已完成 master 九项 CI、标准 Task3 和最终可恢复归档。本维护轮从 master 10d317e42b87f30aada48089ea38c5000caca302 独立开始，只对齐文档。

## 目标与选择

消除当前入口的已确认矛盾，让无人值守开发依据真实缺口选择下一增量。执行者依长期自主授权选择一个独立文档维护轮，不增加产品版本或产品行为。沿用 Markdown、既有 Git 与标准任务流程；没有新依赖、API、数据库、权限、构建或部署变化。

已确认：development-status 的用户行仍把已交付 v0.36.0 写为远端待做；标题标签行称内部备注未开发；overview 最新能力停在 v0.33.1；roadmap 称时区、导入和可配置主题色全未实现，遗漏已交付固定时区预设、有界CSV创建及固定强调色。个人／全站只读标签查找已经交付，但独立标签实体、重命名、合并及颜色层级没有交付。不得把部分实现扩大为完整治理或通用导入。

比较：继续新业务会沿用失真的需求表；整体搬移历史有链接与证据丢失风险；选择只改当前能力表和最新摘要，为旧段落加明确历史标签，不删除历史原文、不改冻结账本。

## 范围

修改 docs/README.md、docs/product/{overview,development-status,roadmap}.md 的当前摘要和能力表，修复 v0.43.1 scope 的 R-M1 表格前空行，补记本轮完成后才成立的 v0.43.1 最终交付。核实 v0.35/36/38/39/40/41/42/43 各 scope 和 acceptance，只改当前事实有证据支持的字段。产品范围、旧失败、逐候选执行身份、原始限制和所有未发布结论保留。版本原计划的复选框仅据 standarddone／收据勾选，不能为了整齐回填未执行的外部互操作或生产演练。

当前表至少准确区分：固定与任意主题色；本人时区显示与统计任意时区；有界批量创建／CSV创建与导出恢复；标签只读聚合与标签实体治理；内部纯文本备注与公开字段、搜索或历史；有序最多五个页脚链接与HTML／媒体上传。

## 文件与证据

正式维护计划和验收使用 docs/implementation/2026-11-03-capability-status-{plan,acceptance}.md；必要设计用 docs/specs/2026-11-03-capability-status-design.md。独立 owned leaf 和外置证据在正式启动时确定。逐行能力证据矩阵引用已完成版本的 scope／acceptance 与冻结交付收据，旧ZIP／合同和迁出leaf不变。新文档不借旧CI充当自己的CI。

## 验收与流程

Task1：建立证据矩阵，核原收据，修改精确文档，git diff --check、所有本地链接和完整非Markdown集合／hash／bytes全等核验，原子提交及标准done1。纯文档不伪RED、不写镜像散文的测试，不重成功产品suite或生成器。

Task2：一次fresh最强supported整分支终审，逐项处置；完整报告与本地whole-owned归档／解压集合核验，标准done2。

Task3：本轮唯一push和PR，最新真实覆盖、全部有效问题闭环及自身九CI／完整raw；guarded squash match-head、独立API／fetch SHA／tree／唯一父、本轮master九CI／完整raw；standarddone3及新whole-owned最终ZIP／解压／准确leaf可恢复迁出。保留分支和worktree，不触PR240、18080、日常DB、未知资源或siblings，不发布／部署／tag。

## 五项审查重点

1. 已合并能力与未发布分开，历史CI绝不归属新维护提交。
2. 部分能力边界完整，不把固定预设／只读聚合／有界CSV创建冒成完整编辑／治理／恢复。
3. 旧失败、候选、运行时、扫描和未看artifact限制完整保留。
4. 当前摘要与历史阶段清晰分隔，历史文字不再作为当前待办。
5. 所有变更仅Markdown；R-M1确实解决；本地链接有效、旧冻结档案不变。

## 额度

PR255 bot6595688821 updated_at=2026-11-03T04:55:34Z，明示每小时最多一次included review，余0；当前11290ae已covered，不请求。下一轮若触发skipped，必须读它当时实际评论的更新时间与恢复时长，不能复用旧评论猜额度，也不能等skipped自行恢复。到明示恢复时点后fresh无running且该head无manual才一次合规请求。
