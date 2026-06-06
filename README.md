# MoeURL

MoeURL 是一个现代、轻量、可控的自托管短链系统，面向个人、小团队和可控范围内的公开访问场景。

当前项目处于 v0.0.1 工程开发准备阶段，优先目标是完成基础可用闭环：首次初始化、本地登录、权限判断、创建短链、管理短链和访问短链直接跳转。

## 文档入口

- [文档总览](./docs/README.md)
- [产品总览](./docs/product/overview.md)
- [v0.0.1 范围](./docs/product/scope-v0.0.1.md)
- [v0.0.1 工程实施合同](./docs/implementation/v0.0.1-implementation-contract.md)
- [v0.0.1 任务级实施清单](./docs/implementation/v0.0.1-tasks.md)
- [v0.0.1 验收清单](./docs/implementation/v0.0.1-acceptance.md)

## 当前状态

项目当前只有规划和实施文档，尚未进入 Go + Vue 代码实现阶段。正式编码前，请以 [v0.0.1 工程实施合同](./docs/implementation/v0.0.1-implementation-contract.md) 作为主执行入口。

## v0.0.1 目标技术栈

- 后端：Go、Chi、SQLC、Goose、PostgreSQL。
- 前端：Vue 3、Vite、TypeScript、Vuetify 3。
- 状态：Pinia、TanStack Query for Vue。
- 测试：go test、testify、testcontainers-go、Vitest、Playwright。
- 部署：Docker、Docker Compose。

## 开发命令

代码实现完成后，项目应支持以下标准命令：

```bash
go test ./...
cd web && npm run test
cd web && npm run build
cd web && npm run test:e2e
docker compose up --build
```
