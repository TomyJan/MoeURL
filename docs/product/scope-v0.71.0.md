# v0.71.0 可选目标 CIDR 白名单

状态：设计与计划已自检，尚未实现。基线为 v0.70.1／[PR337](https://github.com/TomyJan/MoeURL/pull/337) 已完整交付的 master `ff6a86bf9109e776e70aa6119fd2c4fc3ea52d1c`。当前产品仍为 0.70.0；独立审查、CodeRabbit、正常合并与本版交付均须各自取得证据。该增量是 Agent 沿路线图和长期自主授权的决定。

## 盘点与选择

| 能力 | 本版选择 | 影响与风险 |
| --- | --- | --- |
| 六份既有 DNS／IP 拒绝与 DNS 允许资源 | 保持旧 DTO；新增第七份独立资源 | 七存储同事务先验证，风险高 |
| 同时允许 DNS 主机与字面 IP 网段 | 纳入，默认关闭的 CIDR 允许集合 | 三个启用允许集合取并集，拒绝始终优先 |
| 七个新目标写入口、回执及旧访问 | 接入新资源，保持原子性／回执优先／不追溯旧访问 | 事务和 unknown 恢复风险高 |
| DNS 探测、通配、SSRF、外部信誉、历史封禁 | 不纳入 | 不发网络探测或通用网络安全承诺 |
| 前版四框和六处文字 Minor | 随本实际增量同步 | 不另开文档维护循环，不改原执行身份 |

## 必须实现

独立 `security.target_cidr_allowlist` 默认 `{"enabled":false,"prefixes":[]}`；0–100 个 IPv4／原生 IPv6 CIDR，启用必须有 1–100 项，关闭保留列表，清空不能暗中关闭。复用已审的严格 CIDR 规范：控制字符先拒后 trim、无符号无前导零前缀长度、主机位清零、规范排序和重复整体拒绝；允许重叠但不合并。拒绝 mapped CIDR，mapped 目标 Unmap 后按 IPv4；兼容 IPv6 保持原生 IPv6。读取不修复坏存储，关闭的资源也必须合法。

三个启用的允许集合取并集：DNS 可命中启用的精确／后缀 DNS，字面 IP 可命中启用的 CIDR。只启用 CIDR 会拒绝全部 DNS 新目标，只启用 DNS 时仍拒绝 IP；三个全关不增加语法限制。CIDR 关闭时完整保留旧允许语义。基础禁限和四份拒绝策略始终优先，命中允许或 `/0` 也不能解除；不解析 DNS、不重写目标 URL。

持 shared policy gate 的同一事务先完整读取验证七份存储，再执行任何拒绝／允许判断。新资源保存复用 exclusive gate，先于账号、组和业务行锁。七个实际写入口全部接入、无管理员绕过；整批受限零部分写，当前授权后同内容已提交回执优先恢复，异内容冲突。锁内同字节／省略目标编辑和旧 open／preview／unlock／continue 不读新资源，不追溯封禁。

独立 GET `/api/v1/admin/system/target-cidr-allowlist` 和 POST `/update`，strict 完整 JSON、32768 B、no-store、完整微秒 CAS／先 CAS 后 no-op、五秒事务和仅键名审计。管理要求当前有效非 builtin 账号、builtin admin 组及 `admin:access`＋`system:manage`，不新增权限。输入／冲突900224／900225，目标拒绝仍200121，基础非法目标保留原码。

独立中英卡片位于旧 general form 外，说明三允许并集、只启用 CIDR 的影响、拒绝优先、两族 `/0` 和只约束今后目标；旧 DNS 允许卡片同步说明。0–100 行，保存以服务端 canonical 为准。关闭保留配置；冲突／unknown 保稿并阻写，只有当前身份和编辑 revision 接受的显式重载成功解除。切号、同号重登、撤权、卸载和所有迟到 success/error/finally 隔离；不改变全局通知系统。

迁移 `00047_target_cidr_allowlist.sql` 默认关闭，Down 只卸本迁移审计定义，保留内容／精确版本／历史，重 Up 不覆盖；旧应用忽略新允许约束，回退不是安全等价。SQLC1.30.0 标准入口连续两次核全输入／输出零漂移。依赖不变，产品版本在前端阶段更新0.71.0。

## 验证与交付

真实缺端点、手插允许资源后原错误放行和 DNS 允许下 IP 错误拒绝先 RED→GREEN；具名解析／strict／七存储坏值／权限／CAS／gate／审计回滚／七协议／回执／旧访问／迁移往返验证。完整本地 Go／业务100／vet、固定 Linux race／vet、前端四100／types／lint／build和准确新产品 smoke／所选扫描／中英桌面手机浏览器及必要原图；准确输入未变才复用，不借旧产品或 CI。

四标准任务、唯一 fresh 最强全分支独立终审、最新 head 真实 CodeRabbit、全部有效问题处置、正常 guarded squash、独立 API／一次 fetch／SHA／tree／唯一父及 whole-owned 恢复归档完成才交付。不查或等 CI，不碰 PR240／266／267、18080、日常数据库，不发布部署，不暂停或删除自动化。

活动4GiB、双根12GiB、Docker可回收6GiB；大操作串行先预算，用完及时准确清容器／卷／网络／镜像／cache／副本，保留原日志和失败及恢复映射，不全局 prune。见[设计](../specs/2026-11-14-v0.71.0-target-cidr-allowlist-design.md)、[计划](../implementation/v0.71.0-plan.md)、[任务](../implementation/v0.71.0-tasks.md)和[验收](../implementation/v0.71.0-acceptance.md)。
