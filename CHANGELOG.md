# Changelog

## Unreleased

- **kubeconfig 导入解析/验证两阶段** — 导入不再止步于 YAML 解析：新增结构验证
  （k7s-core 共享模块，浏览器上传与桌面文件对话框双 shell 同行为）。Error 级
  阻止导入并逐条报告：文件无 context、cluster/user 引用悬空、cluster 缺
  `server`（kube 0.99 中该字段可缺，此前能静默通过导入直到 connect 才炸）、
  server 非合法 http(s) URL。Warning 级放行但随导入提示：current-context 悬空、
  https 无 CA 且未跳过 TLS 校验、user 无任何凭证（token/证书/密码/exec/
  auth-provider）。web 失败返回结构化 `{ok, error, issues}` 信封（issue 含
  severity/code/message/context），成功带 warnings；桌面 `import_kubeconfig`
  返回值升级为 `{contexts, path, issues}`（wire 变更，前端已同步）。前端此前
  导入失败页面零反馈——现 OnboardingWizard inline 区分「文件解析失败/校验
  失败」逐条展示，ClusterSwitcher 走错误 toast，成功带警告弹提示。MCP 的
  `import_kubeconfig` 工具同步接入同一验证（Error 拒绝并返回逐条汇总，
  Warning 随 `{contexts, path, issues}` 结果返回）——web / 桌面 / MCP 三条
  导入通道行为至此一致。
- **ChartOps 合并后加固（P2 评审跟进）** — MCP `helm_render_preview` 的 values 增加
  服务端安全校验（与前端 `isSafeHelmValues` 同策略：拒绝 go-template `{{…}}` 与反引号
  命令替换，下沉到 k7s-core 渲染入口，desktop/web/MCP 三通道统一拦截）；`local_chart_*`
  写操作审计从命令层下移到 k7s-core（成功才记录），MCP 的 package/deps 写入自此同样
  入审计；新增 `charts_dir` 共享 helper 去重两端 `<data_dir>/charts` 重复；审计日志
  改单次写入，防并发调用撕裂行。
- **本地 Chart 工具箱（ChartOps 整合 P2）** — 「本地 Charts」详情面板新增四个 helm CLI
  助手：Lint（`helm lint`，失败级问题走错误条、警告随输出展示）、Verify（`helm verify`
  校验的是签名 provenance——需 `.tgz` 旁有 `.prov` 文件，普通导入/打包的 chart 通常没有、
  调用报错属预期；仅 `.tgz` 可用，目录型被拒）、Package（`helm package`，仅目录型 chart，
  产物入库并刷新列表）、Dependencies（`dependency list` 离线查看；`build`/`update` 需
  网络从依赖仓库拉取，写 Chart.lock 与 `charts/` 缓存）。新增命令
  `local_chart_lint/verify/package/deps`——Package 与 Deps build/update 分别写
  `local_chart_package` / `local_chart_deps` 审计事件，只读操作不审计。MCP 工具面补齐
  `helm_local_charts` / `helm_render_preview` / `helm_lint_chart` / `helm_package_chart`
  / `helm_chart_deps` 五件套（工具总数 96 → 101，沿用 `/mcp` 既有 token 鉴权）。
- **评审跟进修复** — 回滚对话框默认选中上一 revision（`helm history` 最新在前，含
  currentRevision 修正）；仓库 chart 的 values 预填补上 `repo/` 前缀（此前 `helm show
  values` 按裸名解析必失败）；LocalCharts 详情/文件打开竞态守卫；Profiles 删除入口 UI；
  渲染预览 values 载荷安全校验；移除死命令 `helm_import_chart`/`helm_local_charts`（含
  market.rs 死函数）；Profile values 256KiB 上限；web auth flaky 测试以 ENV_LOCK 串行化；
  helm 操作失败的错误信息保留 stdout（`helm lint` 的 `[ERROR]` 明细行在 stdout，此前
  只回传 stderr 导致失败原因丢失）；回滚确认按钮文案不再双重前缀
  （此前渲染成 "Rollback to Rollback to #N"）。
- **本地 Chart 库增强（ChartOps 整合 P1）** — 「渲染预览」：详情面板内 `helm template`
  离线渲染清单（无需集群，按 kind 资源统计徽标）；「版本对比」：库内两版本的
  Chart.yaml + values.yaml 行级 diff；「升级已有 Release」向导模式（release/命名空间
  只读预填，确认步把离线渲染清单与集群当前清单做行级预览 diff——`helm template`
  输出与集群 manifest 的元数据差异属预期）；部署方案 Profiles：values/开关/超时
  参数集按 chart 保存与加载（`<data_dir>/helm-profiles.json`，审计
  `helm_profile_save`/`helm_profile_delete`）。
- **修复 helm 操作 wire 大小写不匹配**：HelmOp 参数此前按 snake_case 反序列化，
  前端 camelCase 传入的 `createNamespace`/`timeoutSecs`/`dryRun` 等开关被静默
  丢弃（P0 引入的缺陷）；运行载荷改为嵌套 `{op}` 结构，`RevisionEntry` 响应字段
  对齐 camelCase。web 端 helm 操作自此真实可用（陈旧的 notImplemented stub 已删）。

- **本地 Chart 库（ChartOps 整合 P0）** — Helm 页新增「本地 Charts」：上传/浏览/删除
  `.tgz` 与目录型 chart，查看文件树与 values，从本地包安装（helm 原生路径引用）；
  web 上传走 `/api/charts/upload`（认证 + 90MB 路由上限 + 50MB 业务上限）；
  helm install/upgrade 补 `--set`/`--atomic`/`--force`/自定义 `--timeout`/upgrade
  `--create-namespace`。

## v0.6.0 (2026-08-28)

以 2026-08-27 全库评审为依据的完整加固版本（P0 安全止血 → P3 MCP 工具面质量，详见 [docs/ROADMAP.md](docs/ROADMAP.md)）。

### 安全（P0）

- **`/mcp` 鉴权修复**：MCP 服务此前 merge 在鉴权 layer 之后（axum layer 不覆盖后 merge 的路由），未认证即可获得 exec/节点 shell/全量写能力；现随全部 API 一起要求 Bearer token，附 401 回归测试。
- `/api/events`（SSE，广播 shell 会话输出）与 `/api/status`（泄漏集群上下文）移出公开名单。
- AI 删除路径补 `ensure_writable`（Secrets/Helm 拒删）；`install.sh` 改为 SHA256 校验 + 仅移除 quarantine 属性（不再 `xattr -cr` 全剥）；compose 透传 `K7S_WEB_TOKEN`。
- AI describe/选中上下文默认脱敏 Secret；登录 5 次失败/60s 限速。

### 正确性防线（P1）

- **命令面四方对账测试**：`register_commands!` 宏 ↔ `COMMAND_NAMES` ↔ `#[tauri::command]` ↔ registry∪专用路由，"v0.5.2 漏 27 命令"这类回归结构上不可能复发；17 个 ai_* 与 5 个 grafana 命令 web 端补齐可达。
- CI 新增 iOS/Android/musl 交叉编译检查（iOS 本轮修复 keyring store feature 与 kube 模块 cfg 缺口后通过）。
- 危险操作审计日志（`audit.log` JSONL）；AI 沙箱真实加载配置（规则/预设/限流此前全部无效）；helm 临时 kubeconfig RAII（0600+自动删除）；前端 SSE 断线重连。

### 收敛修坏（P2）

- **cron 定时任务真实可用**：表达式解析 + 60s 调度循环 + headless 执行器（写操作无人值守一律拒绝，web 端强制 ReadOnly）。
- LLM 客户端超时；上下文压缩不再拆散 tool_call 配对（原实现必触发 provider 400）；网络策略模拟完整支持 matchExpressions（原对 expression-only 选择器误报"允许"）；grype SBOM 修复；session 并发覆写与知识库无限膨胀修复；配置路径支持 XDG。
- 镜像导入/导出修复（exec 容器名此前传错必 400）。

### MCP/AI 工具面（P3）

- 工具错误结构化 `{error, hint, retryable}`——模型可自纠（未连接→提示先 connect、NotFound→提示先 list、权限→标记不可重试）。
- `list_resources` 分页（limit/continueToken，默认形状向后兼容）。

### 其他

- **k7s-web 内置 TLS**：`--tls-cert/--tls-key`（或容器环境变量 `K7S_TLS_CERT/_KEY`）直接以 HTTPS 服务，无需反代；compose/DOCKER.md/env.example 配套。
- **移动端**：iOS/Android 目标修复到可编译并由 CI 门禁（cross-targets job），移动壳定位实验性；发布流水线待建。
- 首次上线 hub 装配式 CI：从 8 个子仓组装 workspace 跑全量验证（fmt/clippy/测试/对账/版本一致性/三端交叉检查）。
- 前端质量三件套：ErrorBoundary 下沉面板级、AiChat busy 状态复位、LogsTab 高亮对齐。

## v0.5.2 (2026-08-24)

- **修复 Web 模式 27 个命令 404**（v0.5.0 引入的回归）：命令注册表在重构时漏掉了流式与配置类命令——日志流、Pod 终端/shell、连通性模拟、Helm 仓库管理、指标/告警/Loki/保存查询配置、镜像仓库 CRUD、image_copy 等。全部补齐并经真实集群浏览器实测（日志渲染、终端交互、Helm 市场加载）。
- 同步修复：24 个纯配置命令改为 `cfg_attr(ipc, tauri::command)` 双态定义——ipc 模式是 Tauri 命令，web（no-ipc）模式是普通函数，两种构建形态都正确导出。
- 前端主题修复（v0.5.1 后续）：14 个未定义 CSS 变量（`--bg-card`、`--fg`、`--danger` 等）在三个调色板块补齐别名，运维工具卡片白块及 AI/编辑器/告警表单的主题失效一并消除。

## v0.5.1 (2026-08-22)

- **k7s-web 服务器自适应**：启动时检测主机浏览器（Linux 检查图形会话 + chrome/chromium/firefox 等，macOS 检查 .app，Windows 检查 chrome/edge）。无浏览器的服务器/无头主机自动跳过打开并打一条 info 日志，`--no-open` 仍是显式覆盖。
- 构建：k7s-web（musl 静态版）彻底不含 tauri（`ipc` feature 化），Docker/静态构建恢复稳定。
- 清理 web/mcp feature 路径下的存量 clippy 告警，`clippy -D warnings` 全 feature 通过。

## v0.5.0 (2026-08-22)

结构重构版本：代码重组为"独立仓 + 统一命令面"架构，功能语义保持不变。

### 架构

- **k7s-commands 成为正式 crate**：全部 `#[tauri::command]` 集中一处（此前散落在三个平台 shell 中以 include! 拼接，约为 70-85% 的三重复制）；平台差异用 `#[cfg(target_os)]` 表达，`register_commands!()` 宏在三个 shell 展开。desktop/ios/android shell 分别瘦身至 3.2k / 64 / 71 行。
- **CommandRegistry 命令接缝**：`k7s-core` 新增传输无关的命令注册表；Web 端 `POST /api/invoke/{cmd}` 改为查表分发，与 Tauri IPC 共用同一实现（94 个非 AI 命令）。新增命令从"写两处"变为"写一处"。
- **k7s-server 模块化**：`mcp/server.rs`（2,633 行）拆分为 `tools/{cluster,shell,observability,security,helm,pod,image,workload}`；web handlers 拆分出 `ai_handlers` 与 `hook_handlers`。
- **k7s-core kube/ 目录重组**：45 个平铺文件归入 `helm/`、`image/`、`security/`、`observability/` 四个域目录，`ResourceKind` 与事件常量提取为独立模块。
- **依赖治理**：修复三 shell 锁定 k7s-core 0.3.8 而本地为 0.4.2、k7s-deps 双 rev、rmcp 版本分裂等漂移；各仓 manifest 独立可构建，本地聚合开发可用 `[patch]` workspace。

### 功能

- `k7s-web --version` 与 `GET /api/version`（鉴权后）报告版本；设置面板页脚显示应用版本。
- 修复 Android shell handler 列表引用已排除模块导致的潜在编译失败。

### 前端

- 新增 `useProviderQuery` hook（TTL 缓存），13 个面板移除手写加载/错误样板。
- `TopologyGraph`（812 行）拆分为 Edges / Nodes / Overlays / Inspector 四个组件。
- 为 ai / imagetransfer / editor 目录新增 10 个测试文件（前端测试总数 1,356）。

### 测试

- Rust：380+ 单元测试 + web_api 集成测试 28 个（含命令注册表分发用例）。
- `cargo clippy --workspace --all-targets -- -D warnings` 零告警。

## v0.4.2 及更早

见各仓 git 历史。
