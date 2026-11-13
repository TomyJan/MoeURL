# 开发进度与能力清单

## 当前维护（2026-11-13，v0.68.2）

v0.67.2／PR325已完整交付，master `5734f46d76f6e12d33998f7d4d6040d34c92c44c`；三个标准任务、最终f380b195真实CodeRabbit、正常合并独立核验和11份文件恢复归档完成。21条裁决、4项延期文案Minor及原时钟／Goose准备失败保留完整报告；实际净清2706657683B，原测试与扫描保持准确执行归属，不冒CI或发布结果。

[前端传递依赖安全维护](scope-v0.67.3.md)已完整交付为 PR326，正常 squash master `fe36797f3133fe963a14e05bf320c230c7f2708c`，独立 API／fetch 已核相同 tree 和唯一父。两个标准任务、唯一独立终审、最终 b69a3774 真实 CodeRabbit 和全部有效意见处置完成。完整 220 个文件／5080 项、四项 100% 及 types／lint／build 保持原实际执行身份，其他 1211 项输入准确复用。全部 19 条裁决、一组延期 Minor 及失败保留完整报告，9 份 owned 文件恢复 ZIP 已全解压逐 hash，准确 leaf 可恢复迁出。

[v0.68.0 后缀白名单](scope-v0.68.0.md)已通过 PR327 完整交付：最终4e763872真实CodeRabbit、四个标准任务、正常squash master `8457e3627690b31847095e8253acd0660c389c1a`、独立API／fetch相同tree与唯一父，以及12份文件的可恢复归档完成。32条裁决、原失败、原toast和新CR-M1／CR-M2延期均完整保留；原后端4586项、当前前端5191项／四项100%、原产品355项与修复产品9项浏览器保持各自执行身份，不冒新产品完整重跑。

[v0.68.1 策略保存确认维护](scope-v0.68.1.md)已通过 PR328 完整交付，master `ea56c08d6c3e3f2f4bd5bd4c59ca3119ca2b0915`；最终4a327bc真实CodeRabbit、三个标准任务、正常合并独立核验及10份文件恢复归档完成。17条裁决及原失败／三组Minor完整保留，5273项前端与成功唯一17浏览器保持原执行归属，不冒单轮全绿。

当前 [v0.68.2 窄屏页面通知布局维护](scope-v0.68.2.md)已完成旧产品中英390px真实几何RED与最小共享修复；完整前端223文件5273项、四项覆盖率100%、类型／规范／构建通过。准确clean09ca新web配原Go5216f6d的产品smoke／所选扫描通过，28项浏览器单轮全过（新标题10项＋旧反馈17项＋setup），ROOT查看10张当前原图；恢复包全解压逐hash后已清用完副本、image与7条专用cache。Task1标准完成，Task2本地证据已核准、标准收尾中；最终审查、合并及owned归档尚未完成，不查CI、不发布部署。

## 当前维护验证（2026-11-13，v0.67.2）

v0.67.1／PR324 已完整交付，master `1989e85d99ce2cdbb4ad32c4916be5316f7ea3db`；三个标准任务、最终 `90ac276d` 真实 CodeRabbit、正常合并独立核验及 11 份文件恢复归档均完成。20 条裁决、16 条文案误报和两组延期 Minor 保留原报告，原测试保持执行身份。

当前 [Go 安全补丁维护](scope-v0.67.2.md)的 Task1 已标准完成；主机 Go1.26.11 完整4534项／业务100／vet、新Go源扫描及Linux Go1.27.4组合race／vet已验证，原时钟回退失败及既有测试两处时间数据修复分别留证。Task2准确121dfeb产品的两个程序均新Go1.27.4编译，原Goose62项依赖不变；smoke、三个目标所选HIGH／CRITICAL扫描及9项浏览器通过，四张新警示原图已查看。完整前端5080项／四100按全部输入相同复用，产品副本和镜像已可恢复清理，标准封存及真实审查交付继续。产品仍为0.67.0，最低语言、生产源码、模块和前端不变，详见[验收](../implementation/v0.67.2-acceptance.md)。不查CI、不发布部署；下方原检查点保持归属。

## 当前维护（2026-11-13，v0.67.1）

[目标 DNS 后缀黑名单](scope-v0.67.0.md)已通过 PR323 完整交付，master `7a4c22073c9790c9f0cdc541db3344d57c2966ca`。最终 `80e1379` 自身真实 CodeRabbit、四个标准任务、正常合并独立核验及包含13个文件的可恢复归档完成；28条裁决和五组延期Minor保留原报告。当前工具链完整5080项前端／四项100%、准确新web54a5b6ba＋原Go7b57957组合产品与347／347单次浏览器、20张当前原图分别取证；原345／2＋补3／3及22张历史组合图不重归属。条件源码风险及未装Go补丁保持，不查CI、未发布部署。

当前[后缀提示与验证维护](scope-v0.67.1.md)已完成宽规则双语警示、合法存储下精确取消断言及19项文案维护。完整前端220份文件／5080项、四项100%、types／lint／build及受影响Go包coverage／Linux race／vet通过，组合业务覆盖率100%。准确b16cc1b新web配原Go产品的smoke、所选HIGH／CRITICAL扫描、八后缀场景加setup共9项通过，四张警示原图已实际查看。已清545683581B私有编译缓存，产品副本扣除恢复ZIP再净清180561699B，用完产品镜像和测试容器／卷／网络已清理。自身独立审查、最终head真实CodeRabbit、正常合并及整版归档仍待；产品保持0.67.0，详见[验收](../implementation/v0.67.1-acceptance.md)。下方历史检查点保持原归属。

## 当前维护（2026-11-12，v0.65.1）

PR317／v0.65.0 已完整交付为 master `a716d42474994f7ba6e9deac37371396adff4852`：四标准任务、最终 `1ac35816` 的真实 CodeRabbit、有效意见处置、正常合并独立 API／fetch／tree／唯一父和 13 成员可恢复归档均已核准。28 条完整裁决及原 Ruling25 的 Minor 延期保留原版归属；4932 项前端、335 个组合浏览器身份及条件安全风险保持各自执行身份，不冒单次全套绿或全部级别无漏洞。

当前[用量浏览器身份补测](scope-v0.65.1.md)仅补一份 E2E 及状态文档，产品保持 0.65.0。原 goto 流程由 window 标记证明会重启 JS；改为真实 UI 退出／登录 B，同 window 截留 A=1 的响应，B=0 后放行仍为 0。唯一独立终审指出 route.fulfill 返回不代表浏览器请求终结；原 29.6s 及 fulfilled 附件只保留调用返回归属。已按准确 Request 的成功／失败事件、响应完成和浏览器渲染边界修复，真实取消诊断 RED→GREEN，中英×桌面／390px 四场景加 setup 全部通过（31.1s），strict E2E types／lint 通过。真实 CodeRabbit、正常合并及归档尚待。原卡片在路由离开时会卸载，不将此冒作同一存活 composable 验证；原同实例 epoch 单元证据保持。未改生产／API／权限／DB／依赖，不查 CI、不发布部署。下方原历史检查点保持。

## 当前维护（2026-11-12，v0.64.1）

PR315／v0.64.0 已完整交付为 master `57b6c96b16405a6e1e91b0df53ffc9000eb1bb72`，四标准任务、最终 d8864ac 的真实 CodeRabbit、正常合并独立 API／fetch／tree／唯一父和 13 份恢复成员已核准；27 条裁决及 4 项 Minor 在原版完整延期，原 Go／组合覆盖率与 327 身份浏览器保持执行归属，不称最终输入单次全套。当前[配额保存结果核对维护](scope-v0.64.1.md)已实现：结果未知先保草稿并阻写、成功显式重载后恢复；真实 RED 后针对性 71 项通过，完整前端 4866 项／四项 100%、types／lint／0.64.1 build 和 Go context 包级补验通过，前版文档已收口。准确提交前端与原后端的组合产品 smoke、所选 HIGH／CRITICAL 扫描已通过；受影响浏览器首次 34 通过／4 定位失败，补跑 5 项通过，去重核准 38 个身份，8 张新原图已检查并可恢复清理用完副本。Task1 标准完成，Task2 本地合同已封存，审查交付尚待。不改 API／DB／权限／计量，不新增依赖、不查 CI、不发布部署。下方为历史交付前检查点，以本段和对应验收为最新状态。

## 当前实施（2026-11-12，v0.64.0）

PR314／v0.63.1 已完整交付为 master `b98bd1cbdbecaed7f30fd91bab7b5324d4463801`，原证据保持归属。当前[账号每日创建配额](scope-v0.64.0.md)后端与前端已实现，产品版本 0.64.0。Task1–3 标准完成，真实事务／并发／迁移、完整 Go／组合业务 100／vet／Linux race 已验证；前端 4857 项／四项 100%、types／lint／构建通过。准确产品 smoke／所选扫描、327 身份组合浏览器及 26 张原图已核；Task4 审查交付仍待，见[验收](../implementation/v0.64.0-acceptance.md)。不借前版结果，不查 CI、不发布部署。下方是原历史检查点。

## 当前维护（2026-11-12，v0.63.1）

[v0.63.0 可选目标主机白名单](scope-v0.63.0.md)已通过 PR313 完整交付为 master `864a79d04567463130c51d4cdc822cbe04c2e3e2`。四个标准任务、32 条完整裁决、最终候选 c626414 的真实 CodeRabbit、独立合并核验及 13 份文件的可恢复归档均完成。默认关闭，黑名单优先，旧访问不变。最终完整前端 4759 项／四项 100%；旧产品完整浏览器 319／319 与最终产品 7／7、30 张最终原图及条件安全公告均保留准确归属，见[验收](../implementation/v0.63.0-acceptance.md)。当前 [v0.63.1](scope-v0.63.1.md)仅补一份页面测试和状态文档：保存回读与二次完整版本的测试质量 RED→GREEN、相关 97 项及 types／lint 已通过，标准收尾和自身审查交付尚待；产品保持 0.63.0，未发布部署。下方保持各版原检查点。

## 当前维护（2026-11-12，v0.62.1）

v0.62.0／[PR311](https://github.com/TomyJan/MoeURL/pull/311) 已完整交付，最终候选 `00422ad` 真实 CodeRabbit，master `8a9bc9ec6fe770a759e388031fc8988d80fc157c` 独立核验完成；三个标准任务、16 条裁决与 11 份文件恢复归档均已核准。4652 项／四 100、types／lint／build、准确产品 smoke／选定 HIGH+CRITICAL 扫描 0 保持原执行归属。完整浏览器首次 311／313，修复后全部受影响 29 个场景加 setup 通过，去重覆盖 313 个身份，不称单次全绿；16 张原图、手机 direct 八个场景首次补验及滚动边界保留。当前[交付状态文档维护](scope-v0.62.1.md)产品保持 0.62.0，本维护审查交付尚待。下方为历史检查点。

## 当前维护（2026-11-12，v0.61.3）

v0.61.2／[PR309](https://github.com/TomyJan/MoeURL/pull/309) 已完整交付，master `d2346123a8eddcf8b667ed351a997ef77ec372a6`，22 条裁决及两项延期 Minor 保留原报告。当前[手机编辑器回归补测](scope-v0.61.3.md)已补 group 四边裁剪与 direct 取消后重开 UI 的证明，本地静态与 9 项浏览器验证通过，审查交付仍待；产品保持 0.61.1。下方为历史检查点。

## 当前维护（2026-11-12，v0.61.2）

[PR308](https://github.com/TomyJan/MoeURL/pull/308) 已完成真实审查、正常合并核验、两个标准任务和十份文件恢复归档，master 为 `0012441aff26519ec7f98bdbfff1c9708c3a3fc3`。当前[临时容量检查维护](scope-v0.61.2.md)已实现并通过本地验证，审查与交付仍待完成，产品保持 0.61.1，不重复已完成门禁；下方为历史检查点。

## 当前维护（2026-11-11，v0.61.1）

v0.61.0／PR307 已完整交付，正常 squash master 为 `99a1d62b5e1380c26448c5b0fef893eb24d796db`。最终 `bb38548` 真实 CodeRabbit、有效问题处置、独立合并核验、三个标准任务及可恢复归档完成；54 条裁决保留历史重复编号的勘误。原本地验证和扫描限制保持各自执行身份，不冒主分支重跑或正式发布。

当前 [v0.61.1 手机访问配置布局](scope-v0.61.1.md) 已完成最小手机换行修复和正式旧产品四项裁剪 RED→准确新产品 GREEN。完整 4583 项前端测试／四项 100%、types／lint／构建、27 项受影响浏览器分区及八张原图、产品 smoke／选定 HIGH／CRITICAL 扫描通过；320×568 的键盘保存和取消已核。后端完整输入与二进制不变，复用原执行证据，保留原限制。标准任务收尾、唯一独立终审、最终 head 真实 CodeRabbit、合并及归档仍待，见[验收](../implementation/v0.61.1-acceptance.md)。单版本 4 GiB／临时合计 12 GiB；本版已精确清理用完的打包副本和旧实验快照，保留恢复映射。不查 CI，不发布部署。

## v0.61.0 交付前检查点（原文保留）

前版 v0.60.1／PR306 已完整交付，正常 squash master 为 `1cad579cabcd6253095eff5556adafc636662b88`；最终 `f0de7f3` 真实 CodeRabbit、独立合并核验、两个标准任务、21 条裁决和九份文件的可恢复归档均完成。产品保持 0.60.0，原执行证据不借给后继。

当前实施 [v0.61.0 目标主机精确黑名单](scope-v0.61.0.md)：独立管理员资源、七协议新目标检查、完整 CAS、键名审计与真实事务测试已实现。最新后端修复的 Windows Go 1.26.10 完整回归／vet／业务 100% 通过。固定镜像 Linux Go 1.27.3 的完整 race 执行返回 1：18 包成功、2 包无测试，仅 shortlink 两项出现连接／锁观测超时；同源码、同镜像定向重测这两项通过，不称一次完整执行全绿。源扫描保留条件告警。前端独立卡片／身份草稿及专用反馈已实现，修复后完整 4583 项测试／四项 100%、types／lint／0.61.0 构建通过；浏览器按原产品 294 项与准确修复产品的受影响成功分区去重覆盖 297 个身份，20 张原图已核。唯一独立审查的问题已修复验证，最终 CodeRabbit、合并及归档尚待，见[本版验收](../implementation/v0.61.0-acceptance.md)。不加依赖，不查或等待 CI，不发布部署。

下方均为各版原检查点，最新状态以上述当前入口和对应验收为准。

## 当前维护（2026-11-11，v0.60.1）

[v0.60.0／PR305](../implementation/v0.60.0-acceptance.md) 已完整交付，master 为 `96cab18f60ba8e2537fd81f4bd74ed79ada38985`。三个标准任务、42 条裁决及 11 份文件的可恢复归档均完成，未正式发布。

审查与执行分开记录：原独立审查范围 `a371588..b427d157`，不覆盖后继依赖集成与 E2E 同步；最终 `337c1ef` 的真实覆盖来自 CodeRabbit。准确产品归 `b07f20df`，新依赖完整浏览器原 289 项通过／1 项失败，受影响 7 项补验通过，去重 290 个成功身份，非单次完整全绿；ROOT 核 24 份选定原图。旧后端门禁、40 项／84 张图和条件性源扫描保持原执行身份，二维码定位因果仍是诊断假设。

当前 [v0.60.1 文档维护](scope-v0.60.1.md) 只修 CR-M4 的摘要范围与实际交付记录，产品保持 0.60.0，Task1 已标准完成，Task2 审查交付中；本维护自己的审查、合并及归档尚未完成。CR-M2 锁表风险和 CR-M3 可选行文仍延期。不改产品或重复成功门禁，不查 CI，不安装、不发布部署。

## v0.60.0 交付前检查点（原文保留）

[v0.59.1／PR304](../implementation/v0.59.1-acceptance.md) 已完整交付，master 为 `a371588c8c2a43ebeedab1e8d9b7a4064891e0c6`。最新提交完成真实 CodeRabbit 审查、正常合并及独立核验；两个标准任务、28 条裁决和九个文件的可恢复归档均已完成。一项文档措辞 Minor 在原 PR 明确延期；原产品和测试结果保持各自执行身份。

当前实施 [v0.60.0 可搜索账号显示时区](scope-v0.60.0.md)：Task1–2 标准完成，419 项可搜索目录、CAS 与身份隔离已实现，唯一独立终审完成。正常合入外部 Vuetify4.3.2／Vite8.3.6／Vue Query5.107.1 更新后，新完整4433项前端测试、四100、types／lint／构建通过；准确产品完整浏览器289通过／1项焦点同步失败，修测试后完整受影响7项通过，去重290个成功身份，非单次全绿。ROOT核24份选定原图，smoke／产品扫描通过；旧后端门禁、40项／84图及源扫描提示保持原执行身份。最新提交真实 CodeRabbit、正常合并及归档仍待。不查 CI；已有依赖按锁隔离更新，新增依赖须审慎，不发布部署。

## v0.58.0 历史检查点

v0.57.0／PR300 已完整交付，master `97fa899c477e1918898ec7e3f0c182272d6c5ea4`；最终 4ad 真实 CodeRabbit、有效意见公开处置、正常合并独立核验、标准 Task1–3、15 条裁决和 11 文件可恢复归档完成。原准确产品／271 项浏览器／19 张原图保持执行身份；量词行文 CR-M1 在原版延期，下方旧进度按历史归属保留。

当前推进 [v0.58.0 二维码纠错等级](scope-v0.58.0.md)：M／Q／H 本地选择，默认 M，PNG 和 SVG 同轮等级与颜色一致。15 项真实行为 RED→GREEN、原 29 项回归及最终代码 3973 项／四项 100%、types／lint 通过；准确产品 smoke／扫描、275 身份组合覆盖、全部 12 个当前 QR 场景和 31 张原图核准。375×667 额外补验证明正常滚动可达，唯一独立终审为 0 Critical／Important／Minor。候选提交时标准 Task2 收尾、最终 head 真实 CodeRabbit、合并和可恢复归档尚待，后续实际完成以本版外置交付报告为准，详见[本版验收](../implementation/v0.58.0-acceptance.md)；不查询或冒称 CI，不发布部署。

## 当前进展（2026-11-10）

[v0.53.2](scope-v0.53.2.md) 已通过 [PR289](https://github.com/TomyJan/MoeURL/pull/289) 完整交付，master `ef47a7ba33cc405b96c3058d5183b26d849b7571`。3732 项前端／四 100%、types／lint／build、唯一独立终审、最新 head 真实 CodeRabbit、正常合并独立核验、标准任务及可恢复归档完成。完整浏览器原 241 成功／4 项 fixture 失败，同产品补验四项及初始化 1 项通过，非单次 245 绿；12 张原图和 label 动画已核，旧超时根因未证明。

[v0.54.0](scope-v0.54.0.md) 已通过 [PR290](https://github.com/TomyJan/MoeURL/pull/290) 完整交付，master `13749bc82b04b55d8802f626c3857fb5103a6179`。最终 f4e9ee7 真实 CodeRabbit、有效意见处置、正常合并独立 API／fetch／tree／唯一父核验、标准 Task1–4、20 条裁决和 13 文件可恢复归档均完成。完整 3813 项前端／四 100%、准确产品 251 个唯一浏览器场景的分区组合及 75 张原图保留原执行身份；最终测试小修有独立输入证明和定向验证，不冒新产品执行。

[v0.54.1 测试隔离维护](scope-v0.54.1.md) 已通过 [PR291](https://github.com/TomyJan/MoeURL/pull/291) 完整交付，master `f1431100332587058e8e6f248a4d2cdaa8830185`。精确 c7cbfbd1 真实 CodeRabbit、正常合并独立 API／fetch／tree／唯一父核验、标准 Task1–2、11 条完整裁决及 9 文件可恢复归档完成；产品仍为 0.54.0，未改产品、依赖或迁移，原本地执行保持准确身份。

[v0.55.0 CSV 标题与标签导入](scope-v0.55.0.md) 已通过 [PR292](https://github.com/TomyJan/MoeURL/pull/292) 完整交付，master `4b6f24bf7ff6d8b1f5d69f57b01871c76ece32b7`。准确转移、标准 Task1–4、0.55.0 产品／完整 257 项浏览器／52 张原图及唯一独立终审完成；最终 8d8e059 真实 CodeRabbit、正常合并独立 API／fetch／tree／唯一父、34 条裁决及 13 文件可恢复归档已核准。原执行身份不变，两项 Minor 原版明确延期，不冒原 PR 已修；不查或冒称 GitHub CI，未发布部署。

[v0.55.1 CSV 字节边界测试维护](scope-v0.55.1.md) 已通过 [PR293](https://github.com/TomyJan/MoeURL/pull/293) 完整交付，master `cc7d03760b1d7ca78943593fe754f68ad056fad5`。六项边界、3883 项／四 100%、五种有效故障变体及 66 项配置上下文保留原执行身份；最终 2800df63 真实 CodeRabbit、正常合并独立 API／fetch／tree／唯一父核验、标准 Task1–2、11 条完整裁决和 9 文件可恢复归档完成。CR-M1 旧验收开头状态句在原 PR 明确延期，本版接续修正，不倒填历史。

[v0.56.0 CSV 自定义短码导入](scope-v0.56.0.md) 已通过 [PR294](https://github.com/TomyJan/MoeURL/pull/294) 完整交付，master `35b5b2bd703a87492c1185061c81fa526cfe94f4`。标准 Task1–4、最终 5fba3ff 真实 CodeRabbit、有效意见处置、正常合并独立 API／fetch／tree／唯一父核验、24 条裁决及 13 文件可恢复归档均完成；完整 263 项浏览器与 66 张原图保留准确运行身份，两项提示及两处技术摘要 Minor 在原 PR 明确延期。本版接续维护，不倒填原 PR。

[v0.56.1 四列 CSV 提示维护](scope-v0.56.1.md) 已通过 [PR298](https://github.com/TomyJan/MoeURL/pull/298) 完整交付，master `735cd182a62cb680cf60d3ea62792c94a7c58717`。标准 Task1–3、最终 fcd114b 真实 CodeRabbit、有效意见公开处置、正常合并独立 API／fetch／tree／唯一父、13 条完整裁决及 11 文件可恢复归档均完成。原 267 项完整浏览器及手机补验 3 项保持准确执行身份；M1 上传等待测试风险在原 PR 明确延期，本维护接续，不倒填已修。

[v0.56.2 CSV 上传等待维护](scope-v0.56.2.md) 已通过 [PR299](https://github.com/TomyJan/MoeURL/pull/299) 完整交付，master `8ee773125b0e0af27b875b081c05416ca9d3b6da`。两个标准任务、最终 9fa 真实 CodeRabbit、有效意见公开处置、正常合并独立 API／fetch／tree／唯一父、10 条完整裁决及 10 文件可恢复归档均完成；产品仍 0.56.1，原验证保持执行身份。旧验收清单 Minor 在原 PR 明确延期，不冒已修。

当前实施 [v0.57.0 二维码 SVG 下载](scope-v0.57.0.md)：沿现有三色／白底／M 纠错／四模块静区，增加本地矢量下载并保留 PNG。独立准备 3958 项前端／四 100、types／lint 及新旧 E2E 检查通过；正式 `b3a10959…` 的准确 0.57.0 产品已完成 271 项浏览器、21 个 SVG 下载、20 组模块合同、smoke 和扫描，ROOT 已逐张检查 19 张原图，唯一独立终审无问题。Task1 已标准完成，Task2 执行与终审完成、标准关闭继续核验；最终 head 真实 CodeRabbit、正常合并与恢复归档仍待完成。不查 CI，不发布部署。

v0.52.1 已通过 [PR281](https://github.com/TomyJan/MoeURL/pull/281) 完整交付，master `82355d63e2b7111912ac2d5eb6b067a3e1c14b5a`。最新 ca1 真实 CodeRabbit 覆盖、有效问题闭环、正常合并独立 API／fetch／SHA／tree／唯一父核验、标准 Task1–3 及 20 条裁决／11 文件可恢复归档完成。完整 3642 项前端／四项 100%、228 项浏览器和 28 张原图保持原执行身份，后继测试增量另有验证，见[验收](../implementation/v0.52.1-acceptance.md)。不等待或冒称 GitHub CI，未发布部署。

[v0.52.0 批量追加内部备注](scope-v0.52.0.md)已由[PR280](https://github.com/TomyJan/MoeURL/pull/280)正常合并为 master `22373699819e3f2514d023bb6f257fd703404e04`。最新e35真实CodeRabbit覆盖、有效工具提示处置、独立API/fetch/tree/唯一父、标准Task1–4及26条裁决／13文件whole-owned可恢复归档均完成。原3637项前端／四100、完整224项浏览器／16张原图及产品证据保持准确执行归属，两Minor在原版延期，本维护接续处理；见[验收](../implementation/v0.52.0-acceptance.md)。不等待或冒称CI，未发布部署。

Go 压缩依赖安全维护已通过 [PR279](https://github.com/TomyJan/MoeURL/pull/279) 完整交付，master `636cefd6f4b38cec884f6658807044279728c0c3`；准确本地验证、最新0ef695b真实CodeRabbit覆盖、正常合并及独立API/fetch/tree/唯一父、三个标准任务和18条裁决／10文件可恢复归档均完成，见[维护验收](../implementation/2026-11-09-go-compression-security-acceptance.md)。保留原执行身份、required-only与仅回退第35项的迁移边界；不等待或伪称GitHub CI，未发布部署。完整raw为本机私有原件，新克隆不含原件。

v0.51.1 已由 [PR278](https://github.com/TomyJan/MoeURL/pull/278) 正常合并为 ca0b12a26ba90c442ccb18f8d20c59a96aa69860；3509 项前端／四 100%、220 项标准浏览器及准确产品验证、最终85b真实CodeRabbit覆盖、有效问题处置、三个标准任务、46 条裁决和可恢复归档均完成，见[前版验收](../implementation/v0.51.1-acceptance.md)。原两项文档 Minor 在本次维护落实访问边界和明确状态，不倒填为原 PR 修复。v0.51.0 合并事实、旧 CI 失败及原件缺失／归档缺口仍保留。不等待或伪称 CI 通过，未发布部署，下方旧阶段保持历史归属。

## 当前进展（2026-11-05）

v0.49.2 已通过 [PR268](https://github.com/TomyJan/MoeURL/pull/268) 完整交付，master `8d72dda0696d139194ebea6aaeb24605abbe8607`；最新真实审查覆盖、候选41890239146和master41894181402各九CI／完整日志、标准Task1–3、17条裁决及可恢复归档全部完成。未发布部署，详见[前版验收](../implementation/v0.49.2-acceptance.md)。

v0.49.3 已通过 [PR269](https://github.com/TomyJan/MoeURL/pull/269) 完整交付，master `4b5d4dc4db6d14a430cdc3cdf7238f3d9516da77`。最新真实审查、候选41919580747与master41924031590各九CI及完整日志、标准Task1–3、23条裁决报告和可恢复归档全部完成；未发布部署，见[验收](../implementation/v0.49.3-acceptance.md)。

v0.50.0 已通过 [PR270](https://github.com/TomyJan/MoeURL/pull/270) 完整交付，master `7ede77d48ff086209fd6d043a77000105d7c4870`。最新真实审查覆盖、[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41943898011)与 [master 自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41947207982)及完整日志、标准 Task1–4、22 条裁决与可恢复归档全部完成；未发布部署。首轮旧域名场景 211/212 失败根因未确认的限制保持原归属，见[验收](../implementation/v0.50.0-acceptance.md)。

v0.50.1 已通过 [PR271](https://github.com/TomyJan/MoeURL/pull/271) 完整交付，master `9bcf97bfafe3fd5e1747f692dea8ce2decbb6f53`；最新真实审查、[候选九项 CI](https://github.com/TomyJan/MoeURL/actions/runs/41956791078)和 [master 自身九项 CI](https://github.com/TomyJan/MoeURL/actions/runs/41959310355)及完整日志、三个标准任务、21 条裁决与可恢复归档均完成，未发布部署，见[验收](../implementation/v0.50.1-acceptance.md)。旧单元超时与前版浏览器失败根因未确认。

当前推进 [v0.51.0 当前选择标签重命名](scope-v0.51.0.md)：Task1–2 已标准完成。唯一终审 Important 已经真实目录 RED→GREEN 修复，3501 项前端测试、四项 100%、types／lint／双构建通过。修复候选 f32a81b 的完整 216 项浏览器、73 张相关原图和精确产品验证均通过；保存进度反馈一项 Minor 延期。13 条裁决与完整报告已整理，本地归档／标准收尾及远端交付仍待，见[验收](../implementation/v0.51.0-acceptance.md)和[计划](../implementation/v0.51.0-plan.md)。下方旧阶段按历史归属保留。

## 当前状态（2026-11-04）

v0.48.0 已通过 [PR262](https://github.com/TomyJan/MoeURL/pull/262) 完整交付，master `6aa7c0aa5a805446fae16e7d8453388763081f23`；最新真实审查、候选／master 各九 CI 与完整日志、标准 Task1–3、19 条裁决和可恢复归档均完成。每页 20／50／100，保持权限、私密筛选和全匹配 CSV；未发布部署，见[验收](../implementation/v0.48.0-acceptance.md)。

v0.49.0 已通过 [PR264](https://github.com/TomyJan/MoeURL/pull/264) 完整交付，master `bbdc95e6cce206f217666723a22375f967643d6f`；最终候选真实审查覆盖、候选和 master 各自九 CI／完整日志、标准 Task1–4、28 条裁决报告与可恢复归档均完成，未发布或部署。原运行时与失败保持归属，见[验收](../implementation/v0.49.0-acceptance.md)。

v0.49.1 已通过 [PR265](https://github.com/TomyJan/MoeURL/pull/265) 完整交付，master `81591816c6cde10c78a9f386fcec1ffc8513bc70`；候选最新真实审查覆盖、候选和 master 各九 CI／完整日志、标准 Task1–3、22 条完整裁决及可恢复归档均完成。F1 空 wrapper 间距、M5／M9 和页面鼠标入口边界按原范围保留，未发布部署。见[验收](../implementation/v0.49.1-acceptance.md)。

当前推进 [v0.49.2 空通知区域间距](scope-v0.49.2.md)：额外 14／16 px 间距已真实 RED→GREEN，3253 项前端、203 项完整浏览器／73 张原图和精确产品验证通过；唯一独立终审无 Critical／Important。Task1 标准完成，Task2 本地收尾中；候选真实审查、候选／master 各九 CI、守卫合并和最终归档仍待，见[计划](../implementation/v0.49.2-plan.md)和[验收](../implementation/v0.49.2-acceptance.md)。

[前端 glob 安全维护](../implementation/2026-11-04-frontend-glob-security-plan.md)已通过 [PR263](https://github.com/TomyJan/MoeURL/pull/263) 完整交付，保持 0.48.0 行为和版本号。最终候选与 master 各自九 CI 成功，最新真实审查覆盖和有效问题闭环、守卫合并、标准 Task1–3、28 条裁决完整报告及可恢复归档均已完成，见[验收](../implementation/2026-11-04-frontend-glob-security-acceptance.md)。

v0.47.0 已经 [PR261](https://github.com/TomyJan/MoeURL/pull/261) 完整交付，master `5ed2939c6de3f75e3cb46dac37fcb6ffa06ad74f`；最新真实审查、候选／master 各九 CI 与完整日志、标准 Task1–3、24 条完整裁决和可恢复归档均完成。保持不变集合的确定排序，不承诺跨请求快照；未发布部署，详见[验收](../implementation/v0.47.0-acceptance.md)。

PR260 文档维护已完整交付，master `47e170b455e6b2a8d02d89bcbdaef15a63b06df3`，真实覆盖、候选和 master 各九 CI、完整日志、标准 Task1–3 及可恢复归档均完成；未发布部署。下方旧阶段按原时点保留。

[v0.46.0 备注关键词筛选](scope-v0.46.0.md)已完整交付：[PR259](https://github.com/TomyJan/MoeURL/pull/259) 合并为 `f3beb002ca88c7f2e4e2398ef22edf1cc9eae267`。最终候选 `fedb65a` 已真实审查、有效问题闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41697764468) 与 [master 自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41701602969) 均成功，完整日志分别核至 EOF。标准 Task1–4、25 条裁决报告及可恢复归档完成，未正式发布或部署；详见[验收](../implementation/v0.46.0-acceptance.md)。

## 历史阶段摘要（v0.46.0 交付前，原文保留）

当前实施 [v0.46.0 备注关键词筛选](scope-v0.46.0.md)：私密只读 POST 与现有筛选取交集；唯一独立终审的两项私密词问题已修复，3097 项前端四 100%、183 项完整浏览器、38 张原图及精确产品验证通过。候选真实审查、候选／master 各九 CI、守卫合并与最终归档仍待；见[计划](../implementation/v0.46.0-plan.md)与[验收](../implementation/v0.46.0-acceptance.md)。

v0.45.0 已通过 [PR258](https://github.com/TomyJan/MoeURL/pull/258) 完整交付，master `51003145`；最新真实审查、候选／master 各九 CI、标准任务及可恢复归档完成，未发布部署。下方原阶段记录保留历史归属，最终证据见[验收](../implementation/v0.45.0-acceptance.md)。

[能力文档维护](../implementation/2026-11-03-capability-status-acceptance.md)已完整交付：PR256 合并为 `254fef0f`，最新真实审查、候选和 master 各自九 CI、标准 Task1–3 与可恢复归档完成，未发布部署。两个文档 Minor 继续保留。

当前推进 [v0.45.0 短链列表分页](scope-v0.45.0.md)：本人／全站固定每页 20 条、前后翻页、单页选择及实时操作守卫已实现，CSV 仍导出全部已应用筛选。唯一独立终审两项修复经真实 RED→GREEN，最终 3011 项前端四项 100%、types／lint／build、标准浏览器 181 项、34 张相关原图与精确产品验证通过；标准收尾及候选真实审查、候选／master 九 CI、守卫合并和最终归档继续，见[计划](../implementation/v0.45.0-plan.md)与[验收](../implementation/v0.45.0-acceptance.md)。

[v0.44.0 备注状态筛选](scope-v0.44.0.md)已完整交付：[PR257](https://github.com/TomyJan/MoeURL/pull/257)合并为 `e0072c2`，最新真实审查、候选与 master 各九 CI、标准 Task1–4、完整 37 条裁决及可恢复归档均完成。177 项浏览器、2963 项前端四项 100% 及精确产品验证保持实际运行归属，未发布部署；见[验收](../implementation/v0.44.0-acceptance.md)。下方旧阶段保持历史归属。

[v0.43.1 备注版本边界](scope-v0.43.1.md)已完整交付：[PR255](https://github.com/TomyJan/MoeURL/pull/255)合并为 `10d317e`，候选与 master 各自九项 CI、真实最新审查、标准任务及可恢复归档均完成，尚未发布或部署，详见[验收](../implementation/v0.43.1-acceptance.md)。

当前进行[能力文档维护](../implementation/2026-11-03-capability-status-plan.md)：对齐已经交付的页脚链接、时区显示、批量／CSV 创建、只读标签查找和内部备注，不增加产品行为。各版本原始失败、执行身份与未完成的生产验收保留原记录；本维护轮的审查和 CI 独立验收。

## 历史阶段摘要（原文保留）

当前 [v0.43.1 备注版本边界](scope-v0.43.1.md)已实现，真实 HTTP／客户端回归及完整本地门禁通过，前端 2940 项与四项 100% 覆盖率通过；clean61e938d 的完整 173 项浏览器、18 张原图及精确产品检查通过，Task1 标准完成；唯一独立终审无发现；本地归档与 Task2 标准完成，Task3 已启动，远端交付尚待，见[验收](../implementation/v0.43.1-acceptance.md)。不改数据库、权限、依赖或其他资源解析器。

v0.43.0 已完整交付：[PR254](https://github.com/TomyJan/MoeURL/pull/254)最终候选 fbe0fae 真实审查及有效问题闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41562059864)与合并 master646656 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41567605713)均通过，完整原日志分别核至 EOF。标准 Task1–4、25 条完整裁决报告及全 owned ZIP／解压核验、准确 leaf 可恢复迁出完成。M2 已解决，最终仅延期 M1，本补丁接续处理；未发布部署，见[验收](../implementation/v0.43.0-acceptance.md)。下方旧阶段叙述保留历史归属。

当前 [v0.43.0 短链内部备注](scope-v0.43.0.md)后端、前端、完整 171 项浏览器及精确产品验证通过，16 张原图已逐张检查。唯一独立终审无阻断问题，两项 Minor 延后；远端审查、CI、合并与 master 验证尚待；旧 metadata／公开访问／CSV 不增加备注，阶段见[验收](../implementation/v0.43.0-acceptance.md)。

v0.42.0 已完整交付：[PR253](https://github.com/TomyJan/MoeURL/pull/253)最终候选2eab6cd真实审查和有效意见闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41528785613)与合并master a680b224的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41533004155)均成功，完整原日志分别核至 EOF。标准 Task1–4、25条完整裁决报告、新 whole-owned ZIP／解压全集核与准确leaf可恢复迁出完成，无延期Minor。未发布部署，见[验收](../implementation/v0.42.0-acceptance.md)。下方旧阶段叙述保持历史归属。

v0.41.0／[PR249](https://github.com/TomyJan/MoeURL/pull/249)已完整交付：最终候选6829ba3真实审查和有效意见闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41496993103)与合并master9a71bea的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41505792542)均成功，完整日志分别核至 EOF；标准 Task1–4、32 条完整裁决、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出完成，无延期 Minor。未发布部署；见[验收](../implementation/v0.41.0-acceptance.md)。下方旧阶段文字保留历史归属，不代表当前仍待交付。

v0.40.1／[PR248](https://github.com/TomyJan/MoeURL/pull/248)已完整交付：最终候选 c43e600 的真实审查／有效问题闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41423729705)与合并 master 00c893ff 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41430855520)均成功，完整日志核至 EOF。标准 Task1–4、全部 20 条裁决、whole-owned ZIP／解压全集核和准确 leaf 可恢复迁出完成，无延期 Minor；未发布部署。详见[验收](../implementation/v0.40.1-acceptance.md)。下方旧开发阶段叙述保留历史归属。

当前 [v0.40.1 CSV 格式帮助与模板](scope-v0.40.1.md)已实现可折叠中英示例和固定公开模板下载。真实页面行为 RED→GREEN，78 项边界补验、完整 2690 项前端测试／四项 100%、types／lint／隔离 build 通过；下载不改草稿或文件读取，不改解析器、API、数据库、权限或依赖。clean9b14027的完整159项浏览器、精确产品及正常数据库更新的所选HIGH／CRITICAL扫描通过，原图已逐张阅读；唯一终审bc53c75无代码阻断，Task3文档与归档收尾后进入远端交付。候选自身审查／九CI、master及最终归档仍待，见[验收](../implementation/v0.40.1-acceptance.md)。

v0.40.0 已完整交付：[PR247](https://github.com/TomyJan/MoeURL/pull/247) 最新候选 `e2fee88036ab9637c455bbdccc56d1d3c00bfee5` 的真实审查与全部有效意见闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41401442214) 和合并 master `b4879c0ffd1e7a2048a68479d3fd487227f0926d` 的[自身九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41408228013) 均成功，完整日志分别核至 EOF。标准 Task1–4、全部 26 条裁决报告、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出完成，格式示例 M1 当时延期；未发布部署。见[验收](../implementation/v0.40.0-acceptance.md)，下方旧阶段文字保留历史归属。

v0.39.0 已完整交付：[PR246](https://github.com/TomyJan/MoeURL/pull/246) 最终候选 `647b013fa1b04f4eb874ceb32d8df97f375c072e` 的真实审查与全部有效意见闭环；[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41367196539) 和合并 master `7bf680b3a487e2ad364589b79d325de15cb9e1bd` 的[九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41371662994) 均成功。master 原 8 项成功，运行器失联的 E2E 单独恢复后 149 项通过；完整成功日志为保留原件的可重建组合，内容核验至 EOF，未冒九项重跑。标准 Task1–4、30 条完整裁决报告、新 whole-owned ZIP／解压全集核与准确 leaf 可恢复迁出均完成，未发布或部署。下方旧阶段保留历史归属。

v0.38.0 已完成交付：[PR245](https://github.com/TomyJan/MoeURL/pull/245) 最终候选 b2d19823c70a59d479bbc8d452f97c174c32bb1d 的真实审查／有效意见已闭环，[候选九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41340395109) 与合并 master07d4f6c3af23c4f50cd94021d2af13fe0a889c87 的[九 CI](https://github.com/TomyJan/MoeURL/actions/runs/41344911045) 均成功，完整日志分别核读至 EOF。标准 Task1–4、完整 41 条裁决报告与 whole-owned ZIP／解压全集核、准确 leaf 可恢复迁出完成；未发布或部署。下方旧阶段保留历史归属。

2026-11-01 最新：v0.37.0／PR244 已完成 guarded squash（master617c12cc8cb07c2ea3173b8d0cc65239aec4f49c），候选与 master 各九 CI、真实审查、标准任务、36 条裁决／4 项延期 Minor 和可恢复归档均已闭环，未发布部署。当前 [v0.38.0 有界批量创建](scope-v0.38.0.md)Task1 已在 a5bd50a 标准完成，后端真实 RED→GREEN、PG 并发／回滚／撤权、业务 100%、Linux race／scanner 及 SQLC 零漂移保持原执行归属；前端完整 2534 测试、四项 100%、types／lint／隔离 build 通过。Task2 已在 2b2ee2a 标准完成，Task3 已标准启动；手机提示已真实 RED→GREEN，clean bfb9828 的完整 144 项浏览器、八张原图实读和标准产品／精确镜像扫描通过，唯一终审、本地归档与远端交付仍待。见[计划](../implementation/v0.38.0-plan.md)与[验收](../implementation/v0.38.0-acceptance.md)。下方旧摘要为历史。

2026-11-01 05:35 UTC 最新交付：v0.36.0／PR243 已 guarded squash 为 master 5dc1c8aa34bbc9ba66576efd1ec41d1ce2025e43；候选 run41274108148 与 master 自身 run41275576405 各九 SUCCESS、完整原始日志 ROOT 已读到 EOF，真实 CodeRabbit 覆盖最终 2403a0d，effective open0。标准 Task1–4、37 条完整裁决／三项延期 Minor 与 16 文件 whole-owned ZIP／解压／准确 leaf 可恢复迁出均完成。首次 Task4 校验器历史文档混比失败和正确归属恢复保留原件；无产品重跑。未发布部署。下一 [v0.37.0 精确记录时间](scope-v0.37.0.md)已完成两表详情和手机提示的本地实现及定向验证，整版交付仍待，见[计划](../implementation/v0.37.0-plan.md)和[验收](../implementation/v0.37.0-acceptance.md)。以下旧阶段摘要均为各自历史，不表示 v0.36.0 仍在等待交付。

2026-11-01 当前摘要：[v0.36.0 账号时区显示预设](scope-v0.36.0.md)按正式[实施计划](../implementation/v0.36.0-plan.md)实施：Task1–2 已分别标准完成（90674e6／070627a），完整前端 2443 测试及四项 100%、后端业务 100% 已通过。Task3 在 clean 544a0706 上完整 128 项浏览器通过，5 张原图已实读；标准产品 smoke 与同一精确镜像的正常漏洞库更新扫描通过，两次下载失败与官方镜像恢复分别保留。唯一终审已完成（Critical 0／Important 1／Minor 1），认证暂时失败后时区编辑器无法恢复的问题已真实 RED→GREEN；修复后完整 2449 项前端测试、四项 100%、types／lint／build 已通过。修复候选 b5a3dcea 的新完整 128 项浏览器（10.8 分钟）、5 张原图实读及标准产品／精确镜像扫描已通过；原重连超时失败及不变输入诊断分别留证，不称已证明其根因。本地归档／标准收尾与远端交付仍待；独立本人偏好／CAS、九固定 IANA 与身份轮次隔离，只改显示，不改 UTC 统计、CSV、到期输入或公开访问，无新依赖或权限。v0.35.0／PR239 已完成交付；其后 PR242 有界测试回滚维护已合并为 08b990d70bf30dbe54f885d0b7a3bc9490eacb89，真实审查、候选及 master 各九 CI、标准任务与可恢复归档均完成，未正式发布。下方带时间的旧待做叙述均保留其历史归属，不表示当前仍未交付，也不借旧证据给本版。

2026-10-30 19:06 UTC 文档状态同步（远端状态只据 2026-10-30 18:13:09 UTC 只读快照，非本次实时查询）：Task1–3 已标准完成，Task4 进行中且仅步骤 1 已完成。既有 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 已推送候选 `c44d23c0c7fe9ff41c52c19bd92dbe3c45636b08`；其自身 [CI run41097109781](https://github.com/TomyJan/MoeURL/actions/runs/41097109781) 九项 SUCCESS，完整 7331 行原始日志现已 ROOT 连续读至 EOF。真实 CodeRabbit review5716229915 的 kind=reviewed、sourceCommitId=coveredCommitId=该候选完整 SHA，review 与 overview 已全文读回；快照 effective open 为 0，但两条新增 outside 文档 Minor 仍须本次字段／状态同步及一次公开处置闭环，不与原五类延期 Minor 混合。本次文档后继的自身 CI、完整原始日志与真实 exact-head 审查仍待，不借 c44 证据；尚未合并、未完成 master 自身 CI／标准 Task4／最终归档清理，未 tag／release／deploy。以下旧阶段与失败记录均为历史，保留实际提交、输入、运行时和证据归属。

历史记录（原文保留）：2026-10-30 12:07 UTC 标准状态：Task1–3 均已实际标准完成，Task3 范围 d7e071f..1e177c5 的 evidence-only gate actual 0；完整 owned 15 文件／933437 bytes 已 ZIP／extract 全集合核（ZIP 313107 bytes），原 12 文件／845867 bytes dispatch 与合同、失败原件保持冻结，live leaf 保留。Task4 已从 1e177c5 标准启动，当前仅准备远端交付；尚无 push／PR／候选 CI／远端审查／merge／master CI／最终档案清理／tag／release／deploy。下方 11:50 的浏览器与精确产品成功仍只归 clean 6e3cd9b，不借给后继文档 SHA，不重复成功 suite、生成器、产品或原图。

2026-10-30 11:50 UTC 当前本地结论：clean 6e3cd9ba7c5df30656af864c132d99f0870966af 的完整浏览器 actual 0／125 passed（12.0m），标准 18178 smoke、精确 image binary／static V0.35.0-6e3cd9b 与完整 sourceURL、同 image Trivy 0.74 正常 DB 下载及 HIGH／CRITICAL（ignore-unfixed=false）三目标均实际通过。完整 777 非 Markdown／769 runtime 路径与 hash／bytes 稳定，准确 owned 资源已收尾；唯一终审 Important 已真实修复并完成受影响门禁，五类旧 Minor 继续延期。Task1–2 标准完成，Task3 仅余本地档案和标准完成，Task4 全部远端待做，无 push／PR／merge／tag／release／deploy。下文带时间的旧 pending／失败为原执行历史，不代当前结论，也不把本地门禁冒候选或 master CI。

2026-10-30 11:11 UTC 最新：clean bc60c4e 的完整 125 项 actual 1，122 passed／3 failed；三个页脚场景、通知回归及 v0.26 双视口均通过，失败为旧 v0.28 双视口通知按钮 detach 与 v0.29 桌面实际未提交目标域名。真实 trace 已逐项核，不据此认定后端或页脚回归。仅两旧 E2E 复用已验证通知 helper／同步真实 pointer 选择并断言实际值后，初始化及两场景双视口共 5 项 actual 0（2.5m），当前隔离 types／lint actual 0；777／769 完整输入稳定、准确 owned 三空。门禁仍归 bc60c4e 加当时两测试 dirty，产品运行时未变；新 clean 完整门禁及精确产品仍待。Task3 in_progress／Task4 pending，无 push／PR／merge；旧执行保持原归属。

2026-10-30 后继浏览器读回：clean 10e0e7a 的通知集成定向 7 项通过；其唯一完整 125 项 actual 1，124 passed／1 failed，三个新页脚场景及旧 v0.29 双视口均通过。失败是旧 v0.26 手机场景未提交预期系统选择，真实 trace 的 POST 仍为 Personal，服务端正确返回 300104，不据此认定页脚或持久化回归。仅同步旧测试的真实 pointer 选择并加精确冲突 payload 断言后，初始化与双视口共 3 项 actual 0，当前隔离 types／lint actual 0；产品运行时不改。新 clean 完整门禁及精确产品仍待，Task3 in_progress／Task4 pending，无 push／PR／merge。下文旧执行保持原提交与环境归属。

历史候选快照（632c619，原文保留）：[v0.35.0 有界页脚链接](scope-v0.35.0.md) 已实现后端、独立管理 editor、公开导航及身份竞态边界，Task1–3 标准完成，Task4 进行中。[PR #239](https://github.com/TomyJan/MoeURL/pull/239) 候选 632c619 的 [CI](https://github.com/TomyJan/MoeURL/actions/runs/41054453846) 有 Test／Test Coverage／E2E 三项失败：目标 Node 26.13.0 接受两个无效 ASCII ACE 主机，旧 v0.29 双视口等待 selected option 自动获焦未完成。正在窄修并补齐受影响门禁，当前不可合并；旧本地完整浏览器和产品成功仍只归各自原输入。真实审查已覆盖 632c619，但仍有一个未闭环线程；修复后候选及 master 的完整 CI、标准 Task4 和最终归档仍待，未正式发布。见[计划](../implementation/v0.35.0-plan.md)、[任务](../implementation/v0.35.0-tasks.md)与[验收](../implementation/v0.35.0-acceptance.md)；带时间的旧阶段记录保持原归属。

2026-10-30 09:26 UTC 最新：唯一 fresh 整分支终审已完成（Critical 0／Important 1／新 Minor 0）。ROOT 真实共享语料与已登录 App/session/PG 复现普通 ASCII 双连字符主机前后端分歧；仅 Go 改为逐 ACE 标签 IDNA 校验，92 项同源语料、真实保存和原 API／HTTP 协议已局部 GREEN。原 clean afed568 的 121 项浏览器和精确产品／扫描仍仅属历史，不借给新运行时；当前完整 Go、vet、canonical 业务 100% 与 checker 10 项均 actual 0，隔离 types／lint 已通过；完整 775 非 Markdown 输入逐项稳定，Linux 完整 race／scanner 也已 actual 0；scanner called 0／imported 0／required 3，不冒零公告，新 clean 浏览器及精确产品仍待。Task1–2 标准完成、Task3 in_progress／Task4 pending，原五类 Minor 延期，无 push／PR／merge。

[v0.34.0 站点强调色预设](scope-v0.34.0.md) 已由 [PR #237](https://github.com/TomyJan/MoeURL/pull/237) 于 2026-10-29T21:10:29Z 合并为 fc88c0e8b9192174e62b225fdc3cb0b87a253451。最终候选 99ebef5 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40949991695) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40955501280) 各九项成功，真实审查覆盖最终候选、全部有效意见闭环；标准 Task1–4、完整最终归档与准确 owned leaf 可恢复清理完成，未正式发布。固定 iris／ocean／forest 三预设、独立 CAS 与仅键名审计保持既有主题模式、个人偏好和公开访问；任意颜色编辑仍未开放；本次维护不改依赖、权限或 schema。原失败、逐候选运行时和当时延期三项 Minor 见[验收](../implementation/v0.34.0-acceptance.md)。当前[独立验证与文档维护](../implementation/2026-10-30-site-accent-closeout-plan.md)不新增业务版本；补验 Task1 已标准完成，维护自己的终审及 PR／CI／合并仍待做。

[v0.33.1 首页文案反馈补丁](scope-v0.33.1.md) 已由 [PR #232](https://github.com/TomyJan/MoeURL/pull/232) 合并为 `cf5d5a647febf6d7c5ee306605432066ca5bd2e8`。最终候选 `91cf9d5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40885738492) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40892523382) 各九成功，真实最新审查覆盖、全部有效意见闭环；标准 Task1–3、完整最终归档与准确 leaf 可恢复清理完成。原本地执行 SHA、失败与证明边界见[验收](../implementation/v0.33.1-acceptance.md)；未正式发布，不替代当前[文档维护轮](../implementation/2026-10-29-delivery-status-plan.md)自己的交付验证。

[v0.33.0 首页文案](scope-v0.33.0.md) 已由 [PR #231](https://github.com/TomyJan/MoeURL/pull/231) 合并为 `811d6c57`，最终 `34a520b` 的 PR CI40852026042 与合并 master CI40858639758 各九成功，真实最新审查／有效意见闭环、标准 Task1–4、完整最终归档与准确 leaf 可恢复清理完成。三个 Minor 在该版延期，所有原始失败、执行 SHA、完整输入与运行时保持[验收](../implementation/v0.33.0-acceptance.md)归属；未正式发布。

[v0.32.0 二维码外观预设](scope-v0.32.0.md) 已由 [PR #230](https://github.com/TomyJan/MoeURL/pull/230) 合并为 `99f87709`；最终候选 `28214ef` 的 PR CI40816638924 与合并 master CI40821882951 各九成功，真实最新审查／有效意见闭环，标准 Task1–4 与最终完整 SDD 归档均完成。三个本地深色／白底 PNG 预设，不持久化；原单元及各候选4／110浏览器、七原图和产品制品保持[验收](../implementation/v0.32.0-acceptance.md)归属，未正式发布。

[v0.31.0 OIDC 创建模板](scope-v0.31.0.md) 已由 [PR #229](https://github.com/TomyJan/MoeURL/pull/229) 合并为 `c6712051`，最终 `e9c3025` 的 PR CI40741884841 与合并 master CI40748005532 各九成功，真实最终审查／有效意见闭环，标准 Task1–4 与完整最终归档均完成。仅 Google／手动草稿，不放宽 verified-email；原单元及各候选制品保持[验收](../implementation/v0.31.0-acceptance.md)归属，未正式发布。

v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](../implementation/v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

2026-10-28：[v0.29.0 每域名默认跳转方式](scope-v0.29.0.md) 已由 [PR #227](https://github.com/TomyJan/MoeURL/pull/227) 合并为 `8af05d60fb89769f7aaabf4da4906ed411fdad48`。最终 `4dfa4d43` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40629796924) 与合并 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40631422772) 各九成功，真实 CodeRabbit 覆盖最终、有效 open0。配置仅用于创建初选、明确手动优先，旧省略模式与已有短链不变；唯一独立终审、root 修复与原失败均保持[验收](../implementation/v0.29.0-acceptance.md)归属，尚未正式发布。

此前功能 [v0.25.0 操作审计 CSV](scope-v0.25.0.md) 由 PR #222 合并为 `6933f94c`，其合并 CI #40406334592 的手机 E2E 失败保持历史归属。后继[维护 PR #223](https://github.com/TomyJan/MoeURL/pull/223) 清理 4 条开发依赖公告并修复 Toast 同步，已合并为 `cafacf1520e4ea59934af4c1339a56224c2fdcd0`；精确最终 `a9a53b98` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40415038034) 和新合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40421454231) 各 9 成功，实际 CodeRabbit 首审与最终增量覆盖最新变更，无有效未解决问题。远端恢复与逐候选证据见[维护验收](../implementation/2026-10-27-frontend-security-dependencies-acceptance.md)，不改写旧失败；正式发布未执行。

v0.26.0 个人偏好已由 PR #224 合并，v0.27.0 域名排序已由 PR #225 合并，各自证据见[个人默认验收](../implementation/v0.26.0-acceptance.md)和[排序验收](../implementation/v0.27.0-acceptance.md)。[v0.28.0 用户组默认](scope-v0.28.0.md) 已由 [PR #226](https://github.com/TomyJan/MoeURL/pull/226) 于 2026-10-27T21:21:01Z 合并为 `b1b1e4112ba92708becf59c875cff8bff109c3ec`，最终候选 `028008114edda315cfaef0f2effbc0c6c127ae7c` 的 [PR CI #40575287235](https://github.com/TomyJan/MoeURL/actions/runs/40575287235) 与合并 [master CI #40586040807](https://github.com/TomyJan/MoeURL/actions/runs/40586040807) 各九成功，实际 CodeRabbit 覆盖最终且有效 open0。原阶段与失败保持[验收](../implementation/v0.28.0-acceptance.md)归属；以上均未正式发布。

更新日期：2026-10-27。历史远端文档基线 `722b2ce03ee79c05b55737e16eaab2d83c36372b` 基于代码 `c4928a85`，包含 PR #198 合并的 [v0.17.0 短链批量管理](scope-v0.17.0.md) 及当时的依赖和 Go 证书安全修复。该文档基线的 [Check Code](https://github.com/TomyJan/MoeURL/actions/runs/39775160522) 全部 9 项通过，不替代后续代码候选的结果。v0.18.0 已通过 PR #208 合并为 `0f01a2e5`，其原分支本地证据不替代合并提交 CI 或发布。`33f287ec`、`1c6df4a` 等历史证据单独保留，不改写为新提交结果。真实生产演练与正式发布尚未完成。本页是进度入口，版本边界由 scope 和 spec 定义，指定提交及环境的实际验证由对应 acceptance 记录。

## 状态口径

- **已实现**：当前代码已有可用业务闭环，不代表已经正式发布。
- **部分实现**：基础能力可用，表中列出的扩展尚未实现。
- **待开发**：属于原有产品规划或远期方向，尚无对应完整闭环，不自动纳入下一版本。
- **待验证**：代码或脚本已有，但缺少指定提交、运行时或目标环境的执行证据；不与待开发功能混算。

## 已实现与部分实现

| 模块 | 当前可用能力 | 尚未实现的扩展 | 范围与规格 |
| --- | --- | --- | --- |
| 初始化与本地认证 | 首次初始化站点和管理员；禁止重复初始化；Cookie Session、登录退出、账号状态检查和登录失败限流；证明当前密码后自助改密、全部旧会话撤销及重新登录。 | 不提供自助注册、找回密码或纯 OIDC 账号设置本地密码流程。 | [用户与认证](../specs/users-and-auth.md)、[个人改密范围](scope-v0.13.0.md)、[生产就绪范围](scope-v0.6.0.md) |
| 用户与个人设置 | 管理员用户维护、个人昵称、账号语言／主题偏好；v0.36.0 独立时区显示已交付，支持跟随设备或九个固定 IANA 预设，仅改变显示。v0.19.0 单账号及 v0.30.0 最多 100 个账号的 user／admin 成员迁移已合并，含冲突保护、旧会话撤销和事务审计。 | 头像、任意时区目录、其他个人偏好、自定义组和多用户组；尚未正式发布。 | [个人设置](scope-v0.1.2.md)、[账号偏好](scope-v0.15.0.md)、[时区显示](scope-v0.36.0.md)、[单账号迁移](scope-v0.19.0.md)、[批量迁移](scope-v0.30.0.md)、[管理后台](../specs/admin.md) |
| 用户组与权限 | 内置 guest、user、admin；动态权限解析；user／admin 权限编辑；三个预设、管理权限保护及乐观并发。guest 保持只读空权限。 | 自定义用户组、组织空间、访客资源归属与访客创建开放。 | [用户组范围](scope-v0.5.0.md)、[权限](../specs/permissions.md) |
| 短链基础管理 | 随机及权限控制的自定义短码，全局唯一且不可复用；个人／全站列表、筛选、启停、目标编辑和软删除。v0.45.0 固定每页 20 条、前后翻页及单页选择已交付，v0.48.0 已通过 PR262 交付每页 20／50／100 条、默认 20；CSV 仍导出全部匹配。最多 100 条原子启停／软删、单条／批量转移、最多 1000 条／8 MiB 清单 CSV；v0.38.0 最多 20 条原子创建及 v0.40.0／0.40.1 单列 CSV 录入、帮助和模板已交付。 | 跨页全选、个人赠送、导出清单恢复、多列导入及旧短码／归属／历史恢复；尚未正式发布。 | [短链](../specs/short-links.md)、[自定义短码](scope-v0.12.0.md)、[批量管理](scope-v0.17.0.md)、[归属转移](scope-v0.20.0.md)、[清单导出](scope-v0.21.0.md)、[批量转移](scope-v0.22.0.md)、[批量创建](scope-v0.38.0.md)、[CSV 录入](scope-v0.40.0.md)、[格式帮助](scope-v0.40.1.md)、[分页](scope-v0.45.0.md)、[每页条数](scope-v0.48.0.md) |
| 访问模式与生命周期 | direct、intermediate、confirmation；中间页 3–10 秒倒计时；过期时间；浏览器生成二维码，v0.32.0 已合并三个本地固定外观预设；公开访问状态页。 | 模板选择和编辑、任意二维码样式编辑、目标可达性检测与自动审核。 | [访问体验范围](scope-v0.2.0.md)、[确认页范围](scope-v0.4.0.md)、[二维码预设](scope-v0.32.0.md) |
| 访问密码 | Argon2id 哈希、数据库一致失败限流、15 分钟访问授权；修改密码使旧授权失效。 | 本版闭环已实现，不提供独立授权管理 UI。 | [密码保护范围](scope-v0.3.0.md) |
| 最大访问次数 | 权限控制的可选限额；最终跳转原子领取；编辑保留用量、清除后重开周期；统一耗尽状态。 | 自动周期重置、独立清零、额度历史和告警。 | [最大访问次数范围](scope-v0.10.0.md) |
| 标题、标签与内部备注 | 标题／标签创建、编辑、清空、关键词搜索和精确筛选；v0.23.0 当前列表 1–100 条原子标签整理；v0.41.0／0.42.0 本人／全站只读标签查找已交付。v0.43.0／0.43.1 独立内部纯文本备注及严格版本边界已交付，备注随归属转移，不进入公开访问或 CSV。v0.44.0 有无备注、v0.46.0 最多 100 码点私密关键词与既有筛选取交集及全部匹配 CSV 已交付；字面子串按 PostgreSQL lower，不返回正文。 | 独立标签实体、空标签、重命名／合并、颜色层级、全文搜索、备注批量编辑／历史及 Open Graph；尚未正式发布。 | [元数据](scope-v0.11.0.md)、[批量标签](scope-v0.23.0.md)、[本人查找](scope-v0.41.0.md)、[全站查找](scope-v0.42.0.md)、[内部备注](scope-v0.43.0.md)、[版本边界](scope-v0.43.1.md)、[备注状态](scope-v0.44.0.md)、[私密关键词](scope-v0.46.0.md) |
| 概览与分析 | 已合并个人概览、最近短链、单链匿名聚合、最长 90 天 UTC 范围和聚合 CSV，以及管理员全站快照、趋势／热门、本人／管理单链匿名访问分页与浏览器／系统类别；旧空类别显示未知。v0.24.0 已合并单链完整筛选匿名记录 CSV，最多 1000 条／8 MiB，叠加独立权限。 | 尚未正式发布；超出 90 天或任意时区分析、全站访问合并导出及事件归档未实现。 | [个人概览](scope-v0.1.1.md)、[聚合导出](scope-v0.16.0.md)、[v0.24.0 范围](scope-v0.24.0.md)、[统计与事件](../specs/statistics-and-events.md) |
| 操作审计 | v0.18.0 已合并关键业务变更与日志同事务、真实 actor、白名单字段及只读筛选；180 天在线保留和有界清理，非空审计安全拒绝回滚。v0.25.0 已通过 PR #222 合并按日期／actor／resource／action 下载最多 1000 条／8 MiB 审计元数据 CSV。 | 尚未正式发布；合并后手机 E2E 修复跟进见验收。独立登录安全事件中心、外部 SIEM 与防篡改签名未实现。 | [v0.18.0 范围](scope-v0.18.0.md)、[v0.25.0 范围](scope-v0.25.0.md)、[设计](../specs/2026-10-27-v0.25.0-audit-export-design.md)、[验收](../implementation/v0.25.0-acceptance.md) |
| OIDC | 多 Provider 管理；标准 Discovery、Authorization Code、PKCE、state、nonce 及浏览器绑定；邮箱域名白名单首次供应；复用本地 Session 与权限。v0.31.0 已合并 Google／手动创建草稿模板。 | 自定义 Provider 模板、主动账号绑定、组映射、SAML、LDAP、SCIM 和 Passkey。 | [OIDC 范围](scope-v0.7.0.md)、[OIDC 设计](../specs/2026-09-11-v0.7.0-oidc-login-design.md)、[创建模板](scope-v0.31.0.md) |
| 多域名 | 管理、启停、组授权、全局默认及创建选择；访问限定所属启用域名；短链引用保护。v0.26 个人默认、v0.27 排序、v0.28 组默认及 v0.29 域名默认跳转方式均已合并，各自最终 PR／合并 CI 九成功及真实审查闭环。 | 尚未正式发布；用户自助绑定、自动 DNS/TLS、既有短链域名迁移未开发。 | [多域名范围](scope-v0.8.0.md)、[个人默认](scope-v0.26.0.md)、[排序](scope-v0.27.0.md)、[组默认](scope-v0.28.0.md)、[默认方式](scope-v0.29.0.md)、[域名](../specs/domains.md) |
| 系统设置与品牌 | 站点名称、默认语言／主题、纯文本页脚和安全的本地登录开关；首页文案、三个固定强调色及 v0.35.0 最多五项有序页脚链接已交付。强调色与个人深浅模式独立，链接保留旧文字及固定署名。 | Logo／Favicon 上传、任意主题色、HTML 页脚、部署参数在线修改；尚未正式发布。 | [系统设置](scope-v0.9.0.md)、[首页文案](scope-v0.33.0.md)、[反馈补丁](scope-v0.33.1.md)、[强调色](scope-v0.34.0.md)、[页脚链接](scope-v0.35.0.md) |
| 前端体验 | 中英双语、浅深色及跟随系统、响应式布局、PWA 基础；标准表格／列表／菜单、可堆叠 Toast、短链下的分析入口、长 URL 省略、减少动态效果支持。 | 更多语言、主题编辑器、自定义 CSS、跳转页模板编辑。 | [导航与页面](../specs/navigation-and-pages.md)、[主题与多语言](../specs/themes-and-i18n.md) |
| 部署与维护 | 单机 Compose、外部 TLS 代理示例、健康检查、请求防护、有界退出、分批清理、备份恢复及升级回退脚本与手册。 | 高可用、内置 TLS、完整监控追踪、事件归档；生产演练证据另列下节。 | [生产就绪范围](scope-v0.6.0.md)、[部署手册](../deployment/single-host-compose.md) |

上表的未实现扩展是能力边界，并非全部已排期。涉及账号安全、访客开放、统计明细或模板注入的扩展，须先定义安全与数据保留规则。当前统计不保存原始 IP、完整 User-Agent 或完整 Referer；不能为了详细统计直接放宽既有隐私边界。

## 最近完成的前端整理

本节记录前端整理阶段，其本身未新增业务版本；当前默认视觉为「鸢尾蓝 × 薄荷青」。

- 统一公共页面、控制台、表单和对话框；修复页脚占用布局外高度与概览翻译缺失。
- 初始化、登录等操作使用友好校验及可堆叠 Toast；持久加载错误保留页面内重试入口；初始化完成提供登录和首页入口，密码原值传递。
- 桌面端新建短链保留在侧栏上部；访问分析作为对应短链的二级页面，不再独立占用导航。
- 列表使用 Vuetify 标准表格、列表和菜单；长目标地址省略显示，窄屏在表格容器内滚动。
- `Powered by MoeURL` 固定展示，仅 `V` 开头的版本文字带源码链接。版本在构建时注入：精确 tag 链接到 tag，否则显示版本与短 commit hash 并链接到 commit。
- 加入克制动画及减少动态效果适配，统一浅深色、状态色和文字对比度。

设计与证据分别见 [界面更新验收](../implementation/2026-10-14-ui-refresh-acceptance.md)、[认证反馈验收](../implementation/2026-10-14-auth-feedback-acceptance.md)、[细节验收](../implementation/2026-10-14-ui-details-acceptance.md)、[标准列表验收](../implementation/2026-10-15-standard-lists-acceptance.md) 和 [配色验收](../implementation/2026-10-15-color-refresh-acceptance.md)。

## 验证进展与缺口

以下汇总各版本已有记录；v0.20.0 行单独记录本次实现工作树的新验证，不将历史提交的门禁改写为当前结果。

各版本未完成门禁均指对应候选及环境。v0.20.0 的远端状态于 2026-10-24 复核，其余远端记录保留原日期和候选；主分支、PR 与历史候选分别记录，历史成功不替代新提交。

| 证据范围 | 已记录结果 | 不能替代的验证 |
| --- | --- | --- |
| [v0.25.0 验收](../implementation/v0.25.0-acceptance.md) | PR #222 最终 `d250b4b` 的 CI #40404362865 全部 9 项成功：1704 前端／四项 100%、Go 业务 100%、95 完整 E2E 及安全／smoke。实际 CodeRabbit run `5500f594` 覆盖全部 50 文件和最终 head，无有效意见；已合并为 `6933f94c`。原逐候选本地证据和部分 RED 流程偏差继续保留。 | 旧合并 CI #40406334592 为 8 成功／E2E 失败；后继 PR #223 的新合并 `cafacf15` 在 #40421454231 实际 9 成功，手机失败已闭环。尚未正式发布，不改写旧失败。 |
| [v0.24.0 验收](../implementation/v0.24.0-acceptance.md) | [PR #219](https://github.com/TomyJan/MoeURL/pull/219) 最终 head `769a9d97` 的 [CI #40374212790](https://github.com/TomyJan/MoeURL/actions/runs/40374212790) 与合并提交 `5c3fee5c` 的 [CI #40384305979](https://github.com/TomyJan/MoeURL/actions/runs/40384305979)各 9 项成功，实际确认 1615 项前端、业务 100%、91 项完整 E2E。CodeRabbit 最终实际增量 `45bc6a0c` 无新增有效意见。 | 已合并，尚未正式发布；原逐候选本地证据和工作树生成物误定向继续保留，不替代 v0.25.0。 |
| [v0.23.0 验收](../implementation/v0.23.0-acceptance.md) | [PR #218](https://github.com/TomyJan/MoeURL/pull/218) 最终 head `635b53ae449c4f66ee6b26759fac619cbfccb8cb` 的 [CI #40300323879](https://github.com/TomyJan/MoeURL/actions/runs/40300323879) 和合并提交 `5f6702d9` 的 [CI #40306786126](https://github.com/TomyJan/MoeURL/actions/runs/40306786126) 各 9 项成功；最终 PR 原始日志核验 1518 项前端／四项 100%、Go 业务 100%、85 项完整 E2E。CodeRabbit run `085626ca-8590-4cb0-a30f-ca091e80c641` 实际完整复审 44 文件，无有效意见、docstring 100%。首轮并发观测失败和额度跳过仍保留历史归属。 | 已合并，尚未正式发布，真实生产验收待执行；不替代 v0.24.0 候选门禁。 |
| [v0.21.0 验收](../implementation/v0.21.0-acceptance.md) | 最终 head `1641e2a` 的[目标 CI](https://github.com/TomyJan/MoeURL/actions/runs/40132665857) 全部 9 项成功：1367 项前端、四项 100%、Go 业务 100%、77 项完整 Playwright 及安全／smoke 通过。PR #216 已合并为 `dfc9a5a1`，该实际合并提交的[独立 CI](https://github.com/TomyJan/MoeURL/actions/runs/40133310132) 也全部 9 项成功。原本地树 `36a9d5ed` 及首轮 `5e3d713d` 证据保持历史归属。 | CI 不冒充正式发布或生产验收；增量 CodeRabbit 因限额跳过，已修复其首轮两项意见并经独立定向复审。真实生产验收尚未完成。 |
| [v0.20.0 验收](../implementation/v0.20.0-acceptance.md) | 最终 PR 候选 `ba90f37e` 的 [Check Code #40031018213](https://github.com/TomyJan/MoeURL/actions/runs/40031018213) 全部 9 项成功，含完整测试／覆盖率、Linux race、安全扫描、构建、完整 E2E 与 Compose smoke。已通过 PR #214 合并为 `2d23dcfd`；各阶段本地、用户名兼容、布局及 CI 探测修复的证据保留在验收。 | PR CI 不替代后续提交或生产验收；尚未正式发布，真实 DNS/TLS、外部 OIDC、恢复及回退演练仍需目标环境证据。 |
| 历史主分支 `5a1d9761` | [Check Code #39830070001](https://github.com/TomyJan/MoeURL/actions/runs/39830070001) 8 项成功，`Backend Security` 的 `Race tests` 步骤失败，整体结论为 failure。 | 尚无该主分支提交完整 CI 通过的证据；历史 `c4928a85` 的成功及后续 PR 的成功均不改写此次失败。 |
| PR #211 远端 `b28ecf27` | [Check Code #39919076100](https://github.com/TomyJan/MoeURL/actions/runs/39919076100) 的普通 Go、后端覆盖率及 Backend Security 已通过；前端测试和前端覆盖率因旧 race 命令字符串断言失败，其余 7 个 job 成功。历史 `6ca648f4` 的 Docker 探测失败和 `44f187cf` 的 CI 成功仍保留原归属。 | 随后仅删除这条脆弱文本断言；修复后远端目标 CI 待验证。PR 已合并为 `c08b67b2`，尚未发布，不用历史成功覆盖当前失败或替代生产验收。 |
| [v0.19.0 本地验收](../implementation/v0.19.0-acceptance.md) | 原候选 `c9f5a0b5` 已通过全仓 Go／100% 业务覆盖率、SQLC 零漂移、vet、完整 Linux race、1276 项前端测试／四项 100%、70 项 E2E、production smoke 及精确镜像扫描。`b02f3366` 修复后本地 1279 项前端测试／四项 100%、lint／类型／构建及 3 项定向 Compose 浏览器验证通过。`b28ecf27` 的 CI 修复已补跑完整 Linux Go／race、100% 业务覆盖率、vet 与 actionlint，独立复审无新问题；本轮删除脆弱部署断言后，完整前端测试与覆盖率均 1279 项通过、四项 100%，lint／类型检查通过。 | 合并前维护轮次未重跑完整 Playwright、production smoke 或安全扫描；合并提交 `c08b67b2` 的目标 CI 本轮未获取。真实外部 OIDC、生产恢复／升级回退仍需目标环境证据。 |
| [v0.8.0 验收](../implementation/v0.8.0-acceptance.md) | 合并提交 `f818a7e8` 对应 CI、Linux race、安全扫描、Playwright 与 Compose smoke 通过。 | 该历史提交的结果不能替代当前 master；真实 DNS/TLS、隔离恢复和发布验收仍缺。 |
| [v0.9.0 验收](../implementation/v0.9.0-acceptance.md) | 系统设置功能及指定提交的 Go、前端、生成物和配置验证已有记录。 | 保留该版本验收中的未勾选项，不用后续 UI 测试回填。 |
| [v0.10.0 验收](../implementation/v0.10.0-acceptance.md)、[v0.11.0 验收](../implementation/v0.11.0-acceptance.md) | 后端、前端、SQLC、权限 fixture 及本地数据库浏览器流程已有分阶段证据。 | 完整容器、当前提交的目标 CI／Linux race／安全扫描及生产升级恢复证据待补。 |
| [标准列表验收](../implementation/2026-10-15-standard-lists-acceptance.md) | 基线 `9dbca832` 后的工作树：919 项前端测试、四项覆盖率 100%、静态检查和构建；隔离数据库完整 E2E 42 项通过、1 项跳过。 | 跳过的是 Docker 双 Host 场景；本地结果不等同目标 CI 或外部真实 OIDC。 |
| [配色验收](../implementation/2026-10-15-color-refresh-acceptance.md) | 基线 `fafa6231` 后的工作树：919 项前端测试、四项覆盖率 100%、lint、类型检查与构建；16 项界面 E2E、88 组只读页面检查。 | 本轮未重跑 Go、完整业务 E2E、Docker 或目标 CI；界面 E2E 拦截 API，不作为业务集成证据。 |
| [v0.13.0 验收](../implementation/v0.13.0-acceptance.md) | 个人改密通过 PR #186 合并为 `a52733cc`。分支原始证据：Go 全仓与业务覆盖率 100%；1023 项前端测试、四项覆盖率 100%、静态检查与构建；代码候选 `77035e6` 全量 Playwright 47 项通过、1 项 Docker 场景跳过；独立审查完成，隔离资源已清理。 | 分支本地证据不能替代合并提交验证；PostgreSQL 16.3 本地回退不能替代 PostgreSQL 18、完整容器、目标 CI／Linux race／安全扫描或生产证据。 |
| [v0.14.0 验收](../implementation/v0.14.0-acceptance.md) | 已通过 PR #187 合并为 `c864ce3a`；原分支 Go 业务覆盖率 100%；1050 项前端测试、四项覆盖率 100%、静态检查与构建；代码候选 `2afdba14` 全量 Playwright 52 项通过、1 项 Docker 双 Host 跳过；隔离资源已清理，原始证据归档保留。 | 分支证据不能替代合并提交或发布验证；PostgreSQL 16.3／本机 Chrome 与 mock OIDC 不替代目标 CI、PostgreSQL 18、完整容器、Linux race、安全扫描或生产环境证据。 |
| [v0.15.0 验收](../implementation/v0.15.0-acceptance.md) | 已通过 PR #190 合并为 `2ec7eaa4`。原分支 Go 全仓包验证、业务覆盖率 100%；1098 项前端测试、四项覆盖率 100%、静态检查；代码候选 `14207888` 固定构建及完整 Playwright 55 项通过、1 项 Docker 双 Host 跳过；隔离资源已清理，证据已归档。 | 尚未正式发布；原分支分阶段本地门禁的提交和环境分别见验收，不能替代合并提交、目标 CI、PostgreSQL 18、完整容器、Linux race、安全扫描或生产环境证据。 |
| [v0.16.0 验收](../implementation/v0.16.0-acceptance.md) | 已通过 PR #191 合并为 `bd4c2625`。原分支 Go 全仓测试与业务覆盖率 100%，1154 项前端测试及四项覆盖率 100%；代码候选 `d3f9c68f` 完整 Playwright 59 项通过、1 项 Docker 双 Host 跳过；任务资源已清理，日常预览保留。 | 未正式发布；原分支证据不替代合并提交、目标 CI、PostgreSQL 18、Linux race、完整容器、安全扫描、外部互操作和生产验收。 |
| [v0.17.0 验收](../implementation/v0.17.0-acceptance.md) | 功能通过 PR #198 合并为 `3eda85de`。后续主分支 `c4928a85` 的 [Check Code #39772002003](https://github.com/TomyJan/MoeURL/actions/runs/39772002003) 全部 9 项成功，涵盖完整 Go／前端测试与覆盖率、静态检查、Linux race、govulncheck、SQLC 零漂移、容器构建／扫描、完整 E2E 及 PostgreSQL 18 Compose smoke。原分支分阶段本地结果与本次维护中的 1215 项前端测试／100% 覆盖率另行记录，不替代上述目标运行。 | 功能已合并且该提交目标 CI 通过，尚未正式发布；仍缺真实 DNS/TLS、外部 OIDC 互操作、备份恢复、升级回退及目标生产部署验收，不能用容器／mock 测试替代。 |

发布前仍须针对候选提交补齐：

- [x] 主分支 `c4928a85` 的 Go／前端门禁、Linux race、安全扫描和完整容器构建／Compose smoke，运行链接已记录；发布候选变化后需重新验证。
- [x] PR #211 的远端候选 `44f187cf` 完整目标 CI 9 项成功；该记录不替代主分支或后续文档提交的 CI。
- [x] PR #211 已合并为 `c08b67b2`；最终发布候选与对应验证仍待确认。
- [ ] 真实 DNS/TLS、Host 白名单和 SNI 校验；PostgreSQL 18.6 隔离容器环境的双 Host 浏览器场景已有本轮通过记录。
- [ ] 外部真实 OIDC Provider 互操作、代理回调及本地登录策略切换。
- [ ] 隔离备份恢复、OIDC 原始密钥恢复、升级失败回退和业务 readiness 演练。
- [ ] 目标部署发布验收；其他浏览器、实体移动设备及读屏验证按交付要求补齐。

## 后续开发方向

当前已交付的成员批量迁移见 [v0.30.0](scope-v0.30.0.md)，有界批量创建及单列 CSV 网址录入见 [v0.38.0](scope-v0.38.0.md)、[v0.40.0](scope-v0.40.0.md)和[格式帮助](scope-v0.40.1.md)。后续缺口是自定义组／多用户组、导出清单恢复、多列或历史导入、跨页全选及[路线图](roadmap.md)所列其他扩展；不要按下面旧阶段文字重复规划已完成能力。

## 历史规划与阶段证据（截至 v0.25.0 的原文）

本节保留当时的“后续”“尚未开发”和未重跑说明；只描述各自记录时点，当前状态以本页顶部、能力表和上节为准。

v0.25.0 操作审计 CSV 已通过 PR #222 合并为 `6933f94c`，最终 PR CI 9 项成功及实际审查完成；旧合并 CI 的手机 Toast 点击失败已由 PR #223 修复，新合并 `cafacf15` 的 CI #40421454231 实际 9 成功，尚未正式发布，详见[范围](scope-v0.25.0.md)和[验收](../implementation/v0.25.0-acceptance.md)。此前 v0.24.0 单链匿名记录 CSV 的 PR 与实际合并 CI 各 9 项成功保持历史归属；全站访问合并导出和审计归档仍未开发。

v0.23.0 批量标签整理已通过 PR #218 合并为 `5f6702d9`，最终 PR 与合并提交 CI 各 9 项成功，尚未正式发布，逐候选证据见[验收](../implementation/v0.23.0-acceptance.md)。v0.22.0 管理员批量短链归属转移已通过 PR #217 合并为 `ba2073cf`，修复候选与合并提交 CI 各 9 项成功，尚未正式发布：当前列表最多 100 条、完整精度版本、全量预检与整批原子审计，不改地址／配置／历史统计。详见[范围](scope-v0.22.0.md)、[设计](../specs/2026-10-25-v0.22.0-batch-ownership-design.md)和[验收](../implementation/v0.22.0-acceptance.md)。v0.21.0 清单导出已经通过 PR #216 合并，最终候选目标 CI 9 项成功，尚未正式发布。

v0.20.0 已通过 PR #214 合并为 `2d23dcfd`：管理员单条短链归属转移、当前授权与账号检查、完整精度版本、原地址和历史统计保留、旧所有者拒绝及事务审计。最终 PR CI 与各阶段本地证据分别见上表及 [验收](../implementation/v0.20.0-acceptance.md)，尚未正式发布。

v0.19.0 已实现管理员为其他非内置账号切换 user／admin，结合当前授权、完整精度并发检查、全部旧会话撤销和事务审计，已通过 PR #211 合并为 `c08b67b2`，尚未正式发布。自定义组、多用户组和批量迁移仍属于后续能力。设计与执行分别见 [规格](../specs/2026-10-23-v0.19.0-user-group-membership-design.md)、[计划](../implementation/v0.19.0-plan.md) 和 [验收](../implementation/v0.19.0-acceptance.md)。

原独立分支 `feat/v0.18.0-analytics-audit` 已通过 PR #208 合并并实现 [v0.18.0 范围](scope-v0.18.0.md) 定义的全站统计、匿名访问明细与事务审计。原分支最后实现候选为 `e476f87d`，包含权限集合审计修复，已通过修复后全仓 Go、100% 业务覆盖率和定向复审；原候选 `721206c` 的前端、浏览器与部署验证单独保留，不替代新候选尚未重跑的对应门禁，详见 [验收](../implementation/v0.18.0-acceptance.md)。功能已通过 PR #208 合并为 `0f01a2e5`，尚未正式发布。

[v0.16.0 聚合统计 CSV 导出](scope-v0.16.0.md) 和 [v0.17.0 短链批量管理](scope-v0.17.0.md) 均已合并，历史文档基线 `722b2ce0` 的目标 CI 已通过；当前主分支与 PR 结果见上表。后续扩展继续先设计查询权限、采集隐私与数据保留边界。单条归属转移与清单导出分别在 v0.20.0、v0.21.0 合并；批量转移在 v0.22.0 合并；v0.23.0 批量标签已合并、尚未正式发布，批量导入和跨页全选仍未开发。

原有规划尚未完成的产品能力集中列在 [路线图](roadmap.md) 的「待开发能力」中。[v0.12.0 自定义短码](scope-v0.12.0.md) 已通过 PR #185 合并为 `17e1f766`；阶段状态与证据见 [验收清单](../implementation/v0.12.0-acceptance.md)。[v0.13.0 个人密码修改](scope-v0.13.0.md) 已通过 PR #186 合并为 `a52733cc`。[v0.14.0 统计日期范围](scope-v0.14.0.md) 已通过 PR #187 合并为 `c864ce3a`，正式发布及目标环境缺口继续单独记录。

v0.12.0 的分支本地记录包含 Go 业务与前端覆盖率 100%、隔离数据库完整 Playwright 45 项通过、1 项 Docker 双 Host 跳过。该记录不替代合并提交的 CI 或生产证据。v0.13.0 的测试和审查分别记录于 [本版验收](../implementation/v0.13.0-acceptance.md)。

维护本页时同步更新总览和文档入口；新增功能先有 scope／spec，验证完成后将证据写入对应 acceptance，再更新本页摘要。功能完成、合并到主分支与正式发布分别记录。
