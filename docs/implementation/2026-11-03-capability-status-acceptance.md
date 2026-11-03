# 当前能力与交付状态维护验收

## 范围与实际阶段

从已交付 v0.43.1 的 master `10d317e42b87f30aada48089ea38c5000caca302` 建立 `docs/capability-status-20261103`，只修正文档。不新增业务版本，不改变运行时、权限、API、迁移、依赖或测试。Task1 已在 `40ffb72` 标准完成，Task2 已标准启动；本轮终审、远端和归档只按后续实际结果记录。

外置证据：`D:/Dev/TomyJan/MoeURL/.tmp/capability-status-20261103-evidence`。`baseline.json` 已冻结完整 902 个非 Markdown 路径及 hash／bytes、23 项旧收据和 ZIP；`capability-evidence.json` 逐项记录以下能力、允许表述、非目标和原件 Path／Bytes／SHA256。旧 ZIP／合同／失败原件不修改，不重新解压、运行旧 suite 或调用旧 API。

## 能力证据矩阵

| 能力 | 已交付的边界 | 未实现的扩展 | 范围与原验收 |
| --- | --- | --- | --- |
| 页脚链接 | 最多五项有序标签／URL，独立 CAS，保留旧文字和固定署名 | HTML、媒体上传 | [范围](../product/scope-v0.35.0.md)、[验收](v0.35.0-acceptance.md) |
| 账号时区显示 | 本人跟随设备或九个固定 IANA 预设，仅改变显示 | 任意时区目录、站点代改、UTC 统计／CSV／到期输入改变 | [范围](../product/scope-v0.36.0.md)、[验收](v0.36.0-acceptance.md) |
| 精确记录时间 | 审计／访问两表展开原始时间，手机提示留白 | 时间协议变更 | [范围](../product/scope-v0.37.0.md)、[验收](v0.37.0-acceptance.md) |
| 批量创建 | 本人最多 20 条，预览确认后原子创建 | 旧清单恢复、跨页全选 | [范围](../product/scope-v0.38.0.md)、[验收](v0.38.0-acceptance.md) |
| 个人默认跳转方式 | 当前有权个人模式作为创建初选 | 强制授权、改写既有短链 | [范围](../product/scope-v0.39.0.md)、[验收](v0.39.0-acceptance.md) |
| CSV 网址录入 | 浏览器本地 UTF-8、65536 字节、单列 `target_url`、1–20 条；显式预览确认 | 多列清单、旧短码／归属／历史恢复、文件上传 | [范围](../product/scope-v0.40.0.md)、[验收](v0.40.0-acceptance.md) |
| CSV 格式帮助 | 双语示例及固定公开模板 | 放宽解析器、包含用户数据的模板 | [范围](../product/scope-v0.40.1.md)、[验收](v0.40.1-acceptance.md) |
| 本人标签查找 | 当前本人只读聚合及精确筛选 | 独立标签实体、空标签、集中写入 | [范围](../product/scope-v0.41.0.md)、[验收](v0.41.0-acceptance.md) |
| 全站标签查找 | 当前管理授权下的独立全站只读聚合 | 重命名／合并、颜色层级、跨用户写入 | [范围](../product/scope-v0.42.0.md)、[验收](v0.42.0-acceptance.md) |
| 内部备注 | 独立纯文本、1000 码点、随资源转移 | 公开字段、CSV、搜索、批量、HTML、历史 | [范围](../product/scope-v0.43.0.md)、[验收](v0.43.0-acceptance.md) |
| 备注版本边界 | 请求／响应纳秒词法，本地和 UTC 年份 1–9999，保留原字符串 | 其他资源统一解析、权限／CAS 变化 | [范围](../product/scope-v0.43.1.md)、[验收](v0.43.1-acceptance.md) |

三个固定站点强调色沿用 [v0.34.0 范围](../product/scope-v0.34.0.md)和[原验收](v0.34.0-acceptance.md)，不扩大为任意颜色编辑。已合并不等于发布：真实 DNS/TLS、外部 OIDC、恢复／回退和生产验收仍按[能力清单](../product/development-status.md)各自环境记录，不能据本次文档更新补勾。

## 冻结交付证据

v0.35.0 最终收据明确候选 `a5cfaff`、master `2737d503`、标准 Task4 实际 0、22 文件全集和 295 条裁决；旧等待和失败只属于旧时点。v0.36.0／0.37.0 独立合并原件分别为 PR243／master `5dc1c8aa`、PR244／master `617c12cc`；最终归档及准确 leaf 可恢复迁出另有原回执。原 v0.36.0 标准完成校验失败及归属修复的两个结果均保留，不用修复后的成功擦除失败。

v0.38.0 至 v0.43.0 各版最终原收据均实际标准完成 0、全文件集合 hash／bytes 核验成功。其原完整失败、扫描告警、未看 CI artifact 和不同运行时限制保留原验收，不改写成无警告或零漏洞。v0.43.1 最终 PR255、候选／master 各九 CI、标准 Task1–3、17 条裁决及可恢复归档见[最终验收](v0.43.1-acceptance.md)。这些原件只证明旧版交付，不是本维护提交的执行结果。

## 本轮完成条件

- [x] 标准 start1 和完整 brief；建立 902 输入基线及 11 项能力证据矩阵。
- [x] 当前入口、能力表、旧 scope 最终状态及 R-M1 空行与证据一致；首轮文档检查实际 0，14 份 Markdown、684 个本地链接有效，diff 检查通过，902 非 Markdown 和 23 项冻结旧档案全部不变。后继文档与提交完成核验另记。
- [x] Task1 原子提交 `40ffb72`、完成合同和标准 done1；14 份 Markdown／684 个本地链接、902 非 Markdown 和 23 项旧档案核验实际 0，无产品 suite 或 API 重跑。
- [ ] 唯一 fresh 整分支终审、全部有效意见处置、完整报告和本地归档、标准 done2。
- [ ] 本轮最新真实远端覆盖、候选自身九 CI／完整日志、守卫合并和独立 SHA／tree／唯一父。
- [ ] 本轮 master 自身九 CI／完整日志、标准 done3、新全成员 ZIP／解压／准确 leaf 可恢复迁出及 siblings 不变。

纯文档修改不伪造产品 RED，不添加重复实现的测试，不重产品 suite 或生成器；本轮目标 CI 独立执行。未执行项不预先勾选。见[设计](../specs/2026-11-03-capability-status-design.md)和[计划](2026-11-03-capability-status-plan.md)。
