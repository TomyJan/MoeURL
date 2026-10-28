# v0.31.0 OIDC 提供商创建模板

## 状态与依据

设计／实施准备中，尚无本版运行或远端交付证据。[路线图](roadmap.md)与[账号规格](../specs/users-and-auth.md)已规划提供商模板；root 按长期自主授权选择这个有界版本，裁决及错误代价见[设计](../specs/2026-10-28-v0.31.0-oidc-provider-templates-design.md)，不声称用户逐项批准。隔离分支 `feat/v0.31.0-oidc-provider-templates` 从 fresh master `d582fba02772e62f2f3af2fe11e485728f5c0097` 以 `--no-track` 建立；`e124cf1` 只同步 v0.30.0 已合并、独立 CI 与最终归档事实，不是本版产品验证。

## 必须实现

- 只在系统设置的 OIDC 新建表单提供手动空白、Google、Microsoft Entra ID 单租户三种本地模板。
- 选择模板或输入租户不改草稿、不联网；明确点击应用后才整体替换创建草稿，已有内容时先确认，取消完整保留。
- Google 使用固定 issuer；Entra 只接受规范连字符 UUID 租户，规范化大小写后生成租户 issuer，不接受 `common`、域名或 URL。
- 应用模板清除旧 Client ID、Secret、邮箱域名白名单。Google／Entra 草稿默认禁用，管理员手动填写自身凭据、精确域名、检查并保存／启用；手动空白沿用原始 enabled=true 默认。
- 编辑已有提供商不展示或接受模板应用；在途写入、取消创建、切换提供商后不得迟到覆盖草稿。
- 中英文与桌面 1280×720／手机 390×800 可读可操作，复用 Vuetify，不增加图标字体或外部资源。

## 保持的安全契约

模板仅是前端草稿辅助，不持久化模板标识或租户输入，不新增 API、权限、schema、依赖或缓存。已有 OIDC Discovery、issuer／audience 验证、加密、Secret 脱敏、严格 DTO、当前管理员授权、版本冲突、外部绑定保护不变。模板不保证外部提供商部署可用，不代替真实 Google／Microsoft 凭据或生产验收。

## 明确不做

OAuth-only GitHub、Microsoft 多租户与个人账号入口、自定义模板管理、远程模板下载、logo、自动发现／保存／启用、回调地址推导、账号合并、组映射、自定义组、多组、头像和时区。旧手动创建和已有提供商编辑继续可用。

## 完成条件

[计划](../implementation/v0.31.0-plan.md)的标准 Task1–4、真实 RED→GREEN、完整受影响前端及浏览器／六原图、新 clean 精确产品／标准 smoke／同 image 扫描、唯一 fresh 最强整分支终审及有效修复、最终 head 自己九项 CI 与真实最新 CodeRabbit 覆盖、guarded 合并及独立 master CI、完整最终 SDD 归档核验分别有证据。未执行保持待验证；不借 v0.30.0 制品。正式发布不在本轮自动动作内。
