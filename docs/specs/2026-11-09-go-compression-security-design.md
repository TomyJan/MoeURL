# Go 压缩依赖安全维护设计

## 目标与依据

对已验证的 master 做最小依赖修复。GO-2026-6865 的 compress 修复版为 1.20.2；Goose 二进制另有 GO-2026-6888，brotli 修复版为 1.2.7。生产入口、全模块 source 扫描和 binary-mode 的符号存在是三种证据，不能混作实际业务可达性。

选择三个精确版本更新，优于升级 Goose、testcontainers 或工具链的大范围变更。主模块通过标准 `go mod edit -require=github.com/klauspost/compress@v1.20.2`、`go mod tidy` 生成；独立 Goose 构建在已有 x/net pin 后执行 `go get github.com/klauspost/compress@v1.20.2 github.com/andybalholm/brotli@v1.2.7`。无业务代码或数据库变更。

## 证据与风险控制

基线全 1390 输入及 25 份准备原件已逐 bytes／hash 核同。两项真实压缩行为旧版失败、新版通过；候选完整后端 18 包及 2 无测试包、vet 和 source 扫描已完成。准备中的 Linux stage 与实际 Goose 扫描及 Up35→Down35→Up35 属原执行，不写成当前提交的重新运行。

正式维护核源码差异仅 go.mod、go.sum、Dockerfile；源码、迁移、前端和原有部署测试不变。完整产品必须有新镜像身份；核 app 与原产品二进制全等、Goose 精确模块版本，验证正常 freshness 的三目标所选 HIGH／CRITICAL，及实际迁移／清理。已有 stage 的 Goose 只有在提取的新产品二进制 hash 相同时才可复用原二进制扫描和迁移结果。

本地构建仅允许已验证的下载路由例外：进程 GOPROXY=https://goproxy.cn；官方 Node 26.5.1 原始包的精确 SHA 校验与本地传输。不得关闭 TLS、checksum 或扩测试超时，实际有效 Dockerfile 与仓库文件分别记录。原失败不改写为通过。

保留 x/crypto GO-2026-5932 的 required-only 提示，不声称无全部漏洞。回退三个依赖变更可恢复原构建，但会重新引入已知公告，不能静默降级。没有 schema 或用户数据回退操作。

## 记录访问边界

公开验收摘要提交在[本维护验收](../implementation/2026-11-09-go-compression-security-acceptance.md)，含命令、运行时、实际结果和限制。原始日志、完整物理输入、截图及裁决放在本地 ignored 证据与可恢复归档中，新克隆不能直接读取；需要独立重现时按公开命令执行。维护者可按授权提供脱敏原件，不将本机路径或环境 raw 自动公开。
