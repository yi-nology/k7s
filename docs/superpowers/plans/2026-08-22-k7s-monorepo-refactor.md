# k7s Monorepo 化 + 六阶段重构执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 9 仓 polyrepo 合并为单一 git monorepo + Cargo workspace，完成 Phase 0-5 全部重构，交付"一份业务实现 + 一份命令注册 + 薄壳"的成品。

**Architecture:** 根 Cargo.toml workspace 统一 7 个 Rust crate（crates/ 布局）+ frontend/；git 历史经 `git subtree` 保留；k7s-commands 升级为真 crate 承载全部 Tauri 命令；k7s-core 新增 CommandRegistry 作为 Tauri/Web 共用命令接缝；k7s-server 巨型文件按域拆分；kube/ 目录分组；前端消样板补测试。

**Tech Stack:** Rust 1.77.2 / Tauri 2 / axum 0.8 / rmcp 3 / React 19 / Vite 8 / Vitest / pnpm 10

## Global Constraints

- rust-version = 1.77.2（tauri-plugin-window-state 2.x 硬性要求）
- 每个 task 结束必须 `cargo check`（改动 Rust 时）或 `pnpm typecheck`（改动前端时）通过
- 每 task 一个 commit，信息格式 `<phase>: <描述>`
- 不改变任何 Tauri 命令名与 HTTP 路由（前端零感知）
- 验证基线：cargo test 367 个测试 + pnpm test 97 个测试文件 + tests/web_api.rs 集成测试全绿
- 遗留仓 .git 目录归档到 `~/my_project/k7-archive/`，不删除

## 目标布局

```
k7/                       (新 git 仓根)
├── Cargo.toml            [workspace] + [workspace.dependencies] + [profile.release]
├── Cargo.lock            (唯一)
├── .github/workflows/    ci.yml + release-desktop.yml + release-docker.yml
├── crates/
│   ├── k7s-deps/         依赖伞仓（保持）
│   ├── k7s-core/         业务核心（ai/ core/ kube/ + 新 commands.rs 注册表）
│   ├── k7s-commands/     新真 crate：全部 #[tauri::command] + registry()
│   ├── k7s-server/       web + mcp 传输（拆分后）
│   ├── k7s-desktop/      薄壳（package name "k7s"，lib "k7s_lib"）
│   ├── k7s-ios/          薄壳
│   └── k7s-android/      薄壳
├── frontend/             (原 k7s-frontend)
├── legacy/               (原 k7s 仓，Phase 5 清理)
├── docs/
└── dist/                 (构建产物，gitignore)
```

---

### Task 1: 固化 9 仓 WIP 提交

**Files:** 无新文件，仅 git 操作

- [ ] 对 k7s-core / k7s-server / k7s-desktop / k7s-ios / k7s-android 各执行：
  `git add -A && git commit -m "wip: snapshot before monorepo merge"`
- [ ] 验证：9 仓 `git status --porcelain` 全部为空

### Task 2: Monorepo 组装（subtree 导入）

**Files:**
- Create: `/Users/zhangyi/my_project/k7/.git`（git init）
- Create: `~/my_project/k7-archive/`（原仓 .git 归档）

映射表（导入顺序即此）：

| 原目录 | subtree prefix | 说明 |
|---|---|---|
| k7s-deps | crates/k7s-deps | |
| k7s-core | crates/k7s-core | |
| k7s-commands | crates/k7s-commands | 散文件，Task 4 改造 |
| k7s-server | crates/k7s-server | |
| k7s-desktop | crates/k7s-desktop | |
| k7s-ios | crates/k7s-ios | |
| k7s-android | crates/k7s-android | |
| k7s-frontend | frontend | |
| k7s | legacy | 原 monorepo，Phase 5 清理 |

- [ ] `git init`（root，main 分支）
- [ ] 每仓执行：
  ```bash
  BR=$(git -C <dir> branch --show-current)
  git fetch <abs-dir> $BR && git subtree add --prefix=<prefix> FETCH_HEAD $BR -m "chore: import <dir> (preserving history)"
  ```
- [ ] 全部导入后：`mkdir -p ~/my_project/k7-archive && for d in <9 仓>; do mv $d/.git k7-archive/$d.git; rm -rf $d; done`（subtree 已生成内容；target/node_modules 等未跟踪产物随之丢弃，可重建）
- [ ] 处理 root 级未跟踪内容：`.playwright-mcp/`、`.superpowers/`、`.zcode/`、`.DS_Store`、`dist/` 写入根 `.gitignore`
- [ ] Commit: `chore: assemble monorepo from 9 repos via git subtree`
- [ ] 验证：`git log --oneline | wc -l` > 各仓提交总和；`ls crates/ frontend/ legacy/` 齐全

### Task 3: Cargo workspace 化（Phase 0 核心）

**Files:**
- Create: `Cargo.toml`（根）
- Modify: 7 个 `crates/*/Cargo.toml`
- Delete: `crates/k7s-core/.cargo/config.toml`（[patch] 不再需要）、各仓独立 Cargo.lock

根 Cargo.toml 关键内容：

```toml
[workspace]
resolver = "2"
members = [
    "crates/k7s-deps",
    "crates/k7s-core",
    "crates/k7s-commands",
    "crates/k7s-server",
    "crates/k7s-desktop",
    "crates/k7s-ios",
    "crates/k7s-android",
]

[workspace.package]
version = "0.4.2"
edition = "2021"
rust-version = "1.77.2"

[workspace.dependencies]
k7s-deps = { path = "crates/k7s-deps" }
k7s-core = { path = "crates/k7s-core" }
k7s-commands = { path = "crates/k7s-commands" }
k7s-server = { path = "crates/k7s-server" }
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-dialog = "2"
tauri-plugin-window-state = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "process", "signal", "sync", "time"] }
rmcp = { version = "3.1.3", features = ["server", "transport-io"] }
axum = "0.8"
tower = { version = "0.5", features = ["util"] }
http-body-util = "0.1"
proptest = "1"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

- [ ] 7 个成员 Cargo.toml：git 依赖 → `path`（或 `workspace = true`）；删除各自 `[profile.release]`、`rust-version`、`edition`（改 `workspace = true`）；删除 6 份 Cargo.lock（k7s-commands 无）
- [ ] rmcp 统一 3.1.3；k7s-deps 单一来源（path dep 自动解决 rev 漂移）
- [ ] 修 `crates/k7s-{desktop,ios,android}/tauri.conf.json`：`frontendDist` "../dist" → "../../dist"
- [ ] 修 `crates/k7s-{ios,android}/Makefile` 的 FRONTEND/DIST 路径计算（层级 +1）
- [ ] `cargo metadata --no-deps` 成员 7 个；`cargo check --workspace` 通过（shell 对 k7s-core 0.4.2 的隐性依赖在此暴露并修复）
- [ ] Commit: `phase0: cargo workspace, single lock, path deps`

### Task 4: Phase 1 — k7s-commands 真 crate 化

**Files:**
- Create: `crates/k7s-commands/Cargo.toml`
- Create: `crates/k7s-commands/src/lib.rs`
- Move: `k7s-commands/*.rs`（根目录 11 文件）→ `crates/k7s-commands/src/commands/`
- Move: 三 shell 的 `src/commands/{core,storage,ai,helm}.rs` 合并版 → `crates/k7s-commands/src/commands/`
- Delete: 三 shell 的 `src/commands/`（除平台特有残留）

```toml
# crates/k7s-commands/Cargo.toml
[package]
name = "k7s-commands"
version.workspace = true
edition.workspace = true
rust-version.workspace = true

[lib]
name = "k7s_commands"

[dependencies]
k7s-core = { path = "../k7s-core", features = ["tauri"] }
k7s-deps = { path = "../k7s-deps" }
tauri = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
```

lib.rs 核心导出（cfg 沿用 target_os，iOS 裁剪面用 `#[cfg(not(target_os = "ios"))]`）：

```rust
pub mod commands; // core, storage, helm, ai, shell, forward, observability,
                  // memory, skills, security, sbom, scanner, ai_deep, ai_extra, cron

/// 在 shell crate 展开 generate_handler!（tauri 支持列表项上的 #[cfg] 属性）
#[macro_export]
macro_rules! register_commands {
    () => {
        tauri::generate_handler![
            $crate::commands::list_contexts,
            // ...全量命令，iOS 排除项标注 #[cfg(not(target_os = "ios"))]
        ]
    };
}
```

迁移规则（11 个 include 文件机械改写）：
- `crate::commands::core::require_client` → `$crate::util::require_client`（helper 上提至 k7s-commands/src/util.rs）
- `crate::core::…` → `k7s_core::core::…`；`crate::kube::…` → `k7s_core::kube::…`；`crate::error::…` → `k7s_core::error::…`
- `k7s_deps::…` 保持（k7s-commands 直接依赖 k7s-deps）
- `//` 顶层注释恢复为 `//!`；删除 include! 接线

合并规则（shell 残留 4 文件 ×3）：
- `core.rs`：以 desktop 版为基底（超集）；对三版本 diff，iOS 缺失项（knowledge_sync、custom_kind_counts 等）加 `#[cfg(not(target_os = "ios"))]`；android 差异行加 `#[cfg(target_os = "android")]` 分支
- `ai.rs`：desktop/android 仅 sink 改名差（`AiTauriSink`↔`TauriEventSink`）→ 统一为 `TauriEventSink`；`AiRuntime` 随迁
- `storage.rs`：共享部分上提；desktop 专属（本地文件选择器路径等）`#[cfg(not(any(target_os = "ios", target_os = "android")))]`
- `helm.rs`：`#[cfg(not(target_os = "ios"))]`

三 shell 的 lib.rs 改造：
- `mod commands;` 删除；`.invoke_handler(tauri::generate_handler![…190 项])` → `.invoke_handler(k7s_commands::register_commands!())`
- `app.manage(Arc::new(commands::ai::AiRuntime::new()))` → `k7s_commands::commands::ai::AiRuntime::new()`
- desktop `pub use k7s_core::{ai, core, error, kube};` 等 re-export 暂留（examples 依赖），Task 5 清理

- [ ] `cargo check -p k7s-commands` 通过
- [ ] 三 shell `cargo check -p k7s -p k7s-ios-lib -p k7s-android…`（按各自 package/lib 名）通过
- [ ] `cargo test --workspace` 通过
- [ ] Commit: `phase1: k7s-commands real crate, shells consume shared commands`

### Task 5: Phase 1b — examples/tests 去重 + shell 减薄

**Files:**
- Keep: `crates/k7s-desktop/examples/`（17 个 canonical 版本，`k7s_lib` 引用不变）
- Keep: `crates/k7s-desktop/tests/{ai_agent_loop.rs, ai_cluster_integration.rs}`
- Move: `crates/k7s-ios/tests/web_api.rs` → `crates/k7s-server/tests/web_api.rs`（改用 k7s-server 直启）
- Delete: k7s-ios/k7s-android 的 examples/ 与其余重复 tests/

- [ ] 删重后 `cargo test --workspace` 通过（web_api.rs 在 server 仓可用）
- [ ] shell src 仅剩：main.rs / lib.rs（插件+setup+register_commands!）/ 平台特有命令文件（desktop: window_state、文件选择器；ios: 无；android: cfg 门控残留如有）
- [ ] Commit: `phase1b: dedupe examples/tests, thin shells`

### Task 6: Phase 2 — CommandRegistry 接缝（k7s-core）

**Files:**
- Rewrite: `crates/k7s-core/src/core/commands.rs`（11 行 stub → 注册表）
- Modify: `crates/k7s-commands/src/commands/*.rs`（命令函数 → `_impl` + `#[tauri::command]` 薄包装）
- Create: `crates/k7s-commands/src/registry.rs`（`pub fn registry() -> CommandRegistry`）

k7s-core 注册表（完整代码）：

```rust
//! Transport-agnostic command registry — the single seam shared by the
//! Tauri IPC and the web `/invoke/{cmd}` route (phase 3 of the web-mode work).

use crate::core::CoreState;
use crate::error::AppResult;
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value;
use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc};

pub type CommandFuture = Pin<Box<dyn Future<Output = AppResult<Value>> + Send>>;
pub type DynHandler =
    Arc<dyn Fn(Arc<CoreState>, Value) -> CommandFuture + Send + Sync>;

#[derive(Default)]
pub struct CommandRegistry {
    handlers: HashMap<&'static str, DynHandler>,
}

impl CommandRegistry {
    /// Register `name`, deserializing the request body into `A` and
    /// serializing the handler's return value back to JSON.
    pub fn register<A, R, F, Fut>(&mut self, name: &'static str, handler: F)
    where
        A: DeserializeOwned + Send + 'static,
        R: Serialize + 'static,
        F: Fn(Arc<CoreState>, A) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = AppResult<R>> + Send + 'static,
    {
        let handler = Arc::new(handler);
        self.handlers.insert(
            name,
            Arc::new(move |state, body| {
                let handler = handler.clone();
                Box::pin(async move {
                    let args: A = serde_json::from_value(body)
                        .map_err(|e| AppError::invalid_request(format!("bad arguments: {e}")))?;
                    let out = handler(state, args).await?;
                    serde_json::to_value(out)
                        .map_err(|e| AppError::internal(format!("serialize response: {e}")))
                })
            }),
        );
    }

    pub fn get(&self, name: &str) -> Option<DynHandler> {
        self.handlers.get(name).cloned()
    }

    pub fn contains(&self, name: &str) -> bool {
        self.handlers.contains_key(name)
    }

    pub fn names(&self) -> impl Iterator<Item = &'static str> {
        self.handlers.keys().copied()
    }
}
```

（`AppError::invalid_request` / `AppError::internal` 若不存在则在 error.rs 增补对应 constructor。）

命令改写模式（每个命令机械套用）：

```rust
// 业务实现：无 tauri 类型，registry 与 tauri 共用
pub async fn list_contexts_impl(state: Arc<CoreState>) -> AppResult<Vec<String>> { … }

// Tauri 薄包装（名字不变，前端零感知）
#[tauri::command]
pub async fn list_contexts(mgr: State<'_, Arc<CoreState>>) -> AppResult<Vec<String>> {
    list_contexts_impl(mgr.inner().clone()).await
}
```

registry.rs 逐命令注册：

```rust
pub fn registry() -> CommandRegistry {
    let mut r = CommandRegistry::default();
    r.register("list_contexts", |state, _args: ()| async move {
        commands::core::list_contexts_impl(state).await
    });
    // …全量
    r
}
```

- [ ] `cargo test -p k7s-core` 通过（registry 单测：注册/未知名/参数反序列化错误路径）
- [ ] Commit: `phase2a: CommandRegistry seam in k7s-core + impl/wrapper split`

### Task 7: Phase 2 — web `/invoke` 查表分发

**Files:**
- Modify: `crates/k7s-server/src/web/handlers.rs`（invoke 路由改为 registry 优先）
- Modify: `crates/k7s-server/Cargo.toml`（加 k7s-commands 依赖）
- Delete: handlers.rs 中已被 registry 覆盖的手写镜像 handler

路由逻辑：

```rust
pub async fn invoke(cmd: Path<String>, State(ws): State<Arc<WebState>>, body: Json<Value>) -> impl IntoResponse {
    let reg = ws.command_registry(); // OnceLock<CommandRegistry>，来自 k7s_commands::registry()
    if let Some(handler) = reg.get(&cmd) {
        match handler(ws.core_state().clone(), body.0).await { …200/4xx… }
    } else {
        // 尚未迁移的命令走原有手写 handler；全部迁移完成后此分支删除
        legacy_dispatch(&cmd, &ws, body.0).await
    }
}
```

- [ ] `cargo test -p k7s-server` + tests/web_api.rs 全绿（wire 兼容证明）
- [ ] 删除 `crates/k7s-desktop/src/lib.rs:13-17` 的 k7s_server re-export（bin 入口已直依赖）
- [ ] Commit: `phase2b: web /invoke dispatches through CommandRegistry`

### Task 8: Phase 3 — k7s-server 巨型文件拆分

**Files:**
- Split: `crates/k7s-server/src/mcp/server.rs`（2,633 行）→ `mcp/server.rs`(组合) + `mcp/tools/{cluster,pod,workload,helm,image,observability,security,shell}.rs`
- Split: `crates/k7s-server/src/web/handlers.rs` 残余 → `web/handlers/{prefs,connection,yaml,templates,misc}.rs`
- 纯移动 + mod 声明，不改逻辑

- [ ] `cargo check -p k7s-server --features web,mcp` 通过
- [ ] `cargo test -p k7s-server` 通过
- [ ] Commit: `phase3a: split mcp server and web handlers by domain`

### Task 9: Phase 3b — kube/ 目录重组

**Files:**
- Create: `crates/k7s-core/src/kube/{helm/,image/,security/,observability/}`
- Move: helm.rs+helm_market.rs+helm_ops.rs → helm/{repos,market,ops}.rs
- Move: image_*.rs(6)+imagerepo.rs → image/{archive,scan,sync,export,import,repo}.rs
- Move: sbom.rs+sbom_storage.rs+security_audit.rs → security/
- Move: observability.rs（如存在）+metrics 相关 → observability/
- Extract: `kube/mod.rs` 内联 ResourceKind enum → `kube/kind.rs`；events 常量 → `kube/events.rs`
- 全仓 `crate::kube::helm::…` 路径批量更新（rust-analyzer 或 sed，编译器兜底）

- [ ] `cargo test -p k7s-core` 通过（kube/ 40 个测试模块是安全网）
- [ ] Commit: `phase3b: reorganize kube module tree`

### Task 10: Phase 4 — 前端 useProviderQuery + 13 panel 迁移

**Files:**
- Create: `frontend/src/hooks/useProviderQuery.ts`（+ .test.ts）
- Modify: 13 个 panel：audit/AlertsPanel grafana/GrafanaPanel imagerepo/ImageRepoPanel metrics/MetricsExplorer security/SecurityPanel endpoints/EndpointsPanel sbom 两 tab podfiles/PodFilesPanel ai/MemoryPanel helm/HelmDiff actions/HelmRollbackForm settings/ScannerPanel

Hook 契约：

```ts
export interface QueryOptions<T> {
  /** 构建 Provider 查询；返回 null 表示跳过（依赖未就绪） */
  query: () => Promise<T> | null;
  deps: unknown[];
  /** 结果缓存 key；同 key 二次挂载直接复用，TTL 内不重发 */
  key?: string;
  ttlMs?: number; // 默认 30_000；0 = 不缓存
}
export function useProviderQuery<T>(opts: QueryOptions<T>): {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  reload: () => void;
};
```

迁移模式（每个 panel 删掉 useState/useEffect 样板）：

```ts
const { data, loading, error, reload } = useProviderQuery({
  query: () => getProvider().listAlerts(cluster),
  deps: [cluster],
});
```

- [ ] `pnpm typecheck && pnpm test` 通过；hook 自身单测（缓存命中/跳过/错误路径）齐
- [ ] Commit: `phase4a: useProviderQuery, migrate 13 panels`

### Task 11: Phase 4b — 前端补测试 + TopologyGraph 拆分

**Files:**
- Create: `frontend/src/components/ai/*.test.tsx`（≥4 个核心组件）
- Create: `frontend/src/components/imagetransfer/*.test.tsx`（≥3）
- Create: `frontend/src/components/editor/*.test.tsx`（≥2）
- Split: `components/topology/TopologyGraph.tsx`（812 行）→ `useTopologyLayout.ts`（d3-force 布局）+ `TopologyCanvas.tsx`（渲染）+ `TopologyGraph.tsx`（交互组合，<300 行）

- [ ] `pnpm test` 通过，新增测试 ≥9 个文件
- [ ] Commit: `phase4b: frontend test gaps + topology split`

### Task 12: Phase 5 — 遗留清理 + 文档 + CI

**Files:**
- Delete: `legacy/`（保留 docs 迁移：ARCHITECTURE.md → 根 docs/ 改写、CONTRIBUTING.md、docker-compose/.env.example → 根 deploy/）
- Rewrite: 根 `README.md`（新布局、构建命令）、根 `docs/ARCHITECTURE.md`
- Create: `.github/workflows/ci.yml`、`release-desktop.yml`（原 k7s-desktop/release.yml 适配路径）、`release-docker.yml`（原 k7s 仓的适配）
- Create: `.gitignore`（target/ node_modules/ dist/ .DS_Store .playwright-mcp/ 等）

ci.yml 核心 job：

```yaml
name: ci
on: [push, pull_request]
jobs:
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all -- --check
      - run: cargo clippy --workspace --all-targets -- -D warnings
      - run: cargo test --workspace
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm, cache-dependency-path: frontend/pnpm-lock.yaml }
      - run: pnpm install --frozen-lockfile && pnpm typecheck && pnpm test -- --run && pnpm build
        working-directory: frontend
```

- [ ] Commit: `phase5: legacy cleanup, docs, root CI`

### Task 13: 全量验证 + 最终报告

- [ ] `cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- [ ] `cd frontend && pnpm typecheck && pnpm test -- --run && pnpm build`
- [ ] `cargo check -p k7s-server --features web,mcp`（两个 bin）
- [ ] 生成 diff 统计（git diff --stat v0.4.2 基线）与最终报告

## 风险与对策

| 风险 | 对策 |
|---|---|
| shell 隐性依赖 k7s-core 0.3.8 API | Task 3 `cargo check --workspace` 立即暴露，逐个修复 |
| generate_handler! 不支持列表项 #[cfg] | 备选：拆 `register_commands!` + `register_commands_full!` 两个宏，shell 各自拼接不可行则退回函数式 `invoke_handler` 手写 match（tauri 支持任意 `Fn(Invoke<R>) -> bool`） |
| web /invoke 行为漂移 | tests/web_api.rs（734 行）+ HttpProvider wire 镜像测试兜底；Task 7 保留 legacy fallback 直至全量迁移 |
| 移动端 gen/ 路径断裂 | Makefile 路径修复；真机构建无法本地验证，报告中注明需 `tauri ios/android init` 重新生成 |
| 大规模移动导致测试路径失效 | 每 task 全量 `cargo test --workspace` 门槛 |

## Self-Review 记录

- 覆盖检查：Phase 0→Task 3；Phase 1→Task 4-5；Phase 2→Task 6-7；Phase 3→Task 8-9；Phase 4→Task 10-11；Phase 5→Task 12 ✅
- MCP 说明：原方案"MCP 从注册表生成"调整为"MCP 保持 rmcp 定义、业务调用走 core"——rmcp 工具需要富 schema，通用注册表生成会丢失类型；kube_api.rs 已天然委托 core，接缝价值集中在 Tauri↔Web
- 类型一致性：CommandRegistry/register/registry()/list_contexts_impl 命名在 Task 6/7 间一致 ✅
