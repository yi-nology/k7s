# Changelog

## v0.6.0 (未发布)

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
