# 前端开发依赖安全维护验收

2026-10-27：从实际合并的 `6933f94c` 创建独立分支 `fix/frontend-security-dependencies`，完成公告与当前解析路径的只读核验，尚未更新依赖或声明回归通过。本维护不新增产品版本；package 保持 0.25.0。

GitHub 4 条 development 公告及实际 `pnpm why` 已确认，分别为 Vitest mocker 5.0.0、magicast 路径的 source-map-js 1.2.1、Vue test-utils／js-beautify／config-chain 路径的 ini 1.3.4。生产可达性与开发依赖公告分开记录；现有 production 扫描不替代本轮新依赖镜像验证。

- [x] 独立分支、实际基线与公告路径核验。
- [ ] 原始 audit 与最小补丁解析。
- [ ] frozen-lockfile、完整前端／四项 100%、静态及隔离构建。
- [ ] 完整真实 Playwright、新 production smoke 与精确镜像扫描。
- [ ] 上一版合并及各入口状态同步。
- [ ] 独立终审、有效修复、原子提交。
- [ ] 本轮最新 PR CI／实际 CodeRabbit／合并。
- [ ] 合并后 CI 后台跟进。

证据目录：`D:/Dev/TomyJan/MoeURL/.tmp/frontend-security-20261027/`。上一版原始 CI／CR／合并证据仍在 `v025-evidence/`；不将其写成本维护依赖更新后的验证。
