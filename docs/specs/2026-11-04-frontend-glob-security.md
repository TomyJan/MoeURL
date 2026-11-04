# 前端 glob 工具链安全维护

## 目标与事实

在已验证 master `6aa7c0aa5a805446fae16e7d8453388763081f23` 上修复开发依赖的两个中等级别公告，保持 v0.48.0 行为和版本号。基线官方 `pnpm audit --json` 实际 exit 1：425 个依赖，2 moderate、0 high、0 critical；完整原件在外置 v048-evidence 的 next-minimatch-baseline-audit.log，SHA256 `F4CFDFD3E7725F8D85D21E6581AA59AB0F1F10A2DD34278DC0F5A724506844F8`。这是依赖安全诊断，不是产品行为 RED。

| 公告 | 实际版本与问题 | 安全下限 |
| --- | --- | --- |
| GHSA-g3hv-75wg-m249／CVE-2026-118764 | minimatch 10.2.6，恶意 glob 在高优化等级下放大 CPU／内存，46 条路径。 | 11.0.1 |
| GHSA-3g3m-2fjr-6pw4／CVE-2026-118773 | glob 13.0.6，取消后仍继续遍历，一条路径。 | 14.0.2 |

reachability 未启用，不宣称可达或不可达。产品 HIGH／CRITICAL 镜像扫描不能代替完整开发依赖 audit。

## 方案与取舍

普通兼容解析无法消除全部路径；上游实际父节点仍限制旧主版本。选择 pnpm workspace 根的精确父版本覆盖，避免全量升级。新版本为 minimatch 11.0.2、glob 14.0.3；glob 14 自带 minimatch 11。四个直接 minimatch 父节点与一个 glob 父节点为：

```yaml
overrides:
  '@eslint/config-array@0.23.5>minimatch': 11.0.2
  '@typescript-eslint/typescript-estree@8.72.1>minimatch': 11.0.2
  'editorconfig@3.0.2>minimatch': 11.0.2
  'eslint@10.14.0>minimatch': 11.0.2
  'js-beautify@2.0.3>glob': 14.0.3
```

保留 allowBuilds。锁文件仅由标准 pnpm 11.5 生成，完整 frozen 安装后检查全部路径，不能只看配置文本。父包以后升级时须重新检查覆盖是否仍匹配，上游原生支持安全版本后移除不必要覆盖。

minimatch 11 删除 makeRe、AST、matchOne、regexp、slashSplit 等 API，set 段类型也变化；glob 14 引入 path-scurry 3。旧真实父调用的静态预查未见删除接口直接调用，但不能证明动态调用和语义兼容。真实 lint、类型检查、完整测试、浏览器和产品构建是必要门禁。

Dockerfile 首次 frozen install 前同时 COPY package.json、pnpm-lock.yaml 和 pnpm-workspace.yaml，确保标准构建读取同一覆盖合同。安装的构建脚本策略、镜像版本、运行身份、端口保持原约定。

## 范围与安全边界

仅修改 workspace、标准生成 lock、Dockerfile 和准确文档。不改业务行为、后端、API、权限、schema、迁移、Go 模块、覆盖率阈值或测试排除；不夹带旧 M5／M9 重构。若出现真实兼容缺陷，先定位与记录，行为修复必须先有真实失败回归。

唯一源码继续使用既有隔离工作区，分支 `fix/frontend-glob-security`；外置输出目录 `.tmp/frontend-glob-security-20261104`。不安装宿主依赖、不改全局 registry、不清空 Docker、不触 PR240、日常 18080 或其他资源，不发布部署。

## 验收

1. 标准 lockfile-only 解析及新镜像 frozen 安装成功；完整 list／why 无目标受影响副本，官方 audit 中两个 GHSA 消失，其他公告按实际记录。
2. 新依赖真实 lint／types、完整前端测试与四项 100%、隔离 build 成功，不禁规则或改期望隐藏主版本兼容问题。
3. 完整 187 项浏览器、新产品 smoke／restart／版本／精确镜像扫描通过；源输入稳定、准确 owned 资源收尾。截图按实际原图检查。
4. Go／SQLC 仅在完整对应输入一致时复用原身份；Dockerfile 已变，不能借旧产品制品。
5. 末段唯一独立整分支审查，最新候选真实远端覆盖及有效问题闭环，候选／master 各九 CI 和完整日志、守卫合并、标准任务、完整报告及可恢复归档完成。未取得的结果保持未验证。
