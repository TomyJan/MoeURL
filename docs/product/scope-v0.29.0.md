# v0.29.0 每域名默认跳转方式

## 阶段与基线

Task1–4 标准切片及远端闭环已完成；[PR #227](https://github.com/TomyJan/MoeURL/pull/227) 于 2026-10-28T04:16:45Z 合并为 `8af05d60fb89769f7aaabf4da4906ed411fdad48`。最终 `4dfa4d43` 的 PR CI #40629796924 与合并 master CI #40631422772 各九成功，实际 CodeRabbit 覆盖最终且有效 open0。分支 feat/v0.29.0-domain-default-redirect-mode 从 b1b1e411 建立，保留未删；唯一实现终审 C0／I2／M1、root 集中修复、远端反馈和各候选制品／原失败分别见[验收](../implementation/v0.29.0-acceptance.md)。合并不等于正式发布。

本轮依据 roadmap 的「域名与默认策略」、domains 和 admin 规格补齐每域名默认跳转方式。root 依长期自主设计授权决定常规细节；不声称用户逐项批准本文件的具体方案。一次 fresh builder check 与完整实现计划后由 root 原生实现；一次独立最强实现终审、root 集中修复及实际远端审查闭环分别记录，不把作者验证冒独立复审。

## 目标

管理员为每个短链域名配置 direct、intermediate 或 confirmation。新建短链面板在实际选定域名后，用当前有权使用的域名配置作为默认模式；明确手动模式始终优先。配置不是强制策略或权限，不追溯修改任何已有短链。

## 必须实现

- domain 增加非空 default_redirect_mode，默认 direct，复用 updated_at；新建／旧域名均安全默认 direct。独立保存动作只更新该字段，旧详情、排序、默认切换请求保持原严格 DTO，不覆盖新配置。
- 三个新 no-store 严格接口：管理 GET /api/v1/admin/domain/redirect-default?id=...、POST /api/v1/admin/domain/set-redirect-default，及本人 GET /api/v1/domain/redirect-defaults。不扩旧 available／managed／short-link DTO。
- 管理保存在五秒审计事务内，按域名全局 advisory 排他锁、当前账号共享锁、当前 builtin admin 组共享锁、目标域名排他锁，等待后重查当前 DB 身份和 admin:access＋domain:manage。完整精度 CAS 先于同值 no-op；变化单调推进版本且审计只新增 default_redirect_mode 字段名。
- 本人投影仅包含当前有效账号、内置主组、创建及域名角色权限、启用和组授权交集中的域名。无模式权限时该域名有效默认为 direct，不返回不可用域名 UUID／元数据。当前数据库读取快照不依赖入口 GroupKey 或旧 auth/me 权限。
- 创建模式优先级为有效明确手动值 → 当前域名的有权默认 → direct。域名选择仍沿用手动／个人／组／全局／有序首项；两种默认互不替代。旧 API 省略 redirectMode 仍 direct；显式模式仍由原短链 Service 最终授权和保存。
- 仅配置模式，不配置域名级倒计时；自动 intermediate 使用既有五秒。用户改模式或倒计时即成为本次草稿手动选择，域名切换、迟到读取与 focus 刷新不覆盖；重置／创建成功／身份 epoch 变化清除，重新采用当前默认。
- 自动模式读取未知／失败时阻止隐式提交，提供重试和显式“本次使用直接跳转”；没有任何增强模式权限时无需等待该读取即可使用原 direct。显式模式不被失败默认读取阻塞，但仍遵守原域名选择屏障及后端授权，不自动重发失败创建。
- 管理页新增独立默认模式编辑器，与详情、排序草稿互锁；共享域名版本、明确重载、查询失败停写、保存后刷新屏障、当前身份／目标与卸载轮次隔离。中英双语及桌面／移动端都可实际使用。
- migration Up／Down／再 Up、SQLC 标准生成零漂移、旧 DTO／API omission、真实 DB／HTTP／锁等待／审计回滚、真实组件与 QueryClient、完整 browser 及新精确制品门禁。保持原业务／前端 100 阈值与原排除范围。

## 非目标与反目标

不实现个人／用户组默认跳转偏好、强制模式、域名倒计时、模板／404、访客创建、自助绑定、DNS/TLS、既有短链批量修改、头像／时区或新权限／依赖。不把配置当作模式授权，不重解释旧省略请求，不修改公开 Open／Preview／Unlock／Continue 或访问量口径。不正式生产部署。

## 功能盘点与风险

| 能力／来源 | 当前事实 | 本轮范围 | 后端／数据库 | 前端／测试 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 每域名默认方式／roadmap、domains、admin | 尚无配置 | 纳入 | 可空方案不采用；非空枚举、共享版本、独立投影与动作 | 独立管理草稿和创建模式 | 中：不能破坏旧 DTO／省略语义 |
| 三模式和访问链路／redirect-modes、v0.2／v0.4 | 已实现 | 复用，不改公开语义 | 原短链字段和权限检查不变 | 创建后保存模式和真实访问回归 | 高：不得把默认升级为强制策略 |
| 域名授权、排序、个人／组默认／v0.8、v0.26–28 | 已合并 | 沿用 | 同一当前 DB 身份与授权交集 | 两层选择和迟到结果测试 | 高：越权或跨身份旧默认 |
| 域名审计和 CAS／v0.18、v0.27 | 已实现 | 最小扩充 | 00028、标准 SQLC、字段名审计 | 草稿互锁、冲突与恢复 | 中：旧动作误清配置或陈旧同值 |
| 模板／绑定／DNS/TLS／roadmap | 未实现 | 排除 | 无 | 无假入口 | 高且独立，另版设计 |

## 完成标准

管理员能独立保存三种默认；普通用户只按当前权限获得创建初选，明确手动与旧 API 保持原意。保存后的短链模式不随域名配置改变。scope／设计／计划／任务／验收、各候选实际输入、运行时和原始结果对应；最新精确 head 自身九 CI、真实 CodeRabbit reviewed 覆盖及全部有效意见闭环后，才允许 guarded 合并。正式发布继续独立。

完整技术与交互契约见 [设计](../specs/2026-10-28-v0.29.0-domain-default-redirect-mode-design.md)。
