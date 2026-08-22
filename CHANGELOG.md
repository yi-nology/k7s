# Changelog

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
