# ChartOps 整合 P1 — 渲染预览 / 版本 Diff / 升级预览 / Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 P0 本地 Chart 库之上补齐 ChartOps 的预览与复用能力：`helm template` 离线渲染预览、两版本包 diff、升级前 dry-run diff 预览、部署方案（Profiles）保存/复用。

**Architecture:** 渲染复用 ops.rs 的 helm CLI 封装模式（`helm template` 无需集群）；diff 不新增后端命令 —— `LocalChartDetail` 增加 `chartYaml` 字段，前端用现有 `lib/diff.ts` LCS 引擎对两份 detail 做 Chart.yaml/values.yaml diff；Profiles 是 `<data_dir>/helm-profiles.json` 上的纯函数 CRUD（与 local.rs 同风格，dir 参数注入）；向导新增 upgrade 模式（预填 release + 拉当前 manifest 与渲染结果 diff）。

**Tech Stack:** Rust (tokio process, serde), React 19 + vitest。无新增依赖。

## Global Constraints

- 与 P0 相同：移动端单层 `#[cfg(not(any(target_os = "ios", target_os = "android")))]`；wire 参数 camelCase；写操作审计（本阶段 Profiles 的 save/delete 要记审计：`helm_profile_save`/`helm_profile_delete`）；`cargo fmt --all --check` + clippy 必须过。
- Rust 消费依赖一律 `k7s_deps::` 路径；禁止新增直接依赖。
- helm 命令超时默认沿用 5m0s 语义；渲染属纯本地操作，不接集群（除 `--kube-version` 外不加任何集群 flag）。
- 前端 i18n：en.ts 与 zh.ts 都加 key（`helm.local.render.*`、`helm.local.diff.*`、`helm.profiles.*`），dictionaries.ts 类型同步；`t()` 带 fallback。
- 命令层新命令必须同步加进 `crates/k7s-commands/src/lib.rs` 的 `register_commands!` 宏与 `COMMAND_NAMES`（reconciliation 测试强制四表一致）。
- P0 遗留口径：`helmRunOp` web 端仍是 notImplemented —— 本阶段渲染/diff/profiles 不依赖它；upgrade 真实执行仍走既有桌面 ipc 与 web catch-all 通道的 `helm_run_op`（P0 结论：后端 registry 支持，HttpProvider stub 是陈旧代码，本阶段顺手把 HttpProvider.helmRunOp 改为走通用 invoke，见 Task 4）。
- 工作树：/Users/zhangyi/my_project/k7/.worktrees/chartops-p0（分支 feat/chartops-p0-local-chart-library，PR #40）。cargo 用 `CARGO_TARGET_DIR=/Users/zhangyi/my_project/k7/target`。

---

### Task 1: ops.rs 渲染命令 — `helm template` 封装 + `helm_render_preview`

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/ops.rs`（`render_default_values` 附近，~line 572）
- Modify: `crates/k7s-commands/src/commands/helm.rs` + `crates/k7s-commands/src/registry.rs` + `crates/k7s-commands/src/lib.rs`（宏 + COMMAND_NAMES）
- Test: `crates/k7s-core/src/kube/helm/ops.rs`（in-file tests）

**Interfaces:**
- Consumes: `ops::which_helm()`（ops.rs:462，pub(crate)）；`write_temp_values`/`TempHelmFile`（ops.rs 现有）。
- Produces:
  - `pub async fn render_chart_templates(chart_ref: &str, version: &str, values: &str, kubeconfig: Option<&str>) -> AppResult<String>` —— chart_ref 可为 `repo/name`、OCI URL 或本地绝对路径；version 空则不传 `--version`；values 空则不传 `--values`；非空走临时文件（TempHelmFile RAII）。
  - 纯函数 `fn template_argv(chart_ref: &str, version: &str, values_path: Option<&str>) -> Vec<String>`（`helm template <name> <chart_ref> [--version v] [--values p]`，name 取 chart_ref 的 file_stem/尾段，供 `--name-template` 不需要——helm template 第一参数是 release 名占位，用固定 `-` 或从 chart_ref 推导，实现时以 `helm template rel chart` 形式传 `rel` 常量字符串 `"preview"`）。
  - wire 命令：`helm_render_preview { chart, version, values, kubeconfig? } -> String`（Args `#[serde(rename_all="camelCase")] pub(crate) struct HelmRenderPreviewArgs`）。

- [ ] **Step 1: 失败测试**（ops.rs tests 模块）

```rust
    #[test]
    fn template_argv_flags() {
        let argv = template_argv("repo/app", "1.2.3", Some("/tmp/v.yaml"));
        assert_eq!(argv[0], "template");
        assert!(argv.contains(&"--version".into()) && argv.contains(&"1.2.3".into()));
        assert!(argv.windows(2).any(|w| w == ["--values".to_string(), "/tmp/v.yaml".to_string()]));
        let bare = template_argv("/data/charts/demo-1.0.0", "", None);
        assert!(!bare.contains(&"--version".into()) && !bare.contains(&"--values".into()));
    }
```

- [ ] **Step 2:** `cargo test -p k7s-core helm::ops` 确认编译失败（`template_argv` 未定义）。
- [ ] **Step 3: 实现** — `template_argv` 纯函数 + `render_chart_templates`（which_helm → Command::new(helm).args(template_argv(...)) + values 临时文件 + `--kubeconfig` 处理沿用 render_default_values 的写法——先读该函数 ~572-617 行，进程输出 capture 不流式；非零退出返回 `AppError::Other` 含 stderr）。注意：`helm template` 不加 `--wait/--timeout`（非集群操作）。kubeconfig 为 `Some` 时写临时文件传 `--kubeconfig`（同样沿用现模式）。
- [ ] **Step 4:** 测试过 + `cargo check --workspace` + fmt/clippy。
- [ ] **Step 5: 命令层** — `commands/helm.rs` 加 `helm_render_preview_impl(chart, version, values, kubeconfig)`（async，直接调 ops::render_chart_templates）+ ipc 包装；registry 注册 `helm_render_preview`（cfg 门控同邻）；lib.rs 宏 + COMMAND_NAMES 加名。跑 reconciliation 测试：`cargo test -p k7s-commands`。
- [ ] **Step 6: Commit** — `feat(helm): offline render preview via helm template (+helm_render_preview cmd)`

---

### Task 2: LocalChartDetail 增加 `chartYaml`

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/local.rs`（struct `LocalChartDetail` ~:344、`local_chart_detail` ~:505-520）
- Test: 同文件

**Interfaces:**
- Produces: `LocalChartDetail` 新增 `pub chart_yaml: String`（serde camelCase 已由 struct 级 `rename_all` 覆盖 → wire `chartYaml`；读不到 Chart.yaml 为空串）。

- [ ] **Step 1: 失败测试** — 现有 `detail_lists_files_and_reads_values` 测试追加断言 `assert!(d.chart_yaml.contains("name: demo"))`；dir 型测试同样断言。
- [ ] **Step 2:** RED。
- [ ] **Step 3: 实现** — detail 构造处 `read("Chart.yaml")` 加进结构体（P0 的 `read` 闭包已支持任意成员）。
- [ ] **Step 4:** GREEN + fmt/clippy。
- [ ] **Step 5: Commit** — `feat(helm): expose Chart.yaml in local chart detail`

---

### Task 3: Profiles 存储 + 3 个命令

**Files:**
- Create: `crates/k7s-core/src/kube/helm/profiles.rs`
- Modify: `crates/k7s-core/src/kube/helm/mod.rs`（同款 cfg 门控 `pub mod profiles;`）
- Modify: `crates/k7s-commands/src/commands/helm.rs` + `registry.rs` + `lib.rs`
- Test: `profiles.rs` in-file tests

**Interfaces:**
- Produces:

```rust
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct HelmProfile {
    pub name: String,
    pub chart_ref: String,          // repo/name 或本地绝对路径
    pub version: String,            // 空 = latest
    pub namespace: String,
    pub values: String,             // values.yaml 文本
    pub set: Option<k7s_deps::serde_json::Map<String, k7s_deps::serde_json::Value>>,
    pub atomic: bool,
    pub force: bool,
    pub create_namespace: bool,
    pub timeout_secs: Option<u64>,
    pub created_at: String,         // RFC3339
}
pub fn load_profiles(dir: &Path) -> Vec<HelmProfile>;                  // 文件缺失/损坏 → 空
pub fn save_profile(dir: &Path, p: HelmProfile) -> AppResult<Vec<HelmProfile>>;  // 按 name upsert，返回全量（按 name 排序）
pub fn delete_profile(dir: &Path, name: &str) -> AppResult<Vec<HelmProfile>>;
pub fn validate_profile_name(name: &str) -> AppResult<()>;             // 非空、≤64、[a-zA-Z0-9-_]
```

wire 命令：`helm_profile_list {} -> [HelmProfile]`、`helm_profile_save {profile: HelmProfile} -> [HelmProfile]`、`helm_profile_delete {name} -> [HelmProfile]`。文件路径 `<dir>/helm-profiles.json`；命令层传 `mgr.data_dir`。审计：save/delete 记 `helm_profile_save`（name/chart_ref）/`helm_profile_delete`（name）。

- [ ] **Step 1: 失败测试** — upsert 覆盖同名、delete 不存在报 NotFound、损坏 JSON → 空表、name 校验（空/超长/非法字符）、round-trip 字段不丢（含 set map 与 timeout_secs）。
- [ ] **Step 2:** RED。
- [ ] **Step 3: 实现** — 原子写（tmp + rename，参照 prefs 或 sbom_storage 现有写文件模式；若无先例则 write tmp 同目录 + rename）。created_at 由命令层填（`k7s_deps::chrono::Utc::now().to_rfc3339()`），save 时若 name 已存在保留原 created_at。
- [ ] **Step 4:** GREEN + workspace check + fmt/clippy。
- [ ] **Step 5: 命令层 + registry + lib.rs**（同 Task 1 模式；Args: `HelmProfileSaveArgs { profile: k7s_core::kube::helm::profiles::HelmProfile }`、`HelmProfileDeleteArgs { name }`）。reconciliation 过。
- [ ] **Step 6: Commit** — `feat(helm): deployment profiles — store + list/save/delete cmds (+audit)`

---

### Task 4: 前端 provider / i18n / mock / HttpProvider 清理

**Files:**
- Modify: `frontend/src/providers/types/helm.ts`（`HelmProfile` 接口 + `RenderPreview` 无需类型——string）
- Modify: `frontend/src/providers/types/provider.ts` + `BaseRpcProvider.ts`（`helmRenderPreview(chart, version, values): Promise<string>`、`helmProfileList(): Promise<HelmProfile[]>`、`helmProfileSave(p: HelmProfile)`、`helmProfileDelete(name: string)`）
- Modify: `frontend/src/providers/HttpProvider.ts` —— **删除 `helmRunOp` 的 notImplemented stub**（BaseRpcProvider 的通用 invoke 实现自动生效；保留 `onHelmOpLog` 订阅不动）
- Modify: `frontend/src/providers/mock/mockHelm.ts` + MockProvider 接线
- Modify: `frontend/src/lib/i18n/en.ts` / `zh.ts` / `dictionaries.ts`

**Interfaces (TS):**

```ts
export interface HelmProfile {
  name: string; chartRef: string; version: string; namespace: string;
  values: string;
  set?: Record<string, unknown> | null;
  atomic: boolean; force: boolean; createNamespace: boolean;
  timeoutSecs?: number | null; createdAt: string;
}
```

i18n 键：`helm.local.render.title/button/empty/stats`；`helm.local.diff.title/pickA/pickB/identical`；`helm.profiles.save/load/manage/namePlaceholder/saved/deleted/confirmDelete/upgradeTitle/upgradeRelease/upgradeNamespace/previewDiff`（en+zh 双语，dictionaries.ts 类型同步）。

- [ ] **Step 1:** 类型 + BaseRpcProvider 4 方法 + 删 HttpProvider.helmRunOp stub + mock（mockHelm Mixin 模式，参照 P0）。
- [ ] **Step 2:** `pnpm typecheck && pnpm test -- --run`（全绿，含 P0 套件不回归）。
- [ ] **Step 3: Commit** — `feat(frontend): render/profiles provider API + i18n; drop stale helmRunOp stub`

---

### Task 5: 渲染预览 + 两版本 Diff（LocalCharts 详情区）

**Files:**
- Create: `frontend/src/components/helm/ChartRenderPreview.tsx`
- Create: `frontend/src/components/helm/ChartVersionDiff.tsx`
- Modify: `frontend/src/components/helm/LocalCharts.tsx`（详情区加「渲染预览」分区入口 + 顶部「版本对比」入口）
- Test: `ChartRenderPreview.test.tsx` + `ChartVersionDiff.test.tsx`

**Interfaces:**
- Consumes: Task 2 的 `detail.chartYaml`；Task 4 的 `helmRenderPreview`；`diffLines/diffStat`（lib/diff.ts:34/111）；`EditorCore`（只读展示渲染结果）。

组件行为：
- `ChartRenderPreview({ detail }: { detail: LocalChartDetail })` —「渲染」按钮 → `helmRenderPreview(detail.entry.path, '', valuesEditor 内容 || detail.valuesYaml)` → 展示 YAML + 资源类型统计（前端解析 `^kind:\s*(\w+)` 计数，Map 排序展示 `Deployment ×2` 徽标）。helm 缺失/失败 → 错误条。
- `ChartVersionDiff({ charts, onClose }: { charts: LocalChartEntry[]; onClose: () => void })` — 两个下拉选 A/B（默认最新两个）→ 并行 `localChartDetail` 两份 → 两块 diff（Chart.yaml / values.yaml，用 `diffLines` + 现有 HelmDiff.module.css 的行样式）+ 元信息行（version A→B）。identical 显示 `helm.local.diff.identical`。

- [ ] **Step 1:** 两个失败测试（mock provider：渲染按钮调用 helmRenderPreview 且展示返回文本含 `kind: Deployment`；diff 选 A/B 后出现 `-`/`+` 行与 version 行）。
- [ ] **Step 2:** RED。
- [ ] **Step 3:** 实现（复用 HelmMarket.module.css 布局类；统计徽标用现有 badge/toned 类若无则内联 span + css module 追加）。
- [ ] **Step 4:** GREEN + 全套件 + typecheck。
- [ ] **Step 5: Commit** — `feat(frontend): local chart render preview + two-version diff`

---

### Task 6: 向导升级模式 + dry-run diff 预览 + Profiles 接线

**Files:**
- Modify: `frontend/src/components/helm/HelmInstallWizard.tsx`
- Modify: `frontend/src/components/helm/LocalCharts.tsx`（详情区「升级已有 Release」表单：release 名 + namespace 输入 → 以 upgrade 模式进向导）
- Test: `HelmInstallWizard.test.tsx` 追加用例

**Interfaces:**
- Consumes: `helmReleaseHistory(name, ns)`（provider.ts:332）取 revisions[0].revision → `helmManifestRevision(ns, name, rev)` 取当前 manifest；`helmRunOp`（Task 4 清理后 web 也可用）；`helmProfileList/Save`；Task 4 的 i18n `helm.profiles.*`。

向导扩展（props 再增一项，三选一语义：`chart` / `localChart` / `localUpgrade?: { detail: LocalChartDetail; release: string; namespace: string }`）：
- upgrade 模式：release/namespace 只读预填；op 为 `{ op: 'upgrade', args: { release, chart: path, version: '', namespace, values, ...profileFlags } }`；review 步新增「与当前 Release 对比」：拉当前 manifest，与 `helmRenderPreview(path, '', values)` 结果 diffLines 展示（注明 caveat：helm template 输出与 dry-run manifest 存在元数据差异，属预期）。
- Profiles：values 步加「加载方案」下拉（helmProfileList 过滤 chartRef 相同项）+「保存为方案」按钮（名称输入 → helmProfileSave 组装 HelmProfile，flags 从当前表单收集）。flags 控件：P0 向导无 set/atomic 控件，本任务补 atomic/createNamespace 两个 checkbox + timeout 数字输入（force/set 暂不进 UI，YAGNI——wire 已支持）。

- [ ] **Step 1:** 失败测试：upgrade 模式渲染时提交的 op 是 upgrade 且 chart=path、version 空；「与当前 Release 对比」出现 diff 行；保存方案调用了 helmProfileSave 且 payload 字段 camelCase。
- [ ] **Step 2:** RED。
- [ ] **Step 3:** 实现。LocalCharts 详情区：upgrade 表单校验 release 名非空后才可进入向导。
- [ ] **Step 4:** GREEN + 全套件 + typecheck。
- [ ] **Step 5: Commit** — `feat(frontend): wizard upgrade mode w/ dry-run diff + profiles save/load`

---

### Task 7: 文档 + 收尾全量验证

**Files:**
- Modify: `docs/USAGE.md`（本地 Charts 库小节内追加：渲染预览 / 版本对比 / 升级预览 / Profiles 用法）
- Modify: `CHANGELOG.md`（Unreleased 段追加 P1 条目）

- [ ] **Step 1:** 文档（与 P0 同风格，中文；说明渲染预览无需集群、diff 的元数据 caveat、Profiles 存储位置 `<data_dir>/helm-profiles.json`）。
- [ ] **Step 2:** 全量验证（worktree 根）：`cargo test --workspace`、`cargo test -p k7s-server --features web`、`cargo fmt --all --check`、clippy；`cd frontend && pnpm test -- --run && pnpm typecheck && pnpm build`。已知 flaky：`web::auth::tests::resolve_token_round_trips_file`（预存在环境变量竞态，重跑一次即计通过）。
- [ ] **Step 3: Commit** — `docs: P1 render/diff/upgrade-preview/profiles usage + changelog`

---

## Self-Review 记录

- Spec §5 P1 覆盖：渲染预览 → Task 1+5；两版本包 diff → Task 2+5；升级 dry-run diff → Task 6；Profiles → Task 3+4+6。P2（lint/verify/package、依赖管理、MCP 工具）不在本计划。
- 类型一致性：`HelmProfile` Rust/TS 字段一一对应（camelCase + serde rename_all）；`render_chart_templates` 的四参签名在 Task 1 定义、命令层消费；`chart_yaml` 在 Task 2 定义、Task 5 消费。
- 遗留决定：HttpProvider 陈旧 `helmRunOp` stub 的删除放在 Task 4（upgrade 模式依赖 web 通道真实可用）；wizard flags UI 只做 atomic/createNamespace/timeout（P0 wire 已支持全量，UI 按需暴露）。
