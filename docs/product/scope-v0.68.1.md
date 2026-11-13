# v0.68.1 策略保存确认维护

状态：PR328 已完整交付：最终4a327bcdafd3041a3a200ecc349c35375a663e21真实CodeRabbit kind reviewed/source=covered、check131749300085 success，正常squash master `ea56c08d6c3e3f2f4bd5bd4c59ca3119ca2b0915`；独立API／fetch核相同tree和唯一父8457e362，三个标准任务及10份文件可恢复归档完成。17条完整Ruling、原失败和三组Minor保留原报告；15项量词及设计页状态在本次文档维护收口，原手机toast由v0.68.2另行验证，不冒PR328已修。

## 盘点与选择

| 能力／问题 | 当前状态 | 本版选择与风险 |
| --- | --- | --- |
| 后缀允许 unknown 屏障 | v0.68.0 已验证交付 | 复用行为，只修无关权限保稿；不重复旧修复 |
| 旧精确允许／精确拒绝／后缀拒绝的未知结果 | 仍显示可重试失败 | 纳入：保稿、持续提示、阻写、接受显式重载；前端风险中 |
| 四张卡片无关权限变化清稿／自动读取 | PR327 CR-M1 有效 Minor、原版明确接受 | 纳入：仅所需权限状态触发退休；身份竞态风险中 |
| PR327 CR-M2 十三处量词简写 | 原版延期 | 随状态文档更新收口；八处误报不改 |
| 手机 toast 暂遮标题 | 原 Minor 延期 | 不纳入，独立共享布局增量 |
| DNS 查询、SSRF、公共后缀表、信誉、媒体与模板 | 未纳入前版 | 非目标，不混入维护 |

## 必须实现

三张旧卡片只把本资源明确输入拒绝视为可修正重试：精确允许900212、精确拒绝900210、后缀拒绝900216。冲突900213／900211／900217保持原阻写和显式重载。transport、HTTP500、无效 envelope／成功 data 及其他不明确结果均 saveUnknown，保留草稿和持久双语提示，禁止重复 POST；失败或被新编辑淘汰的 reload 不能解除屏障。当前身份／编辑 revision 接受显式成功 reload 后才恢复。

四张卡片仅以 admin:access／system:manage 的存在状态和身份 scope 判定退休；无关权限新增／移除不清稿、不清 unknown／conflict、不自动 GET、不退休合法 pending。必需权限撤销／恢复、切号、同号重登录和卸载仍清私有数据并拒迟到续体。

后缀拒绝保持内部 row.host／wire suffixes，允许卡片保持 enabled，完整 CAS、100项上限、独立资源和后端权限不变。不增加后端、API、migration、权限目录或依赖。产品改0.68.1，其余依赖 metadata逐字相同。

## 验证与交付

三张卡片 unknown 和四张卡片无关权限保稿分别真实 RED→GREEN，完整前端四项100%／types／lint／build，严格 E2E types／lint。准确 clean新web配原核验Go程序的smoke／所选扫描与真实提交后丢响应的中英×桌面／390px浏览器，必要当前原图由ROOT检查。原后端输入逐hash／bytes相同才复用，旧355项浏览器保持原产品执行身份。

唯一全新独立终审、最终head真实CodeRabbit、有效问题处置、正常exact-head squash、独立API／fetch／SHA／tree／唯一父、三个标准done与whole-owned恢复归档后才交付。活动4GiB／双根12GiB／Docker可回收6GiB，先预算、串行生成和准确清理。无全局prune、不删branch／worktree／automation，不查或等CI、不碰PR240／266／267／18080／日常DB、不发布部署。

见[设计](../specs/2026-11-13-v0.68.1-policy-save-confirmation-design.md)、[计划](../implementation/v0.68.1-plan.md)、[任务](../implementation/v0.68.1-tasks.md)、[验收](../implementation/v0.68.1-acceptance.md)。
