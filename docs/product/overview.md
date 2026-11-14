# MoeURL 产品总览

## 当前开发（2026-11-14，v0.75.0）

PR343／v0.74.1 已完整交付：最终 `2bf1e99b180120ce3805abadd3b09c62a641dd5a` 真实 CodeRabbit，正常合并 master `29a40395f53c85e2d1fa9768008929097ad41bc8`，独立核相同 tree 与唯一父。三个标准任务、15 条裁决、一组文案 Minor 及 10 份工作记录恢复归档完成；原 6029 项前端和 5 项浏览器保持原执行归属。

当前 [CSV 过期时间导入](scope-v0.75.0.md)处于设计阶段：固定第六列 UTC 秒或空值、独立严格协议、当前授权与原子回执；尚未实现和验证，不查 CI、不发布部署。实施见[计划](../implementation/v0.75.0-plan.md)。

## v0.74.1 交付前检查点（历史）

v0.74.0／PR342 已完整交付：最终候选 `0af8406496b85d82eca4fbb1e622e358ede50181` 真实 CodeRabbit，正常 squash master `b3de3637677653096451a708963e37decaf78c25`；独立 API／fetch 核相同 tree 和唯一父，四项标准任务、25 条裁决、五组延期 Minor 及 12 份工作记录恢复归档完成。

当前 [CSV 草稿与帮助维护](scope-v0.74.1.md)优先修复旧导入模式误清新手动草稿，统一双语帮助和状态文档。草稿和帮助已完成真实 RED→GREEN，完整 6029 项前端测试、四项覆盖率 100%、types／lint／build 及相关 E2E strict 已通过；准确产品 smoke、所选 HIGH/CRITICAL 扫描 0、四个中英桌面／手机产品浏览器身份（另 setup 1）和 12 张原图已验证，三份恢复 ZIP 全解压逐 hash 后精确释放副本净 223904461 字节、产品镜像和五条私有构建缓存；新候选终审、真实 CodeRabbit 及正常合并交付仍待；产品版本保持 0.74.0，无新增依赖、权限、迁移或协议。不查 CI，不发布部署。下方交付前记录保留原失败及组合证据归属。

## v0.74.0 交付前检查点（历史）

PR341／v0.73.1 已完整交付：最终 `91f1dca835b17b4c12087972e9c634cc8e406153` 真实 CodeRabbit，正常 squash master `3def603c33406dd04b67d6dcaaf3179e9ff149b5`；独立 API／fetch 核相同 tree 和唯一父、两个标准任务、8 条裁决及 8 份文件恢复归档完成。两个文档 Minor 组由本版接续，不倒填旧候选已修。

当前 [CSV 跳转方式导入](scope-v0.74.0.md)只增加固定第五列及独立严格协议，旧四种格式不变；空模式为 direct，中间页固定 5 秒，按实际行重查当前权限。Task1/2 已标准完成，准确产品、smoke／所选扫描及全部 12 个产品浏览器场景已验证；原失败、精确补验组合与实际环境见[验收](../implementation/v0.74.0-acceptance.md)。产品恢复档已全解压逐 hash 核验，精确释放副本净 223880377 字节、产品镜像及五条私有构建缓存；Task3 合同封口进行中，终审、真实 CodeRabbit 与合并交付尚待。不查 CI，不发布部署，沿用 4／12 GiB 临时预算。

## v0.73.1 交付前检查点（历史）

v0.73.0／PR340 已完整交付：最终候选 `3509923ec2e254ea5f66bcd79ccf4dc7fcb57a50` 获得真实 CodeRabbit，正常 squash master `2e6cbada32832bbbcba9d3859285eaaaab10d86e`，独立 API／fetch 核相同 tree 和唯一父；四个标准任务、19 条裁决及 12 份工作记录的可恢复归档完成。原双平台 5010 项组合、前端 5936 项及 13 个组合浏览器身份保持原执行归属，历史锁观察超时原因未确证，见[验收](../implementation/v0.73.0-acceptance.md)。

当前[交付状态文档维护](scope-v0.73.1.md)只澄清旧版当前结果与历史检查点，以及相关量词；产品保持 0.73.0。本维护的文档修正和本地核验已完成，真实审查与交付尚待，不借旧版审查替代。不查 CI，不发布部署。

## v0.73.0 交付前检查点（历史）

v0.72.0／PR339 已完整交付：最终 ca01dc14 真实 CodeRabbit，正常 squash master `dfc78e9cf6bf1bd3509b2e1e62864b50bccb3755`，独立 API／fetch 核相同 tree 和唯一父；四个标准任务、25 条裁决及 12 份工作记录的可恢复归档完成。原失败、双平台 4911 项和前端 5849 项组合、最终产品 35 项浏览器及 12 张 ROOT 原图保持各自执行归属，见[验收](../implementation/v0.72.0-acceptance.md)；不称单次全绿。

当前[有界批量目标规则检查](scope-v0.73.0.md)后端和独立中英批量卡片已实现：Windows 完成 5010 项组合／业务 100%／vet，Linux 完成 5010 项 race 组合／vet；前端完整 5936 项、四项 100%、types／lint／build 及 E2E strict 通过。原覆盖率失败及 Linux 锁观察超时保留，超时原因未确证。准确 dfe49f67 产品 smoke／所选扫描通过；13 个浏览器身份由原 11 项和手机补验 3 项组合覆盖，10 张新原图已查看，产品镜像／副本已可恢复清理。真实审查和交付仍待，详见本版验收。不查 CI，不发布部署。


## v0.72.0 交付前检查点（历史）

PR338／v0.71.0 已交付：最终 8a34a2b8 真实 CodeRabbit，正常 squash master `5f0308bb9d3d370a2a1c4917366191acd0f39cd8`，独立 API／fetch 核相同 tree 和唯一父；四标准任务、24 条裁决及 12 份工作记录可恢复归档完成。原 Linux 失败保留，I1 的时钟倒退已真实复现并以测试 fixture 修复／定向与完整 shortlink 验证；不倒推原 domain pool 原因已确证。

[管理员目标规则检查](scope-v0.72.0.md)已实现并完成本地验证：后端组合 4897 项／业务 100／race／vet，前端组合 5849 项／四项 100／types／lint／build。准确 0a73ca41 产品的 smoke、所选安全扫描及 35 个浏览器身份组合通过，12 张原图已查看；原失败和补验分别留证，不称单次全绿。已用产品副本、镜像、测试容器／卷／网络和四项构建缓存已可恢复清理。独立终审、真实 CodeRabbit 与合并归档继续，见[验收](../implementation/v0.72.0-acceptance.md)。不查 CI、不发布部署。

## v0.71.0 交付前检查点（历史）

PR337／v0.70.1 已完整交付：最终 `c7f543e0` 真实 CodeRabbit，正常 squash master `ff6a86bf9109e776e70aa6119fd2c4fc3ea52d1c`，独立 API／fetch 核相同 tree 和唯一父；两个标准任务、11 条裁决及 8 份工作记录可恢复归档完成。旧测试、产品、失败及所选原图保持原执行归属。

当前[目标 CIDR 白名单](scope-v0.71.0.md)的后端、前端和准确产品验证已完成：主机 4814 项／业务 100%、前端 5790 项／四项 100%，新产品 smoke、所选安全扫描和 30 项浏览器检查通过；16 张重点原图已查看，测试容器／卷／网络、产品镜像及副本已可恢复清理。Linux 首次整套两处失败由精确补验补齐，根因仍未确证，不称首次整套通过。独立终审、真实 CodeRabbit、正常合并与最终交付尚待；执行身份和原失败见[验收](../implementation/v0.71.0-acceptance.md)。产品 0.71.0，无新增依赖，不查 CI、不发布部署。

## 当前维护（2026-11-14，v0.70.1）

[目标 CIDR 黑名单](scope-v0.70.0.md)已通过 [PR336](https://github.com/TomyJan/MoeURL/pull/336) 完整交付：最终候选 `28cc2a5e` 真实 CodeRabbit，正常 squash master `247672d1681d9bab269751f1d5e5cc4652025e6d`；独立 API／fetch 核相同 tree 与唯一父。四个标准任务、23 条裁决和 12 份工作记录的可恢复归档完成。

原 Go 4730 项、前端 5649 项与准确 clean `85d8b226` 产品保持原执行归属：smoke、所选扫描和 25 项受影响浏览器单次通过，ROOT 查看 16 张原图、88 张全 hash，详见[验收](../implementation/v0.70.0-acceptance.md)。产品仍为 0.70.0。[当前 v0.70.1 维护](scope-v0.70.1.md)只修正状态文档和延期文字，自身本地核验、真实审查和交付另行记录；不查 CI、不发布部署。

## 当前维护（2026-11-14，v0.69.1）

v0.69.0／PR331 已完整交付：最终 bf20adb 真实 CodeRabbit、正常 squash master `fc8d240800f5eb3657d49c13286aef1ca1b6f685`、独立 API／fetch 相同 tree／唯一父、四个标准任务和 12 文件恢复归档完成。28 条裁决、M1 及原门禁保持原报告归属，下方是历史检查点。

当前[策略版本年份边界维护](scope-v0.69.1.md)已实现并完成本地验证：后端 4667 项／业务 100%、前端 5481 项／四项 100%，types／lint／build／vet 通过。Linux 完整 race 的唯一数据库连接准备失败经同输入单用例补验通过，原失败保留；完整 vet 通过。新产品 smoke／所选扫描、21 项受影响浏览器及可恢复产品清理已完成；本版审查交付仍待，见[验收](../implementation/v0.69.1-acceptance.md)。产品保持 0.69.0，无新依赖、API、权限或迁移。不查 CI，不发布部署。

## 当前开发（2026-11-13，v0.69.0）

PR330 已交付为 master `23bbc78ebd8c30871351e13b6a505d6ab6a01a8a`。当前[精确目标 IP 黑名单](scope-v0.69.0.md)支持 0–100 个直接地址、mapped 归一和今后目标写入，保持旧公开访问，不加入 CIDR、DNS 解析或 SSRF 承诺。标准 Task1–3 complete，Task4 进行中；唯一独立终审两项 Important 修复后，完整前端 5464 项／四项 100%、后端 4647 项／业务 100%、Linux race／vet 和新产品一次 389／389 浏览器通过，ROOT 核对 32 张新图，准确恢复清理完成。真实 CodeRabbit、正常合并与整版交付仍待，year0000 Minor、旧通知残留及原失败见[验收](../implementation/v0.69.0-acceptance.md)，执行身份不改归属。

## 当前维护（2026-11-13，v0.68.2）

v0.67.2／PR325已完整交付，master `5734f46d76f6e12d33998f7d4d6040d34c92c44c`；三个标准任务、最终f380b195真实CodeRabbit、正常合并独立核验和11份文件恢复归档完成。21条裁决、4项延期文案Minor及原时钟／Goose准备失败保留完整报告；实际净清2706657683B，原测试与扫描保持准确执行归属，不冒CI或发布结果。

[前端传递依赖安全维护](scope-v0.67.3.md)已完整交付为 PR326，正常 squash master `fe36797f3133fe963a14e05bf320c230c7f2708c`，独立 API／fetch 已核相同 tree 和唯一父。两个标准任务、唯一独立终审、最终 b69a3774 真实 CodeRabbit 和全部有效意见处置完成。完整 220 个文件／5080 项、四项 100% 及 types／lint／build 保持原实际执行身份，其他 1211 项输入准确复用。全部 19 条裁决、一组延期 Minor 及失败保留完整报告，9 份 owned 文件恢复 ZIP 已全解压逐 hash，准确 leaf 可恢复迁出。

[v0.68.0 后缀白名单](scope-v0.68.0.md)已通过 PR327 完整交付：最终4e763872真实CodeRabbit、四个标准任务、正常squash master `8457e3627690b31847095e8253acd0660c389c1a`、独立API／fetch相同tree与唯一父，以及12份文件的可恢复归档完成。32条裁决、原失败、原toast和新CR-M1／CR-M2延期均完整保留；原后端4586项、当前前端5191项／四项100%、原产品355项与修复产品9项浏览器保持各自执行身份，不冒新产品完整重跑。

[v0.68.1 策略保存确认维护](scope-v0.68.1.md)已通过 PR328 完整交付，master `ea56c08d6c3e3f2f4bd5bd4c59ca3119ca2b0915`；最终4a327bc真实CodeRabbit、三个标准任务、正常合并独立核验及10份文件恢复归档完成。17 条裁决、原失败及三组 Minor 保留原报告；5273 项前端断言与 17 个成功的唯一浏览器身份保持原执行归属，不冒单轮全绿。

[v0.68.2 窄屏页面通知布局维护](scope-v0.68.2.md)已通过 PR329 完整交付，master `198e36632f78e2c9504146de30ac9f5ac7189e16`；最终候选 `68a3dfe68a2b74cecbd1f1173bfe5ace1aaff7e6` 已获得真实 CodeRabbit reviewed／source=covered，全部有效问题已处置。三个标准任务、正常合并独立 SHA／tree／唯一父核验及 11 份文件的可恢复归档完成。原 Task1／2 与 I1 修复保持各自执行身份；最终 5273 项前端断言、四项覆盖率 100%、准确修复产品的 28 项浏览器检查和 13 张原图见验收。18 条裁决、原失败及三组延期文档意见保留原报告；不查 CI，不发布部署。

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

PR314 已完整交付为 master `b98bd1cbdbecaed7f30fd91bab7b5324d4463801`。当前[账号每日创建配额](scope-v0.64.0.md)已实现默认无限额的统一 UTC 日上限、原子计量及独立管理卡片；管理员同样受限，回执不重扣，删除或转移不退款。Task1–3 标准完成，前端 4857 项／四项 100%、types／lint／0.64.0 构建通过；准确产品 smoke／所选扫描、327 身份组合浏览器和 26 张原图核验通过；Task4 审查交付仍待，不新增访客创建、套餐或个人仪表，见[验收](../implementation/v0.64.0-acceptance.md)。不查 CI、不发布部署；下方原检查点保持历史归属。

## 当前维护（2026-11-12，v0.63.1）

[v0.63.0 可选目标主机白名单](scope-v0.63.0.md)已通过 PR313 完整交付为 master `864a79d04567463130c51d4cdc822cbe04c2e3e2`：默认关闭，启用需非空精确 DNS 名单，黑名单优先，只限制新目标写入，旧访问及已提交回执恢复不变。四个标准任务、最终 c626414 的真实 CodeRabbit、独立合并核验和 13 份文件的可恢复归档均完成。最终前端 4759 项／四项 100%；旧产品完整浏览器 319／319、最终修复产品 7／7 及 30 张最终原图保持各自执行身份，见[验收](../implementation/v0.63.0-acceptance.md)。当前 [v0.63.1](scope-v0.63.1.md)仅补测试及状态文档，相关 97 项与 types／lint 已通过，自身审查交付尚待；产品仍为 0.63.0，未发布部署。下方保持各版原检查点。

## 当前维护（2026-11-12，v0.62.1）

二维码标准 4／宽 8 模块已由 [PR311](https://github.com/TomyJan/MoeURL/pull/311) 完整交付；最终候选 `00422ad` 真实 CodeRabbit、master `8a9bc9ec6fe770a759e388031fc8988d80fc157c` 独立核验、三个标准任务、16 条裁决与 11 份文件恢复归档完成。原浏览器 311／313 与后继 29 个场景加 setup 去重覆盖 313 个身份，16 张原图及执行边界保留，不冒单次全绿。当前[交付状态文档维护](scope-v0.62.1.md)产品保持 0.62.0，自己的审查交付尚待。下方为历史检查点。

## 当前维护（2026-11-12，v0.61.3）

v0.61.2／[PR309](https://github.com/TomyJan/MoeURL/pull/309) 已完成真实审查、正常合并独立核验及恢复归档。当前[手机编辑器回归补测](scope-v0.61.3.md)两项补测及本地验证完成，审查交付仍待，不改变产品行为或 0.61.1 版本号。下方为历史检查点。

## 当前维护（2026-11-12，v0.61.2）

v0.61.1／[PR308](https://github.com/TomyJan/MoeURL/pull/308)已完成交付，master 为 `0012441aff26519ec7f98bdbfff1c9708c3a3fc3`。当前[临时容量检查维护](scope-v0.61.2.md)只改善开发流程，已实现并通过本地验证，审查与交付仍待完成，产品仍为 0.61.1；不查 CI、不发布部署。下方为历史检查点。

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

当前推进 [v0.45.0 短链列表分页](scope-v0.45.0.md)：固定每页 20 条、前后翻页与单页选择，CSV 仍导出全部已应用筛选。实现和唯一独立终审修复完成，3011 项前端四项 100%、181 项浏览器、34 张相关原图及精确产品验证通过；标准收尾与远端交付继续，见[计划](../implementation/v0.45.0-plan.md)与[验收](../implementation/v0.45.0-acceptance.md)。

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

2026-11-01 最新交付为 v0.37.0／PR244，master617c12cc8cb07c2ea3173b8d0cc65239aec4f49c，自身九 CI、真实审查、标准任务和可恢复归档已完成，未发布部署。当前 [v0.38.0](scope-v0.38.0.md)实现最多 20 条网址的本人原子批量创建，不等同 CSV 恢复或替代单条高级创建；Task1 已标准完成，前端完整 2534 测试、四项 100%、types／lint／隔离 build 通过。Task2 已在 2b2ee2a 标准完成，Task3 已标准启动；手机提示已真实 RED→GREEN，clean bfb9828 的完整 144 项浏览器、八张原图实读和标准产品／精确镜像扫描通过，唯一终审、本地归档与远端交付仍待。下方旧摘要为历史。

2026-11-01 当前交付：[v0.36.0 账号时区](scope-v0.36.0.md)已通过 PR243 合并及自身 master 九 CI、真实审查、标准任务和完整可恢复归档，未正式发布。下一步 [v0.37.0](scope-v0.37.0.md)仅补精确记录时间的可访问展开与手机提示留白，不新增后台、数据库或权限；已完成两表详情和手机提示的本地实现及定向验证，整版交付仍待，实际门禁见[本版验收](../implementation/v0.37.0-acceptance.md)。旧执行与失败保持各自原归属。

2026-11-01 当前摘要：[v0.36.0 账号时区显示预设](scope-v0.36.0.md)按正式[实施计划](../implementation/v0.36.0-plan.md)实施：Task1–2 已分别标准完成（90674e6／070627a），完整前端 2443 测试及四项 100%、后端业务 100% 已通过。Task3 在 clean 544a0706 上完整 128 项浏览器通过，5 张原图已实读；标准产品 smoke 与同一精确镜像的正常漏洞库更新扫描通过，两次下载失败与官方镜像恢复分别保留。唯一终审已完成（Critical 0／Important 1／Minor 1），认证暂时失败后时区编辑器无法恢复的问题已真实 RED→GREEN；修复后完整 2449 项前端测试、四项 100%、types／lint／build 已通过。修复候选 b5a3dcea 的新完整 128 项浏览器（10.8 分钟）、5 张原图实读及标准产品／精确镜像扫描已通过；原重连超时失败及不变输入诊断分别留证，不称已证明其根因。本地归档／标准收尾与远端交付仍待；独立本人偏好／CAS、九固定 IANA 与身份轮次隔离，只改显示，不改 UTC 统计、CSV、到期输入或公开访问，无新依赖或权限。v0.35.0／PR239 已完成交付；其后 PR242 有界测试回滚维护已合并为 08b990d70bf30dbe54f885d0b7a3bc9490eacb89，真实审查、候选及 master 各九 CI、标准任务与可恢复归档均完成，未正式发布。下方带时间的旧待做叙述均保留其历史归属，不表示当前仍未交付，也不借旧证据给本版。

2026-10-30 19:06 UTC 文档状态同步（远端状态只据 2026-10-30 18:13:09 UTC 只读快照，非本次实时查询）：Task1–3 已标准完成，Task4 进行中且仅步骤 1 已完成。既有 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 已推送候选 `c44d23c0c7fe9ff41c52c19bd92dbe3c45636b08`；其自身 [CI run41097109781](https://github.com/TomyJan/MoeURL/actions/runs/41097109781) 九项 SUCCESS，完整 7331 行原始日志现已 ROOT 连续读至 EOF。真实 CodeRabbit review5716229915 的 kind=reviewed、sourceCommitId=coveredCommitId=该候选完整 SHA，review 与 overview 已全文读回；快照 effective open 为 0，但两条新增 outside 文档 Minor 仍须本次字段／状态同步及一次公开处置闭环，不与原五类延期 Minor 混合。本次文档后继的自身 CI、完整原始日志与真实 exact-head 审查仍待，不借 c44 证据；尚未合并、未完成 master 自身 CI／标准 Task4／最终归档清理，未 tag／release／deploy。以下旧阶段与失败记录均为历史，保留实际提交、输入、运行时和证据归属。

历史记录（原文保留）：2026-10-30 12:07 UTC 标准状态：Task1–3 均已实际标准完成，Task3 范围 d7e071f..1e177c5 的 evidence-only gate actual 0；完整 owned 15 文件／933437 bytes 已 ZIP／extract 全集合核（ZIP 313107 bytes），原 12 文件／845867 bytes dispatch 与合同、失败原件保持冻结，live leaf 保留。Task4 已从 1e177c5 标准启动，当前仅准备远端交付；尚无 push／PR／候选 CI／远端审查／merge／master CI／最终档案清理／tag／release／deploy。下方 11:50 的浏览器与精确产品成功仍只归 clean 6e3cd9b，不借给后继文档 SHA，不重复成功 suite、生成器、产品或原图。

2026-10-30 11:50 UTC 当前本地结论：clean 6e3cd9ba7c5df30656af864c132d99f0870966af 的完整浏览器 actual 0／125 passed（12.0m），标准 18178 smoke、精确 image binary／static V0.35.0-6e3cd9b 与完整 sourceURL、同 image Trivy 0.74 正常 DB 下载及 HIGH／CRITICAL（ignore-unfixed=false）三目标均实际通过。完整 777 非 Markdown／769 runtime 路径与 hash／bytes 稳定，准确 owned 资源已收尾；唯一终审 Important 已真实修复并完成受影响门禁，五类旧 Minor 继续延期。Task1–2 标准完成，Task3 仅余本地档案和标准完成，Task4 全部远端待做，无 push／PR／merge／tag／release／deploy。下文带时间的旧 pending／失败为原执行历史，不代当前结论，也不把本地门禁冒候选或 master CI。

2026-10-30 11:11 UTC 最新：clean bc60c4e 的完整 125 项 actual 1，122 passed／3 failed；三个页脚场景、通知回归及 v0.26 双视口均通过，失败为旧 v0.28 双视口通知按钮 detach 与 v0.29 桌面实际未提交目标域名。真实 trace 已逐项核，不据此认定后端或页脚回归。仅两旧 E2E 复用已验证通知 helper／同步真实 pointer 选择并断言实际值后，初始化及两场景双视口共 5 项 actual 0（2.5m），当前隔离 types／lint actual 0；777／769 完整输入稳定、准确 owned 三空。门禁仍归 bc60c4e 加当时两测试 dirty，产品运行时未变；新 clean 完整门禁及精确产品仍待。Task3 in_progress／Task4 pending，无 push／PR／merge；旧执行保持原归属。

2026-10-30 后继浏览器读回：clean 10e0e7a 的通知集成定向 7 项通过；其唯一完整 125 项 actual 1，124 passed／1 failed，三个新页脚场景及旧 v0.29 双视口均通过。失败是旧 v0.26 手机场景未提交预期系统选择，真实 trace 的 POST 仍为 Personal，服务端正确返回 300104，不据此认定页脚或持久化回归。仅同步旧测试的真实 pointer 选择并加精确冲突 payload 断言后，初始化与双视口共 3 项 actual 0，当前隔离 types／lint actual 0；产品运行时不改。新 clean 完整门禁及精确产品仍待，Task3 in_progress／Task4 pending，无 push／PR／merge。下文旧执行保持原提交与环境归属。

历史候选快照（632c619，原文保留）：当前实施迭代为 [v0.35.0 有界页脚链接](scope-v0.35.0.md)：独立资源最多 5 项，管理员排序／保存，公开安全新窗口导航。Task1–3 已标准完成，后端、前端、完整浏览器和精确产品本地证据分别保留；Task4 的 [PR #239](https://github.com/TomyJan/MoeURL/pull/239) 候选 632c619 的目标 CI 三项失败，ACE 校验及旧 E2E 选择同步窄修中，未合并、未发布。旧纯文本页脚、固定 Powered by 与既有偏好不变。详见[规格](../specs/2026-10-30-v0.35.0-footer-links-design.md)与[验收](../implementation/v0.35.0-acceptance.md)，带时间的旧阶段记录不替代修复后的完整门禁、当前候选真实审查及 master 自身 CI。

2026-10-30 09:26 UTC 最新：唯一 fresh 整分支终审已完成（Critical 0／Important 1／新 Minor 0）。ROOT 真实共享语料与已登录 App/session/PG 复现普通 ASCII 双连字符主机前后端分歧；仅 Go 改为逐 ACE 标签 IDNA 校验，92 项同源语料、真实保存和原 API／HTTP 协议已局部 GREEN。原 clean afed568 的 121 项浏览器和精确产品／扫描仍仅属历史，不借给新运行时；当前完整 Go、vet、canonical 业务 100% 与 checker 10 项均 actual 0，隔离 types／lint 已通过；完整 775 非 Markdown 输入逐项稳定，Linux 完整 race／scanner 也已 actual 0；scanner called 0／imported 0／required 3，不冒零公告，新 clean 浏览器及精确产品仍待。Task1–2 标准完成、Task3 in_progress／Task4 pending，原五类 Minor 延期，无 push／PR／merge。

[v0.34.0 站点强调色预设](scope-v0.34.0.md) 已由 [PR #237](https://github.com/TomyJan/MoeURL/pull/237) 于 2026-10-29T21:10:29Z 合并为 fc88c0e8b9192174e62b225fdc3cb0b87a253451。最终候选 99ebef5 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40949991695) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40955501280) 各九项成功，真实审查覆盖最终候选、全部有效意见闭环；标准 Task1–4、完整最终归档与准确 owned leaf 可恢复清理完成，未正式发布。固定 iris／ocean／forest 三预设、独立 CAS 与仅键名审计保持既有主题模式、个人偏好和公开访问；任意颜色编辑仍未开放；本次维护不改依赖、权限或 schema。原失败、逐候选运行时和当时延期三项 Minor 见[验收](../implementation/v0.34.0-acceptance.md)。当前[独立验证与文档维护](../implementation/2026-10-30-site-accent-closeout-plan.md)不新增业务版本；补验 Task1 已标准完成，维护自己的终审及 PR／CI／合并仍待做。

[v0.33.1 首页文案反馈补丁](scope-v0.33.1.md) 已由 [PR #232](https://github.com/TomyJan/MoeURL/pull/232) 合并为 `cf5d5a64`，最终 `91cf9d5` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40885738492) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40892523382) 各九成功，真实审查／有效意见闭环、标准 Task1–3 与最终归档清理完成。原本地产品、失败、pointer 覆盖取舍及截图／扫描限制保持[验收](../implementation/v0.33.1-acceptance.md)归属，未正式发布。

[v0.33.0 首页文案](scope-v0.33.0.md) 已由 [PR #231](https://github.com/TomyJan/MoeURL/pull/231) 合并为 `811d6c57`，最终 `34a520b` 的 PR CI40852026042 与合并 master CI40858639758 各九成功，真实审查／有效意见闭环，标准 Task1–4 与完整最终归档、准确 leaf 可恢复清理完成。管理员首屏标题与简介纯文本、逐字段回退、独立版本和身份隔离；三个 Minor 在该版延期，原证据见[验收](../implementation/v0.33.0-acceptance.md)，未正式发布。

[v0.32.0 二维码外观预设](scope-v0.32.0.md) 已由 [PR #230](https://github.com/TomyJan/MoeURL/pull/230) 合并为 `99f87709`。最终 `28214ef` 的 PR CI40816638924 与合并 master CI40821882951 各九成功，真实最新审查／有效意见闭环，标准 Task1–4 及最终完整归档均完成；未正式发布。原候选和执行环境见[验收](../implementation/v0.32.0-acceptance.md)。

[v0.31.0 OIDC 创建模板](scope-v0.31.0.md) 已通过 [PR #229](https://github.com/TomyJan/MoeURL/pull/229) 于 2026-10-28T18:44:58Z 合并为 `c671205182f92d7a5396ebf4e3589d85d155dd2b`。最终候选 `e9c3025` 的 PR CI40741884841 与合并 master CI40748005532 各九成功，真实最终审查、全部有效意见闭环，标准 Task1–4 和最终完整 SDD 归档完成。仅 Google／手动创建草稿，未正式发布或验收真实 Google 外部互通；原单元及各候选制品见[验收](../implementation/v0.31.0-acceptance.md)。

v0.30.0 已通过 [PR #228](https://github.com/TomyJan/MoeURL/pull/228) 于 2026-10-28T13:21:25Z 合并为 `d582fba02772e62f2f3af2fe11e485728f5c0097`。最终候选 `f54567d` 的 [PR CI #40686801162](https://github.com/TomyJan/MoeURL/actions/runs/40686801162) 与该合并的 [master CI #40695791448](https://github.com/TomyJan/MoeURL/actions/runs/40695791448) 各九项成功，真实 CodeRabbit 覆盖最终候选、有效意见全部闭环；标准 Task1–4 与完整最终 SDD 归档核验已完成。未正式发布或部署。范围、逐候选验证、原失败及运行归属见[验收](../implementation/v0.30.0-acceptance.md)；不将旧本地浏览器或产品制品重归属给合并提交，不扩自定义组、多组或 OIDC 映射。

## 产品定位

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

产品标语建议为：

> MoeURL：现代、轻量、可控的自托管短链系统。

系统优先面向自托管和私有化部署场景，强调部署者自有域名、数据控制、权限可控和轻量维护。后续如需扩展公开 SaaS 或商业化能力，应在现有权限、鉴权、审计和风控扩展点之上继续演进。

## 长期核心目标

[v0.29.0 每域名默认跳转方式](scope-v0.29.0.md) 已通过 [PR #227](https://github.com/TomyJan/MoeURL/pull/227) 合并为 `8af05d60fb89769f7aaabf4da4906ed411fdad48`；最终 `4dfa4d43` 的 PR CI #40629796924 与合并 master CI #40631422772 各九成功，实际 CodeRabbit 覆盖最终且有效 open0。只影响有权创建者的新面板初选，不改旧省略 API 或已有短链。尚未正式发布，唯一终审、root 修复及各候选制品见[验收](../implementation/v0.29.0-acceptance.md)。

本节描述 MoeURL 的完整目标形态。v0.26 个人默认、v0.27 域名排序和 [v0.28 用户组默认](scope-v0.28.0.md) 均已合并。v0.28 的 PR #226 合并为 `b1b1e4112ba92708becf59c875cff8bff109c3ec`，最终 `0280081` 的 [PR CI](https://github.com/TomyJan/MoeURL/actions/runs/40575287235) 与该合并的 [master CI](https://github.com/TomyJan/MoeURL/actions/runs/40586040807) 各九成功，真实 CodeRabbit 覆盖最终且全部有效意见闭环；逐候选、原失败与制品见[验收](../implementation/v0.28.0-acceptance.md)。具体能力见[开发进度](development-status.md)，正式发布与生产验收仍未执行，生产化边界继续见 [v0.6.0 范围](scope-v0.6.0.md)。

[v0.17.0 短链批量管理](scope-v0.17.0.md) 已合并当前列表多选、原子启停与软删除。包含后续依赖及 Go 安全修复的历史主分支候选 `c4928a85` 完整目标 CI 已通过；该结果属于历史记录，不代表当前主分支基线或当前 CI 结果，生产演练与正式发布仍待完成。不包含跨页全选、导入或归属转移。原分支与历史主分支候选的证据分开保留，见 [本版计划](../implementation/v0.17.0-plan.md) 和 [验收记录](../implementation/v0.17.0-acceptance.md)。

MoeURL 的长期核心目标包括：

- 让用户可以创建、管理和统计短链。
- 让管理员可以统一控制用户、用户组、权限、域名、主题和系统行为。
- 让短链访问支持直接跳转、中间页跳转、确认页跳转、访问密码等多种模式。
- 采用 `https://xxx.com/abcd` 这类简洁短链访问形式。
- 让所有可开放能力都通过权限系统控制，而不是散落在各个独立开关中。
- 让系统具备现代化体验，包括多语言、自动深色模式、响应式布局、前端样式主题化和基础品牌自定义。

## 核心设计原则

### 权限优先

MoeURL 的核心控制逻辑是权限系统。

凡是涉及「能不能使用某个功能」「能不能使用某个域名」「能不能使用某种跳转方式」「能不能配置某类跳转页」的问题，都应优先通过权限系统表达。

系统不单独设计「是否允许游客创建短链」这类割裂配置。游客能力由内置的 `guest` 用户组和 `guest` 用户决定。

### 能力即权限

系统中所有重要功能都应抽象为能力，再由用户组权限开放。

例如：

- 创建短链是一种权限。
- 使用某个域名是一种权限。
- 创建直接跳转短链是一种权限。
- 创建中间页短链是一种权限。
- 创建确认页短链是一种权限。
- 使用访问密码是一种权限。
- 使用某个跳转页模板是一种权限。
- 使用某个模板的可编辑元数据是一种权限。
- 查看详细统计是一种权限。
- 创建长期有效短链是一种权限。

为了降低配置复杂度，管理界面可以在细粒度权限之上提供权限包或权限预设。权限包用于降低管理员配置成本，不替代底层权限模型。

### 默认简单，高级折叠

普通用户的主流程应尽可能简单：

```text
粘贴链接 → 生成短链 → 复制使用
```

高级功能放在折叠区域或高级设置中，只在用户有对应权限时可用。

对于短链创建这类常见、普适的核心组件，无权限时不应直接隐藏，而应置灰并给出友好提示，以保持体验一致。

### 现代化体验

默认目标形态具备：

- 多语言。
- 自动深色模式。
- 响应式布局。
- 清晰的空状态、错误状态和加载状态。
- 移动端友好的短链访问页。
- 可配置的页脚、站点名称、Logo 和主题。

其中，中英双语和自动深色模式已经实现；v0.9.0 已交付站点名称、默认语言／主题与纯文本页脚配置。Logo、Favicon 上传和主题编辑器仍未实现。当前 Powered by 版本署名固定展示，不能关闭。

## 当前维护入口

当前以顶部和[能力清单](development-status.md)为准。下面两段日期更新保留当时归属，随后为当前能力概览。

2026-10-28 更新：[v0.27 验收](../implementation/v0.27.0-acceptance.md)已记录最终 `64751e5` 与合并 `8c024b5` 各九项 CI 成功及真实审查闭环。[v0.28 用户组默认](scope-v0.28.0.md)已通过 [PR #226](https://github.com/TomyJan/MoeURL/pull/226) 于 2026-10-27T21:21:01Z 合并为 `b1b1e4112ba92708becf59c875cff8bff109c3ec`；最终 `028008114edda315cfaef0f2effbc0c6c127ae7c` 的 PR CI #40575287235 与该合并的 master CI #40586040807 各九成功，真实 CodeRabbit 覆盖最终且有效意见闭环。首候选 `7c84ba5`、独立终审与集中修复的各阶段证据保留在[v0.28 验收](../implementation/v0.28.0-acceptance.md)，不替代最终候选／合并结果。v0.25 的历史失败及后继维护、v0.24／v0.26 的 PR／合并 CI 保持独立归属；以上均未正式发布。

2026-10-26 更新：[v0.19.0 用户组成员迁移](scope-v0.19.0.md) 已通过 PR #211 合并为 `c08b67b2`；[v0.20.0 单条归属转移](scope-v0.20.0.md) 已通过 PR #214 合并为 `2d23dcfd`；[v0.21.0 清单 CSV](scope-v0.21.0.md) 已通过 PR #216 合并为 `dfc9a5a1`。v0.22.0 批量归属转移已通过 PR #217 合并为 `ba2073cf`，最终修复候选 `7e41d438` 和实际合并提交 CI 各 9 项成功，尚未正式发布，具体提交及证据见[本版验收](../implementation/v0.22.0-acceptance.md)。本页旧版本状态与分支验证保留历史归属，合并不替代正式发布。

当前能力按模块集中维护在 [开发进度与能力清单](development-status.md)，待开发方向见 [路线图](roadmap.md)。总览保留产品原则，不重复维护每个历史版本的详细任务和验证结果。

主分支已经实现的主要闭环包括：

- 短链创建、个人与全站管理、三种跳转模式、过期时间、访问密码、二维码、最大访问次数、标题和标签。
- 个人概览、最近短链、最长 90 天 UTC 区间的单链匿名分析与聚合／匿名记录 CSV、管理员全站仪表盘及单链访问明细；单链分析从对应短链进入。
- 本人／全站每页 20／50／100 条（默认 20）、前后翻页和单页选择；最多 100 条原子批量启停／软删除、转移和标签整理，最多 20 条原子创建及单列 CSV 录入；只读标签查找、内部纯文本备注、有无备注及最多 100 码点私密备注关键词交集筛选和事务审计。CSV 导出全部匹配元数据，不含备注正文。
- 本地账号、个人昵称与改密、账号语言／主题和九固定 IANA 时区显示偏好、单账号／有界批量成员迁移、内置组权限、多提供商 OIDC 及多域名授权。
- 站点名称、默认语言／主题、首页标题／简介、三个固定强调色、纯文本页脚、最多五个有序链接和安全的本地登录开关。
- 中英双语、响应式浅深色界面、PWA 基础、统一 Toast 与标准列表，以及固定展示的构建版本署名。

最近已交付 [v0.48.0 每页条数](scope-v0.48.0.md)、[v0.47.0 列表确定顺序](scope-v0.47.0.md)、[v0.46.0 私密备注关键词筛选](scope-v0.46.0.md)、[v0.45.0 固定分页](scope-v0.45.0.md)和 [v0.44.0 备注状态筛选](scope-v0.44.0.md)，此前包括[内部备注](scope-v0.43.0.md)、[版本边界补丁](scope-v0.43.1.md)、[本人标签查找](scope-v0.41.0.md)、[全站标签查找](scope-v0.42.0.md)、[批量创建](scope-v0.38.0.md)、[CSV 录入](scope-v0.40.0.md)、[格式帮助](scope-v0.40.1.md)和[个人默认方式](scope-v0.39.0.md)。维护不另算业务版本，合并不视为正式发布。

[v0.12.0 自定义短码](scope-v0.12.0.md) 已通过 PR #185 合并至 `master` 的 `17e1f766`，支持创建时指定地址，不加入改码、释放、复用或批量能力；原分支的本地验证和独立审查见 [验收清单](../implementation/v0.12.0-acceptance.md)，合并不等于正式发布。

[v0.13.0 个人密码修改](scope-v0.13.0.md) 已通过 PR #186 合并为 `a52733cc`；校验当前密码后原子更新并撤销全部旧 Session，要求重新登录。本地验证与待补齐的目标环境证据见 [验收记录](../implementation/v0.13.0-acceptance.md)。

主分支已通过 PR #208 合并 [v0.18.0 全站统计、匿名访问明细与操作审计](scope-v0.18.0.md)：管理员全站快照、已有单链分析页内的匿名记录，以及关键业务写入同事务审计和 180 天在线保留。各阶段证据见 [验收](../implementation/v0.18.0-acceptance.md)；已合并，尚未正式发布，不将主分支历史 CI 当作本版验证。

尚未实现的主要方向包括自定义组、头像、自定义 OIDC 模板和账号绑定、独立标签实体与治理、导出清单恢复、超出 90 天或任意时区分析、全站访问合并导出、品牌上传及模板编辑。固定时区显示、有界 CSV 创建、固定强调色和只读标签查找已经交付，不作为全新功能重复规划；其他方向仍须独立收敛范围。

## 验证与发布边界

功能实现、主分支合并和正式发布是不同状态。当前各版本的门禁证据保留在对应 acceptance；最新已交付版本的本地前端、浏览器、候选及 master 门禁见 [v0.48.0 验收](../implementation/v0.48.0-acceptance.md)。[标准列表验收](../implementation/2026-10-15-standard-lists-acceptance.md) 和 [配色验收](../implementation/2026-10-15-color-refresh-acceptance.md) 是 2026-10-15 的历史基线，各自执行归属不变。

单机 Compose 与外部 TLS 代理仍是支持的生产部署方向。候选提交的目标 CI、Linux race、安全扫描、完整容器流程、真实 DNS/TLS、外部 OIDC、隔离恢复和生产发布验收须按各自环境补齐；历史提交的 CI 或本地回退结果不能替代这些证据。缺口与证据索引统一见 [开发进度与能力清单](development-status.md)。
