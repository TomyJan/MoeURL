# 前端 glob 安全维护验收

2026-11-04 设计完成，尚未安装新依赖或运行本轮门禁。基线为已完整交付 v0.48.0 的 master `6aa7c0aa5a805446fae16e7d8453388763081f23`，独立分支 `fix/frontend-glob-security`。原始证据外置于 `D:/Dev/TomyJan/MoeURL/.tmp/frontend-glob-security-20261104`。

- [x] 基线官方 audit：2 moderate／0 high／0 critical，实际exit1，完整6458bytes原件SHA `F4CFDFD3E7725F8D85D21E6581AA59AB0F1F10A2DD34278DC0F5A724506844F8`；旧镜像 `sha256:8186bac837af789761eec4e9ce6e698c0b2b6287cfdc7cc6f6040bfd5279f26b`，Node26.12.0／pnpm11.5。此项复用原执行，不冒本轮重跑或产品RED。
- [ ] 标准解析及frozen安装，完整树无受影响目标副本，两个GHSA消失。
- [ ] 新依赖lint／types、完整前端及四100%、隔离build，完整输入稳定与准确资源收尾。
- [ ] 新产品／完整187项浏览器、原图检查、版本／精确镜像扫描，Go／SQLC输入精确复用边界。
- [ ] 唯一独立整分支终审与全部有效问题处置，本地标准任务及阶段归档。
- [ ] 最新候选真实远端覆盖、完整讨论、候选九CI与完整日志。
- [ ] 守卫合并与独立master身份、master自身九CI与完整日志、最终标准任务及可恢复归档。

无业务行为、API、权限、数据库或版本号变化；未发布部署。未执行项不以历史版本的成功结果替代。
