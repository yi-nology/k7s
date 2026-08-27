# k7s P0–P3 演进路线实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 2026-08-27 全库评审结论，一次性落地 P0 安全止血 → P1 正确性防线 → P2 收敛修坏 → P3 MCP 质量的全部工作项。

**Architecture:** k7 是 9 个独立 GitHub 仓的本地聚合 workspace（`crates/k7s-*` 为 subtree 组装，根 `Cargo.toml` 用 `[patch]` 重定向 git 依赖）。命令面三层：`k7s-commands/src/lib.rs` 的 `register_commands!` 宏（Tauri IPC，168 条）→ `crates/k7s-commands/src/registry.rs` 的 `CommandRegistry`（122 条，web `/api/invoke/{cmd}` 用）→ `k7s-server/src/web/server.rs` 的 ai_handlers 专用路由（23 条）。业务实现全部下沉 `k7s-core` 的 `xxx_impl`，三端共用。

**Tech Stack:** Rust (axum/tauri/kube-rs/rmcp) + React 19 + TypeScript + vitest + GitHub Actions。

## Global Constraints

- 所有改动只在本地 k7/ 聚合仓进行，**不 push、不动 GitHub 远端仓**（subtree 推送由用户执行 `make sync-repos`）。
- 在分支 `evolution/p0-p3` 上工作，每任务一 commit；main 不直接动。
- 每个行为修复必须带回归测试（评审结论：/mcp 漏洞存活的根因是关键路径零测试）。
- wire 参数保持 camelCase；`*_impl` 签名尽量不变（三端共用）。
- `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings` 必须过；前端 `pnpm typecheck && pnpm lint && pnpm test -- --run` 必须过。

## 已核实现状（2026-08-27，HEAD=03d234f）

- **已被未提交修复覆盖**（工作区 `server.rs`/`auth.rs`/`web_api.rs` 已改，含回归测试）：评审 #1 `/mcp` 绕过鉴权（merge 已移到 layer 前）、#2 `/api/events` SSE 公开（public 名单已收口）。本计划 T0 验证后保留。
- **确认仍在**：#3 AI describe/context 明文外发 Secret（`ai/tools/impls.rs:55-66`、`ai/context.rs:63-95`）；#4 `delete_resource_impl` 无 `ensure_writable`（`impls.rs:272-284`）；#5 沙箱死配置（`agent.rs:250` 恒 default；`sandbox.rs:134-137` arg_pattern 子串匹配 `namespace=kube-system` 永不命中 JSON 文本）；#6 `agent.rs:870` `&compact[..500]` 多字节 panic；#7 镜像导入/导出把 pod 名当 container 名（`import.rs:221`、`export.rs:264,346`，容器真名 `nodeshell.rs:162` 是 `"debug"`）；#8 helm 临时 kubeconfig 永久残留（`helm/ops.rs:400-417`，无删除、先 0644）；#9 移动端 cfg 错位（`storage.rs:7-8` 的 cfg 贴在 doc/Args 上、`*_impl` 未 gate；`registry.rs:308-341` 无条件引用 android-gated 类型）；#10 SSE done 不重连（`transport.ts:197`）。
- **对账事实**：宏 168 = `#[tauri::command]` 168（一致）；registry 122；**17 个 ai_* + 5 个 grafana_* 命令 web 端不可达**（无 registry 条目也无专用路由）；`CommandRegistry::register` 重名静默覆盖（`core/commands.rs:47`）；CI 无 iOS/Android/musl check。
- **P2 事实**：cron `due_tasks`/`record_run` 全仓零调用（任务永不执行，`due_tasks` 还是假的"超 1 小时就跑"）；grype SBOM `-o cyclonedx` 是非法 flag 必败且解析字段错（`sbom.rs:302-399`；注意 `image/scan.rs:447-621` 的 grype 漏洞扫描是好的，别误伤）；netpol `matchExpressions` 完全未处理且误放行（`netpol_sim.rs:340-412`）；LLM 客户端零超时（`llm/openai.rs:38`）；`context_compress.rs:101-131` 只删 tool result 不删 tool_calls → provider 400；session 每请求新建实例整文件覆写（`session.rs:49,101-112`）；knowledge_sync 无去重无上限每次重连全量重灌（`knowledge_sync.rs:24-112` + `memory.rs:131-143`）；7 处 config_path 只认 $HOME（audit.rs:45 / metrics_config.rs:76 / grafana.rs:73 / alerting.rs:59 / image/repo.rs:122 / saved_queries.rs:44 / ai/mod.rs:65）；`browser.rs:88-102` 闭合标签把 skip_content 又设回 true，整页正文被丢。

---

## Phase P0 — 止血

### Task 0: 基线

**Files:** 无新文件。

- [ ] `git checkout -b evolution/p0-p3`（未提交改动随行）
- [ ] `cargo test -p k7s-server --features web --test web_api` — 验证工作区里未提交的 /mcp、/api/events 修复测试全绿
- [ ] `cargo test --workspace` 记录基线（只记录，失败项若与本计划无关则保持原样）
- [ ] Commit 工作区已有修复：`git add -A && git commit -m "fix(security): /mcp behind require_token + /api/events off the public list (regression tests included)"`

### Task 1 (P0-3): delete_resource_impl 走 ensure_writable

**Files:**
- Modify: `crates/k7s-core/src/ai/tools/impls.rs:272-284`
- Test: `crates/k7s-core/src/ai/tools/impls.rs`（文件尾 tests 模块，若无则新建）

- [ ] 在 `delete_resource_impl` 取得 client 后、`dynamic_api` 前插入 `shell_common::ensure_writable(kind)?;`（与 `apply_manifest_impl:309` 同款）
- [ ] 测试：`delete_resource_impl(&manager, "secrets", "ns", "x")` 断言错误信息含 "editing Secrets is disabled"、`"helm"` 含 "Helm releases are read-only"（构造 ClientManager 未连接即可，ensure_writable 在 client 获取之后？——注意顺序：当前第一行就 `manager.client()`，未连接返回 Disconnected 会挡住断言；把 `ensure_writable` 放在 client 获取**之前**，纯函数先校验，错误更早暴露）

### Task 2 (P0-4): 多字节切片 panic

**Files:**
- Modify: `crates/k7s-core/src/ai/agent.rs:866-871`
- Test: 同文件 tests 模块

- [ ] 把 `format!("{}…", &compact[..500])` 改为字符边界安全截断：
```rust
let head: String = compact.chars().take(500).collect();
summaries.push(format!("{head}…"));
```
- [ ] 抽成可测函数 `fn truncate_chars(s: &str, n: usize) -> String`（放 agent.rs 或 util），测试：纯中文 1000 字符输入不 panic、长度 ≤ 500 chars + "…"、ASCII 与混合边界

### Task 3 (P0-5): install.sh 校验和 + compose 透传

**Files:**
- Modify: `deploy/install.sh:110-113,215-218`
- Modify: `deploy/docker-compose.yml:15-27`
- Modify: `.github/workflows/release-desktop.yml`（产物步骤追加 .sha256）

- [ ] install.sh：下载后请求 `${url}.sha256`，存在则 `shasum -a 256 -c`（Linux 用 `sha256sum`，检测命令存在性），不存在则 `warn` 提示未发布校验和并继续；校验失败 `die`
- [ ] install.sh:112：`xattr -cr /Applications/k7s.app` → `xattr -d com.apple.quarantine /Applications/k7s.app`，并打印一行说明（只移除隔离属性、不剥其它扩展属性）
- [ ] release-desktop.yml：在 upload artifact 前对每个产物 `shasum -a 256 > <artifact>.sha256` 并一同上传
- [ ] docker-compose.yml：environment 增加 `- K7S_WEB_TOKEN=${K7S_WEB_TOKEN:-}`；注释改为"k7s-web 有 bearer token/密码会话门禁；跨主机暴露请设置 K7S_WEB_TOKEN 并置于反代后"
- [ ] `bash -n deploy/install.sh` 语法检查

---

## Phase P1 — 防线

### Task 4 (P1-1a): CommandRegistry 重名即 panic

**Files:**
- Modify: `crates/k7s-core/src/core/commands.rs:39-47`
- Test: 同文件 tests 模块

- [ ] `register` 开头插入：
```rust
if self.handlers.contains_key(name) {
    panic!(
        "CommandRegistry: duplicate registration for `{name}` — the second \
         handler would silently shadow the first. Remove one of the two \
         `register(\"{name}\")` call sites."
    );
}
```
- [ ] 测试：`#[should_panic(expected = "duplicate registration")]` 注册同名两次；正常注册不 panic；`names()/len()` 不变

### Task 5 (P1-1b): 对账机制 + 22 个不可达命令修复

**Files:**
- Modify: `crates/k7s-commands/src/lib.rs`（宏后加 `pub const COMMAND_NAMES`）
- Create: `crates/k7s-commands/tests/reconciliation.rs`
- Modify: `crates/k7s-commands/src/registry.rs`（注册 grafana 5 命令；android/iOS gating 见 T6）
- Modify: `crates/k7s-server/src/web/ai_handlers.rs` + `server.rs`（补缺失 ai_* handler/路由，或走 registry）
- Create: `crates/k7s-server/tests/reconciliation.rs`

- [ ] `COMMAND_NAMES: &[&str]`：从 lib.rs 宏列表抄全 168 个（含既有 cfg 注释行不进常量）
- [ ] `k7s-commands/tests/reconciliation.rs` 三个测试：
  1. **const ↔ 宏列表**：`include_str!("../src/lib.rs")` 用 regex 抽 `$crate::commands::([a-z0-9_]+)` 集合 == COMMAND_NAMES 集合
  2. **const ↔ `#[tauri::command]` fn**：递归读 `src/commands/**/*.rs`，抽 `#[tauri::command]` 或 `#[cfg_attr(feature = "ipc", tauri::command)]` 后随的 `pub (async )?fn NAME` 集合 == COMMAND_NAMES
  3. **registry ⊇ 全部平台命令**：`build_registry().names()` 必须包含 COMMAND_NAMES 中除 `AI_BESPOKE`（server 专用路由处理，测试里列出）外的全部名字；registry 不得包含 COMMAND_NAMES 之外的名字
- [ ] 22 个不可达命令分类处理：
  - `grafana_dashboard_url/list/presets/remove/upsert` → registry.rs 注册（impl 均为本地文件 CRUD，无 web 状态依赖，模式照抄 `grafana_test`:509）
  - 17 个 ai_*（ai_check_local_model, ai_cron_history, ai_cron_update, ai_discover_local_models, ai_evolution_delete_strategy, ai_evolution_record_run, ai_fetch_url, ai_knowledge_import, ai_knowledge_sync, ai_local_model_presets, ai_memory_add_runbook, ai_sandbox_presets, ai_session_create, ai_session_delete, ai_session_list, ai_session_queue_size, ai_web_search）→ 逐个看 `*_impl` 签名：仅需数据目录/无状态 → 进 registry（CoreState 有 data_dir 则闭包内取）；需要交互/流式 → server.rs 专用路由 + handler；确无 web 意义 → 放入 `DESKTOP_ONLY` 常量并注释理由。目标：DESKTOP_ONLY ≤ 2 个
- [ ] `k7s-server/tests/reconciliation.rs`：`registry.names() ∪ DEDICATED(web) == COMMAND_NAMES − DESKTOP_ONLY`（DEDICATED 从 server.rs 路由手抄常量，测试注释说明）
- [ ] `cargo test -p k7s-commands --test reconciliation && cargo test -p k7s-server --features web --test reconciliation`

### Task 6 (P1-2 + P2-3): 移动端 cfg + CI cross-target

**Files:**
- Modify: `crates/k7s-commands/src/commands/storage.rs:7-8,403,528,551,583,609`（cfg 移到 `*_impl` 和 tauri wrapper 函数上）
- Modify: `crates/k7s-commands/src/lib.rs:127-140`（image 相关宏条目加 `#[cfg(not(target_os = "android"))]`）
- Modify: `crates/k7s-commands/src/registry.rs:308-341`（6 个 image register 调用加 android cfg；`:576-673` 段逐条核对 iOS 排除模块的注册项加 iOS cfg）
- Modify: `.github/workflows/ci.yml`（新增 cross-target job）

- [ ] storage.rs：把 `#[cfg(not(target_os = "android"))]` 从 doc 注释/Args struct 移（或同时复制）到对应 `*_impl` 函数与 `#[tauri::command]` wrapper 上——参照正确样板 `image_sync_status_impl`(:455) 与 `image_copy`(:498) 的写法
- [ ] registry.rs：`import_image_to_node`/`image_sync_status`/`image_inspect_archive`/`export_from_node`/`list_node_images`/`export_from_registry` 六个 register 语句级 `#[cfg(not(target_os = "android"))]`（`image_copy`:674 已有样板）；576-673 涉及 `commands::{ai,cron,memory,skills,helm,...}`（mod.rs 里 iOS 排除）的 register 全部加 `#[cfg(not(target_os = "ios"))]`
- [ ] ci.yml 新增 job `cross-targets`（ubuntu 运行 android+musl，macos 运行 ios）：
```yaml
cross-targets:
  strategy:
    matrix:
      include:
        - { os: ubuntu-22.04, target: aarch64-linux-android, check: "cargo check -p k7s-commands --target" }
        - { os: ubuntu-22.04, target: x86_64-unknown-linux-musl, check: "cargo check -p k7s-server --features web,mcp --target" }
        - { os: macos-latest, target: aarch64-apple-ios, check: "cargo check -p k7s-commands --target" }
  runs-on: ${{ matrix.os }}
  steps:
    - uses: actions/checkout@v4
    - uses: dtolnay/rust-toolchain@stable
      with: { targets: "${{ matrix.target }}" }
    - run: make dist
    - run: ${{ matrix.check }} ${{ matrix.target }}
```
- [ ] 本地验证（macOS 宿主）：`rustup target add aarch64-apple-ios aarch64-linux-android x86_64-unknown-linux-musl` 后 `cargo check -p k7s-commands --target aarch64-apple-ios` 等三条全过（android/musl 若本地装不上 target，以 CI job 为准并在 commit message 注明）

### Task 7 (P1-3): 审计日志

**Files:**
- Create: `crates/k7s-core/src/core/audit.rs`（core/mod.rs 挂载）
- Modify: 危险 impls 加 `audit::record` 调用
- Test: `audit.rs` 尾部

- [ ] `audit.rs`：
```rust
//! Append-only JSONL audit trail for dangerous operations. Every
//! delete/apply/scale/restart/exec/helm-uninstall from any surface
//! (IPC, web, MCP, AI agent, cron) lands here with actor + outcome.
static SINK: OnceLock<Mutex<Option<File>>> = OnceLock::new();

pub fn init(data_dir: &Path) /* create_dir_all + append open audit.jsonl */
pub fn record(actor: &str, action: &str, target: &str, outcome: &str, detail: Option<&str>)
// 一行 {ts, actor, action, target, outcome, detail?}；写失败只 tracing::warn，绝不影响主流程
```
- [ ] 启动接线：server 与 desktop 构造 CoreState 处调用 `audit::init(&data_dir)`
- [ ] 调用点（actor 标注来源）：`ai/tools/impls.rs` delete/apply/scale/restart 四个 impl（actor 由调用方传入?——`*_impl` 无 actor 参数，改为在**调用边界**记录：registry 分发闭包不包装；简化方案：impl 内记 actor="k7s"，detail 附 kind/ns/name；agent.rs 工具分发处记 actor="ai"、mcp/server.rs 记 actor="mcp"（复用同一 impl 的双记录去重：只记一次——最终采用：危险 impl 内不记，统一在 agent.rs 工具执行前后 + mcp server 工具执行处 + k7s-server invoke_registry 分发处（对 DANGEROUS 集合命令）三处记录，actor 各自明确，覆盖全部三端）
- [ ] DANGEROUS 集合：delete_resource, apply_yaml, apply_manifest, scale_resource, restart_resource, drain_node, exec_command, start_node_shell, stop_node_shell, helm_uninstall, helm_upgrade, import_image_to_node, export_from_node
- [ ] 测试：tempdir init → record 两条 → 读回两行 JSON，字段齐全；未 init 时 record 不 panic

### Task 8 (P1-4): Secret 脱敏

**Files:**
- Modify: `crates/k7s-core/src/ai/tools/impls.rs:55-66`（describe_resource_impl）
- Modify: `crates/k7s-core/src/ai/context.rs:63-95`（selected_resource_context）
- Create helper: `crates/k7s-core/src/core/shell_common.rs`（`pub fn redact_secret_data(obj: &mut DynamicObject)`，从 `get_resource_yaml_impl:79-93` 抽出共用）
- Test: shell_common / ai tools tests

- [ ] 抽 `redact_secret_data`：把 data/stringData 值替为 `"***"`；`get_resource_yaml_impl` 改调它（行为不变）
- [ ] `describe_resource_impl` 加 `include_secrets: bool` 参数（wire 兼容：registry/AI 工具 schema 默认 false；MCP 工具 schema 同步加 optional 字段）；kind=="secrets" 且 !include_secrets → 脱敏后返回，并在返回 JSON 顶层加 `"secretsRedacted": true`
- [ ] `selected_resource_context`：kind 为 secrets 时同样脱敏（选中上下文明文进 system prompt 是泄漏主路径）
- [ ] 测试：构造含 data/stringData 的 DynamicObject → 脱敏后全为 "***"；非 Secret 对象不受影响

### Task 9 (P1-5): 沙箱真实化

**Files:**
- Modify: `crates/k7s-core/src/ai/config.rs:46-56`（`#[serde(default)] pub sandbox: SandboxConfig`）
- Modify: `crates/k7s-core/src/ai/agent.rs:250`（从 data_dir 加载 config.sandbox，无 data_dir 回退 default）
- Modify: `crates/k7s-core/src/ai/sandbox.rs:130-150`（arg_pattern 结构化匹配）+ 新增 RateLimiter
- Modify: `crates/k7s-core/src/ai/agent.rs` 工具循环（限流接线）
- Test: sandbox.rs tests

- [ ] arg_pattern 匹配：
```rust
fn args_match(args: &Value, pattern: &str) -> bool {
    if let Some((k, v)) = pattern.split_once('=') {
        let (k, v) = (k.trim(), v.trim());
        args.get(k).and_then(|x| x.as_str())
            .map(|s| s == v || s.contains(v)).unwrap_or(false)
    } else {
        args.to_string().contains(pattern) // 退化为原文子串
    }
}
```
文档注释同步：示例规则 `namespace=kube-system`、`kind=secrets` 现在真实生效
- [ ] `RateLimiter`：`VecDeque<Instant>` 滑动 60s 窗口，`check(now) -> bool`（超 `max_calls_per_minute` 拒绝）；agent 工具循环每次工具调用前 check，超限 → ToolResult error `"rate limited by sandbox (N calls/min)"`
- [ ] 测试：`deny namespace=kube-system` 规则命中 `{"namespace":"kube-system"}`；`kind=secrets` 命中；RateLimiter 窗口滑动与拒绝

### Task 10 (P1-6): 镜像导入/导出容器名

**Files:**
- Modify: `crates/k7s-core/src/kube/nodeshell.rs`（`pub const DEBUG_CONTAINER: &str = "debug";`，pod spec :162 引用）
- Modify: `crates/k7s-core/src/kube/image/import.rs:221`、`export.rs:264,346`（`ap.container(&pod_name)` → `ap.container(nodeshell::DEBUG_CONTAINER)`）

- [ ] 三处替换 + 常量化；grep 全仓 `ap.container(` 确认无第四处同 bug
- [ ] 无需新测试（无 cluster 的单测不可行），commit message 说明验证方式：真集群手动 + 代码审查

### Task 11 (P1-7): helm 临时文件 RAII

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/ops.rs:400-429`（kubeconfig + values 两个 writer）
- Test: ops.rs tests

- [ ] 仿 `image/sync.rs:240 AuthFileGuard` 实现：
```rust
pub(crate) struct TempFileGuard(PathBuf);
impl Drop for TempFileGuard { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }
fn write_temp_secret(prefix: &str, ext: &str, content: &str) -> AppResult<TempFileGuard>
// OpenOptions::new().write(true).create_new(true).mode(0o600) 创建
// 文件名 {prefix}-{pid}-{nanos}.{ext}
```
- [ ] `write_temp_kubeconfig`/`write_temp_values` 返回 guard；调用方把 guard 绑定到 helm 子进程执行完的作用域（`?` 早退也删）；审计：grep 确认旧路径 `kc-{pid}.yaml` 不再产生
- [ ] 测试：写入后文件存在且 unix mode 0600；drop 后消失；并发两个不撞名（nanos 后缀）

### Task 12: 登录限速

**Files:**
- Modify: `crates/k7s-server/src/web/auth_password.rs:219-249`（auth_login）
- Test: 同文件 tests 模块

- [ ] 进程级滑动窗口：`static FAILS: Mutex<Vec<Instant>>`；登录失败 push；`>=5 次失败/60s` → 直接返回 429 `{"error":"too many login attempts, wait a minute"}`；成功清空
- [ ] 测试：连错 5 次后第 6 次得到 429（复用文件内现有 auth 测试基建 :311 起）

### Task 13 (P1-8): SSE done 重连

**Files:**
- Modify: `frontend/src/providers/transport.ts:195-216`
- Test: `frontend/src/providers/transport.test.ts`（若不存在则新建）

- [ ] `while(true)` 循环 break 落到循环体后、catch 前，补：
```ts
// Server closed the stream cleanly — reconnect so live updates resume
// instead of going silent forever (k7s-web closes idle SSE streams).
scheduleReconnect();
```
（AbortError 路径在 catch 里已 return，不会走到这）
- [ ] vitest：stub `global.fetch` 第一次返回立即 done 的流、第二次返回挂起流，fake timers 断言第二次 fetch 被调度（backoff 后触发）

---

## Phase P2 — 收敛修坏

### Task 14: LLM 客户端超时

**Files:**
- Modify: `crates/k7s-core/src/ai/llm/openai.rs:38`

- [ ] `Client::new()` →
```rust
Client::builder()
    .connect_timeout(Duration::from_secs(10))
    .read_timeout(Duration::from_secs(300)) // 每次 read 的超时：长流不死、挂流 5 分钟必断
    .build()
    .map_err(|e| ...)? // 构造函数返回值现状核对后适配
```
（openai.rs 构造若非 Result 需小改调用方；read_timeout 语义写注释，避免后人改成总超时杀流）

### Task 15: context_compress 配对

**Files:**
- Modify: `crates/k7s-core/src/ai/context_compress.rs:22-35,101-131`
- Test: 同文件 tests

- [ ] `drop_old_tool_results` 重写为**整块交换原子取舍**：识别 `[Assistant{tool_calls} + 其后连续 N 条 Tool]` 为一个块；超预算时从最旧块开始整块丢弃（assistant 消息与全部 N 条 tool result 同进同出）；任何路径不得产生孤儿 tool_call_id 或孤儿 Tool
- [ ] `estimate_messages_tokens` 补 `tool_calls.arguments` 计入（`m.tool_calls.iter().map(|c| c.arguments.len()/4)`）
- [ ] 测试：①3 个 tool_calls 的块压缩后要么全在要么全无 ②孤儿检测函数 `has_orphan_tool_refs(&[Message])`（新写，测试用）恒 false ③估算含 arguments

### Task 16: browser.rs 闭合标签

**Files:**
- Modify: `crates/k7s-core/src/ai/browser.rs:73-138`
- Test: 同文件 tests

- [ ] 标签扫描区分开/闭：遇 `</` 置 `closing=true`，`</script>|</style>` → `skip_content=false`；`<script>|<style>` → `skip_content=true`；删除死的 `in_tag` 变量
- [ ] 测试：`<html><script>var x=1;</script><body>正文</body></html>` → 输出含 "正文"；`<style>a{}</style>文本` → 输出 "文本"

### Task 17: netpol matchExpressions

**Files:**
- Modify: `crates/k7s-core/src/kube/security/netpol_sim.rs:340-412`
- Test: 同文件 tests（现有 :514-551 附近）

- [ ] 新增完整 labelSelector 匹配：
```rust
fn selector_matches(labels: &BTreeMap<String, String>, sel: &LabelSelector) -> bool {
    // matchLabels: 全部相等
    // matchExpressions: In/NotIn/Exists/DoesNotExist（k8s 语义，任一不满足即 false）
}
```
- [ ] `pod_matches_selector` 改走它（空 selector 仍=选中所有）；`peer_matches` 的 namespaceSelector 用 ns 真实标签集合匹配（不只 metadata.name），matchExpressions 同样生效
- [ ] 测试：`{key: env, operator: In, values:[prod]}` 命中/不命中；NotIn 排除；NotIn 导致的策略方向翻转（原来误报 allowed 的用例现在正确 deny）

### Task 18: grype SBOM

**Files:**
- Modify: `crates/k7s-core/src/kube/security/sbom.rs:302-399`
- Test: 同文件 tests（fixture 内联字符串）

- [ ] `generate_via_grype`：CycloneDx → `-o cyclonedx-json`；Spdx → `-o spdx-json`
- [ ] `parse_grype_sbom` 按格式分派：CycloneDX → `components[].{name,version}` 组件 + `vulnerabilities[].{id, ratings[0].severity, affects[].ref→bom-ref 组件映射, recommendation}` 漏洞；SPDX → 沿用现有 packages 解析、漏洞为空（SPDX 本无漏洞字段，注释说明）；严重度映射表 `critical/high/medium/low/unknown → 极简 match`
- [ ] 测试：最小 CycloneDX JSON fixture（2 组件 1 漏洞 affects 其一）→ 组件 2、漏洞挂对组件、severity 映射正确；`-o` 参数构造函数单测

### Task 19: cron 真实接线

**Files:**
- Modify: `crates/k7s-core/src/ai/cron.rs`（表达式解析 + due_tasks 真实化 + spawn）
- Modify: `crates/k7s-server/src/web/hook_handlers.rs`（抽出可复用的 headless agent 执行函数，cron 与 hooks 共用）
- Modify: `k7s-server`/`k7s-desktop` 启动路径（tokio::spawn 调度循环）
- Test: cron.rs tests

- [ ] 5 字段 cron 解析器（minute hour dom month dow；支持 `*` `,` `-` `/`；dom/dow POSIX OR 语义）`fn next_after(expr, t) -> Option<DateTime<Utc>>`
- [ ] `due_tasks(now)`：`next_after(task.schedule, last_run.unwrap_or(created_at)) <= now`；执行前先原子置 last_run（防重入）
- [ ] `CronScheduler::spawn(data_dir, executor)`：60s tick 循环 → due → `record_run` 开始 → executor(task) → `record_run` 结果；executor 复用 hook_agent 的 agent 触发路径（读现实现后抽公共函数）
- [ ] server + desktop 启动处 spawn；写操作在无人工审批的 headless 场景自然被 "ask→超时/拒绝" 挡（验证 hook_agent 现有 permission 处理，保持一致）
- [ ] 测试：`*/5 * * * *` 从 12:03 → 12:05；`0 9 * * 1-5` 周六 → 周一 09:00；dom/dow OR；非法表达式返回 None 不 panic

### Task 20: session/knowledge 加固

**Files:**
- Modify: `crates/k7s-core/src/ai/session.rs`（共享单例 + 原子写）
- Modify: `crates/k7s-core/src/ai/knowledge_sync.rs` + `memory.rs`（去重 + 上限）
- Modify: 4 处 `SessionManager::new` 调用点（commands/ai.rs:309,385、ai_extra.rs:112、agent.rs:794）
- Test: 两文件 tests

- [ ] SessionManager：`pub fn shared(data_dir) -> Arc<Self>` 进程级 OnceLock<Map<PathBuf, Arc>>；save_sessions 改 tmp+rename 原子写
- [ ] knowledge_sync：条目稳定 id = hash(`{source}:{key}:{title}`) 64bit hex；`MemoryStore::upsert(id)` 已存在即跳过；同步后 vault 超 5000 条按最旧淘汰
- [ ] 测试：同 key 同步两次条目数不变；超上限淘汰最旧

### Task 21: config_path 统一

**Files:**
- Create: `crates/k7s-core/src/core/paths.rs`
- Modify: 7 处（audit.rs:45、metrics_config.rs:76、grafana.rs:73、alerting.rs:59、image/repo.rs:122、saved_queries.rs:44、ai/mod.rs:65）
- Test: paths.rs tests

- [ ] `pub fn config_dir() -> PathBuf`：`K7S_CONFIG_DIR` > `XDG_CONFIG_HOME/k7s` > 平台默认（macOS `~/Library/Application Support/k7s`，其余 `~/.config/k7s`）；内部 `fn config_dir_from(env: &mut dyn FnMut(&str) -> Option<String>)` 便于测试
- [ ] 7 处 `config_path()` 改为 `config_dir().join(<原文件名>)`（行为对默认用户完全一致）
- [ ] 测试：env 各分支

### Task 22: 仓模型减负

**Files:**
- Create: `scripts/sync-repos.sh`、`scripts/set-version.sh`、`scripts/check-versions.sh`
- Modify: `Makefile`

- [ ] sync-repos.sh：`for name in deps core commands server desktop ios android; do git subtree split --prefix=crates/k7s-$name -b sync/k7s-$name && git push git@github.com:yi-nology/k7s-$name.git sync/k7s-$name:main; done`；frontend 若为独立 checkout 则 `git -C frontend push`（实施时以 `ls frontend/.git crates/*/.git` 实测为准，两种情形都兼容）；`--dry-run` 参数只打印不推
- [ ] set-version.sh `<ver>`：sed 全部 `crates/*/Cargo.toml` 的 `^version` + `frontend/package.json` + `frontend/src-tauri?/tauri.conf.json`（存在才改）+ 提示运行 `cargo update -w` 刷 lock
- [ ] check-versions.sh：断言 7 个 crate version 两两一致（k7s-deps 除外）+ Cargo.lock 中 k7s-* 版本与 manifest 一致；不一致非零退出
- [ ] Makefile：`sync-repos`、`set-version VER=`、`check-versions` 三个 target
- [ ] `bash -n` 三个脚本 + `make check-versions` 实跑

---

## Phase P3 — MCP/AI 工具面质量

### Task 23: 工具错误结构化

**Files:**
- Create: `crates/k7s-core/src/ai/tools/error_shape.rs`（或并入 tools/mod.rs）
- Modify: `agent.rs` 工具结果错误出口、`k7s-server/src/mcp/server.rs` 工具错误出口
- Test: error_shape tests

- [ ] `pub fn tool_error(e: &str) -> Value` → `{"error": msg, "hint": ..., "retryable": bool}`，按类映射：Disconnected → hint "run connect/list contexts first" retryable true；NotFound/unknown command → hint "call list_resources to discover valid kind/name" true；bad arguments → hint "check parameter types (camelCase)" true；PermissionDenied/sandbox → retryable false；Yaml → hint "validate manifest"
- [ ] agent 工具失败与 MCP 错误返回统一走它（模型能据此自纠，不再重复同参重试）
- [ ] 测试：各错误类映射

### Task 24: list_resources 分页

**Files:**
- Modify: `crates/k7s-core/src/ai/tools/impls.rs:22-52`（list_resources_impl）
- Modify: 对应 tool schema（tools/mod.rs 或定义处）与 registry/命令包装参数透传
- Test: impls tests

- [ ] 新参 `limit: Option<i64>` + 返回值带 continue：`lp = lp.limit(n)`；`list.metadata.continue_` 有值时返回 `{"items": rows, "continue": token}`（对象），无值保持原数组——向后兼容；AI 工具 schema 描述里写明"大结果集先 limit=100，再用 continue 翻页"
- [ ] 测试：lp 构造（limit 生效）；无 continue 时返回数组形状不变

---

## 收尾

### Task 25: 全量验证

- [ ] `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings`
- [ ] `cargo test --workspace`
- [ ] `cargo test -p k7s-server --features web --test web_api`
- [ ] 三 target check（或注明依赖 CI）：aarch64-apple-ios / aarch64-linux-android / x86_64-unknown-linux-musl
- [ ] `cd frontend && pnpm typecheck && pnpm lint && pnpm test -- --run && pnpm build`
- [ ] `make check-versions`

### Task 26: 文档 + 记忆

- [ ] `docs/ROADMAP.md`：本计划 P0-P3 的完成状态快照
- [ ] `docs/KNOWN_ISSUES.md`：本轮**未**修的遗留（明文 HTTP/TLS 指南、ErrorBoundary 分面板、AiChat busy、LogsTab 高亮、多用户/多集群、薄壳仓合并建议——需用户拍板）
- [ ] README 安全章节补 K7S_WEB_TOKEN/mcp 鉴权说明
- [ ] 更新 auto-memory（k7-evolution-plan 状态 → 已实施）

## Self-Review 结论

- 覆盖检查：评审 10 项严重（#1/#2 已在工作区、#3-T8、#4-T1、#5-T9、#6-T2、#7-T10、#8-T11、#9-T6、#10-T13）✓；重要项群（登录限速-T12、LLM 超时-T14、compress-T15、session/knowledge-T20、config_path-T21、browser-T16、helm keep-history 见下方遗留、grype-T18、netpol-T17、cron-T19、审计-T7）✓；结构根因（对账-T4/T5、CI-T6）✓；P2 减负（T22）✓；P3（T23/T24 + /mcp 鉴权即网关复用）✓。
- helm `--keep-history` 反转（ops.rs:301）为小修，并入 T11 顺手修（实施时先读该行确认）。
- 类型一致性：`redact_secret_data`/`DEBUG_CONTAINER`/`TempFileGuard`/`COMMAND_NAMES`/`config_dir` 等跨任务符号在定义任务中给出、使用任务引用同名。
