# Go 压缩依赖安全维护实现计划

> 使用 executing-plans 内联执行；复用准确准备证据，不派 builder 或逐任务审查。最后一次独立整分支终审。用户已授权无人值守设计与正常交付。

**目标：** 修复主模块及迁移工具的压缩依赖公告，不改业务行为或产品版本。

**架构：** 主模块单字段与校验和更新；Dockerfile 独立 Goose 模块两个 pin。所有公开状态与私有原件分开。

**技术栈：** Go 1.26.10 本地、Go 1.27.3 Linux 构建、Goose 3.28.0、PostgreSQL 18、govulncheck 1.8.0、Trivy 0.74.0。

**规格：** [范围](../product/scope-2026-11-09-go-compression-security.md)、[设计](../specs/2026-11-09-go-compression-security-design.md)。

## 全局约束与文件

基线 ca0b12a26ba90c442ccb18f8d20c59a96aa69860；复用现有隔离 worktree。修改 go.mod、标准生成 go.sum 和 Dockerfile；新增维护 scope／design／plan／tasks／acceptance，更新产品入口、技术文档及前版验收状态。无产品源码／测试修改、无版本号变化。证据 `.tmp/go-compression-security-evidence`；原 `.tmp/v0511-evidence` 冻结原件不覆盖。不等待 CI，不发布部署，不删 branch/worktree，不触未知资源。

## 审查重点

1. Goose 独立模块是否实际解析到两个安全版本，而非只更新主模块：核新二进制 buildinfo 与扫描。
2. app 是否引入原本仅测试需要的 compress：核生产依赖图与精确 app bytes。
3. 更新后 PG 迁移是否可正常全新 Up、Down、再次 Up：消费准确 Goose 的隔离迁移和清理证明。
4. 前端／浏览器复用是否误借不同源码：核完整集合、hash／bytes 与具名允许差异，不冒重跑。
5. 扫描 exit0 是否掩盖 required-only 或未验证环境：解析全部 finding 并保留实际数据库、目标、工具和 CI 边界。

## Task1：依赖与精确本地合同

**Interfaces：** 消费 master 全集与冻结准备原件，输出唯一三文件依赖差异及本地复用合同。

- [x] 标准 start1、读 brief；核全 1390 基线及 25 原件，读取两项真实 RED→GREEN，禁止重跑成功 suite。Expected：baseline-contract exit0。
- [x] 用已由标准模块工具生成的两文件 patch 更新 go.mod／go.sum，Dockerfile 追加两 pin；核完整候选后端输入逐 hash／bytes 相同。Expected：仅三个非 Markdown 路径变化，完整后端／vet／source 扫描证据身份吻合。
- [x] 同步公开访问边界、前版交付状态和技术基线；diff check、原子提交、standard done1 运行私有 verifier。Expected：证据 hash 与当前输入全核通过，不伪造 suite 重跑。

## Task2：准确产品与唯一终审

**Interfaces：** 消费 Task1 三文件和旧产品输入合同；输出新完整镜像、差异复用证明与整分支审查处置。

- [x] 新完整产品构建，读取实际 app／Goose；app 等同旧产品、Goose 等同 hardened 准备时才复用对应原验证。Expected：新镜像构建0，所有执行内容与新输入身份核实。
- [x] 准确新产品正常 freshness Trivy 三目标及实际运行／迁移清理；准备迁移只有 Goose／migration hash 全同才能复用。Expected：所选 HIGH／CRITICAL0，保留 required-only 和警告；无未知资源操作。
- [x] 唯一 fresh 整分支终审，有效 Important 用真实回归修复，Minor 延期；完整报告与 standard done2。Expected：无有效阻断项。

## Task3：真实审查与正常集成归档

**Interfaces：** 消费 Task2 合同，输出精确 head 审查、正常合并和可恢复归档。

- [x] 同名 push、单次建 PR；读完整有效讨论及明确额度窗口，最新 head 必须 reviewed／source=covered。Expected：有效问题处置完成，不重复 request、不把 skipped 当 running。
- [x] 正常 exact-head squash，独立 API／fetch／SHA／tree／唯一父。Expected：保护不绕过，CI 未验证不改写。
- [x] 完整报告、standard done3、whole-owned ZIP／extract 全核，准确 leaf 可恢复迁出。Expected：siblings／branch／worktree保留，继续下一合理增量。
