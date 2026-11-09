# Go 压缩依赖安全维护验收

## 最终交付（2026-11-09）

已通过 [PR279](https://github.com/TomyJan/MoeURL/pull/279) 正常 exact-head squash 合并为 master `636cefd6f4b38cec884f6658807044279728c0c3`。最新候选 `0ef695bbc57e9656c4b32846968949c8f8f57483` 已真实 kind=reviewed／source=covered，CodeRabbit check129115147206 completed/success；完整讨论3评论／0review／0thread、全部分页完整，无actionable请求及待处置问题，14项additional均LGTM。语言工具的量词提示仅为技术简写风格，不是新修复请求；本维护无延期Minor。

独立PR与commit API及正常fetch核实SHA、tree `37df23f4dad14079f3ff72a0dbb8333dc9428998`和唯一父 `ca0b12a26ba90c442ccb18f8d20c59a96aa69860`。Task1–3均标准完成；18条完整裁决、10个owned文件whole ZIP／extract／recovery逐hash核同，准确leaf可恢复迁出，siblings／branch／worktree保留。ZIP29557bytes，SHA256 `A4FEF386DC80C2969796751DE22C82C46B7F1B96C217110E26751990E8944F78`。原件保持私有边界，不公开本机环境raw。

不等待或伪称GitHub CI，不声称master新执行套件或正式发布部署。以下为本地验证与送审前的原阶段记录，原执行SHA、运行时、失败和复用边界不改写。

## 送审前阶段记录

基线 master ca0b12a26ba90c442ccb18f8d20c59a96aa69860。正式三文件更新已提交8f1cfd93，本地验证与唯一独立终审C0/I0/M0通过、Task1–2标准完成；最新提交CodeRabbit及远端交付仍未完成。复用准备结果按原执行归属记录，不冒重新运行。

- [x] 新 master 全 1390 输入与原准备基线逐 bytes／SHA256 相同，25 份原件 hash 核实。
- [x] 独立压缩行为两项真实 RED→GREEN；候选完整后端、vet、source 扫描；准确 hardened Goose 扫描和隔离迁移准备。
- [x] 正式三文件依赖变更与精确当前输入合同。
- [x] 新完整产品身份、实际模块版本、正常 freshness 三目标所选 HIGH／CRITICAL 验证与清理。
- [x] 唯一整分支终审，Critical0／Important0／Minor0，无修复请求。
- [ ] 最新 head CodeRabbit 真实覆盖及有效问题处置。
- [ ] 正常守卫合并、独立身份核验、标准任务完成与可恢复归档。

## 已有准备证据与适用范围

主模块准备快照在 Go 1.26.10 Windows／GOPROXY=https://goproxy.cn、GOSUMDB=sum.golang.org、GOWORK=off 下标准生成。`go test -p=2 -count=1 ./...` 为 18 测试包及 2 无测试包通过，`go vet ./...` exit0，完整输入稳定，测试容器前后空。全模块 `go run golang.org/x/vuln/cmd/govulncheck@v1.8.0 -json ./...` 完整解析 291 对象：called0／imported0／required1，仅 x/crypto GO-2026-5932；数据库更新时间 2026-11-05T23:49:57Z，不能称无漏洞。

独立上游边界原件证明 compress1.20.1 的复用 FSE 表溢出会 panic、Huffman tableLog7 未拒绝；1.20.2 两项通过。不把上游重复测试加入产品测试树。旧 Goose binary-mode 的受影响符号存在，不证明实际 PG 入口可达；hardened Goose3.28.0／compress1.20.2／brotli1.2.7／xnet0.62.0／Go1.27.3 的新扫描 296 对象只有原 required1。隔离 PG18-alpine、internal 网络、无发布端口，真实 Up35→status→Down35→Up35→status exit0、自有资源清理完成。构建首行 Docker pipe HTTP2 警告、首次误查不存在 postgres:18 和初次 PowerShell argv 拆分错误均保留，不冒产品回归或零警告。

## 正式本地验证

8f1cfd93的ignored产品快照实际执行 `docker build --progress=plain --tag moeurl:go-compression-security --build-arg MOEURL_BUILD_COMMIT=8f1cfd93dfa446b3667b4d9a4142bf556a54e5d1 --build-arg MOEURL_BUILD_TAG= --build-arg HTTP_PROXY=http://host.docker.internal:7890 --build-arg HTTPS_PROXY=http://host.docker.internal:7890 .`，exit0／1395输入稳定，新镜像sha256:4a003a6f0a43bfe939d37e03e7d0f67556611c4c1942895e1b9eeefcdb4d328d。Go1.27.3、Node26.5.1、Vite8.3.5；新footer确认为V0.51.1-8f1cfd9及完整源码URL。仅本地下载例外：官方Node33410380bytes精确SHA256 CC7B3484ADE63BD203A9D304F21EC37A3B622B988D7BDECF1DC4D68FC44A91B7，通过回环私有传输并在构建内校验；curl预算900秒及模块下载进程GOPROXY=https://goproxy.cn。原版本、TLS、GOSUMDB及测试超时不改，不冒原下载路由已通过。实际缓存命中保留，临时server已清理。

准确提取app21420624bytes／SHA256 B9159C3AB94A92A71E7567F69A9899A7805986634CF04E0D49D5A9A7CF3ACA48与旧产品全同；Goose60624318bytes／SHA256 1B1FD8D219CBE28A5C8572C4F5C38327E4BBDC954D4202051227194B0DEC28C0与准备制品全同。实际Goose3.28.0／compress1.20.2／brotli1.2.7／xnet0.62.0，app未引入compress／brotli；据准确bytes和不变migration输入复用原binary扫描及全新Up至35→仅回退第35项→再次Up至35，不声称全部历史迁移Down至零。

新标准 `bash --noprofile --norc scripts/compose-smoke.sh` 在同产品快照执行exit0／输入稳定，Node26.3.0，显式MOEURL_SMOKE_HTTP_PORT=18143及源码Git身份；完成初始化、登录、短链访问和重启断言，自有容器／卷／网络全清。Compose产物sha256:1909715af04792473325ffba9c4c7e90bdc6e42df1f010614be1f19967e20472与构建镜像九层和全部执行Config精确相同，仅三个Compose标签不同，两ID保留。新Trivy0.74.0对准确4a003a6f镜像正常freshness扫描exit0，Alpine/app/goose三目标所选HIGH／CRITICAL均0；DB UpdatedAt2026-11-09T00:56:17.155719746Z／NextUpdate2026-11-10T00:56:17.155719496Z，OS EOL表／severity来源／新版工具警告保留。原x/crypto required-only不隐藏。

当前全993非Markdown输入与原前端3509项／四100、types/lint证据仅三个依赖路径不同；完整220浏览器另有前版已具名deployment测试literal差异。真实应用与UI源码不变，app精确相同，私有合同逐hash核所有原proof/raw/exit和允许差异，复用而不冒本提交重新执行。唯一终审独立核上述全集和原始扫描数据，通过且无新finding；九项未判断边界逐条裁决保留在私有完整报告。

## 公开摘要与私有原件

本文件是新克隆可读的公开验收摘要。[计划](2026-11-09-go-compression-security-plan.md)说明复用和新验证要求。完整 raw、物理输入清单、退出码、裁决及归档保留在维护者本机 ignored 证据中，新克隆无法直接访问，也没有随源码公开的承诺；可按授权脱敏提供。既有准备原件由本地 `next-maintenance-preparation-contract.json` 的 25 项 hash 固定；正式维护另有独立合同，不覆盖旧原件。

CI 不作为等待条件，不冒称其通过；无发布部署。前版 v0.51.1 已通过 PR278 完成审查、正常合并与可恢复归档，见[前版验收](v0.51.1-acceptance.md)。
