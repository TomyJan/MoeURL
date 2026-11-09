# Go 压缩依赖安全维护验收

基线 master ca0b12a26ba90c442ccb18f8d20c59a96aa69860。当前正式维护刚启动，以下准备结果不是新提交重新执行，完整产品和远端交付仍未完成。

- [x] 新 master 全 1390 输入与原准备基线逐 bytes／SHA256 相同，25 份原件 hash 核实。
- [x] 独立压缩行为两项真实 RED→GREEN；候选完整后端、vet、source 扫描；准确 hardened Goose 扫描和隔离迁移准备。
- [ ] 正式三文件依赖变更与精确当前输入合同。
- [ ] 新完整产品身份、实际模块版本、正常 freshness 三目标所选 HIGH／CRITICAL 验证与清理。
- [ ] 唯一整分支终审、最新 head CodeRabbit 真实覆盖及有效问题处置。
- [ ] 正常守卫合并、独立身份核验、标准任务完成与可恢复归档。

## 已有准备证据与适用范围

主模块准备快照在 Go 1.26.10 Windows／GOPROXY=https://goproxy.cn、GOSUMDB=sum.golang.org、GOWORK=off 下标准生成。`go test -p=2 -count=1 ./...` 为 18 测试包及 2 无测试包通过，`go vet ./...` exit0，完整输入稳定，测试容器前后空。全模块 `go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 -json ./...` 完整解析 291 对象：called0／imported0／required1，仅 x/crypto GO-2026-5932；数据库更新时间 2026-11-05T23:49:57Z，不能称无漏洞。

独立上游边界原件证明 compress1.20.1 的复用 FSE 表溢出会 panic、Huffman tableLog7 未拒绝；1.20.2 两项通过。不把上游重复测试加入产品测试树。旧 Goose binary-mode 的受影响符号存在，不证明实际 PG 入口可达；hardened Goose3.28.0／compress1.20.2／brotli1.2.7／xnet0.62.0／Go1.27.3 的新扫描 296 对象只有原 required1。隔离 PG18-alpine、internal 网络、无发布端口，真实 Up35→status→Down35→Up35→status exit0、自有资源清理完成。构建首行 Docker pipe HTTP2 警告、首次误查不存在 postgres:18 和初次 PowerShell argv 拆分错误均保留，不冒产品回归或零警告。

## 公开摘要与私有原件

本文件是新克隆可读的公开验收摘要。[计划](2026-11-09-go-compression-security-plan.md)说明复用和新验证要求。完整 raw、物理输入清单、退出码、裁决及归档保留在维护者本机 ignored 证据中，新克隆无法直接访问，也没有随源码公开的承诺；可按授权脱敏提供。既有准备原件由本地 `next-maintenance-preparation-contract.json` 的 25 项 hash 固定；正式维护另有独立合同，不覆盖旧原件。

CI 不作为等待条件，不冒称其通过；无发布部署。前版 v0.51.1 已通过 PR278 完成审查、正常合并与可恢复归档，见[前版验收](v0.51.1-acceptance.md)。
