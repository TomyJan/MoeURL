# 前端 glob 安全维护验收

2026-11-04 新依赖安装、安全检查及完整前端门禁已通过；Task1 在原子提交后执行标准完成验证。浏览器、产品与远端交付尚未执行。基线为已完整交付 v0.48.0 的 master `6aa7c0aa5a805446fae16e7d8453388763081f23`，独立分支 `fix/frontend-glob-security`。原始证据外置于 `D:/Dev/TomyJan/MoeURL/.tmp/frontend-glob-security-20261104`。

- [x] 基线官方 audit：2 moderate／0 high／0 critical，实际exit1，完整6458bytes原件SHA `F4CFDFD3E7725F8D85D21E6581AA59AB0F1F10A2DD34278DC0F5A724506844F8`；旧镜像 `sha256:8186bac837af789761eec4e9ce6e698c0b2b6287cfdc7cc6f6040bfd5279f26b`，Node26.12.0／pnpm11.5。此项复用原执行，不冒本轮重跑或产品RED。
- [x] 标准解析及 frozen 安装，完整树无受影响目标副本，两个 GHSA 消失。Node 26.12.0／pnpm 11.5.0；外置 `resolve/web` 执行 `pnpm install --lockfile-only --ignore-scripts --registry=https://registry.npmjs.org`，实际 exit0；新依赖镜像 `sha256:223fc947956ff7cab530f74985e2dd08b07045d25cd11e382fdc5d1b64f93c30` 的 frozen 安装实际 exit0。四个父节点使用 minimatch 11.0.2，glob 14.0.3 自然解析安全的 minimatch 11.0.4；仅目标必要闭包变化。镜像内 `pnpm list --depth Infinity --json`、`pnpm why minimatch glob`、官方 `pnpm audit --json --registry=https://registry.npmjs.org` 均实际 exit0，427 个依赖，全严重度零公告。完整树和原件 hash 见 `task1-dependency-proof.json`。
- [x] 新依赖 lint／types、完整前端及四 100%、隔离 build，完整输入稳定与准确资源收尾。新镜像 `/work/web` 顺序执行 `pnpm lint`、`pnpm typecheck`、`pnpm test:coverage --maxWorkers=2 --coverage.reportsDirectory=/output/coverage`、`pnpm build --outDir /output/dist --emptyOutDir`，整体 exit0；166 文件／3119 测试／191.22 秒，LCOV 行 5141／函数 2067／分支 5323 全覆盖，build 1.90 秒。完整 1287 输入前后不变、owned 容器为空，未安装 host 依赖；继承环境未全捕获。原执行身份为 `d98abea6e90af0f8338c33a664295384d2b76f73` 加 Dockerfile／workspace／lock 三项 dirty，完成提交仅通过完整非 Markdown 输入等同核转移，不冒 clean 提交重跑。raw 115265 bytes／SHA `1A7DD5F59CDE1F85BEF944C7089F2A4E233018E3ACB8211DCEA37B8F77A4151B`，见 `task1-frontend-proof.json`。两类既有 Vue 测试警告无新增文字；构建零警告，Vitest 性能提示保留，不称全程零 notice。
- [ ] 新产品／完整187项浏览器、原图检查、版本／精确镜像扫描，Go／SQLC输入精确复用边界。
- [ ] 唯一独立整分支终审与全部有效问题处置，本地标准任务及阶段归档。
- [ ] 最新候选真实远端覆盖、完整讨论、候选九CI与完整日志。
- [ ] 守卫合并与独立master身份、master自身九CI与完整日志、最终标准任务及可恢复归档。

无业务行为、API、权限、数据库或版本号变化；未发布部署。未执行项不以历史版本的成功结果替代。

浏览器驱动边界：host Node 26.3.0、Playwright 三包 1.64.1 的完整实际依赖链及对应新旧 lock 的 package／snapshot 块逐项一致，仅复用未变化的驱动；新前端工具链使用上述新镜像，浏览器产品使用当前 Dockerfile 重新构建。`verify-browser-driver.mjs` 在启动前重新核三文件合同与驱动 hash，不进行 host 安装。该驱动复用不代表浏览器已通过。
