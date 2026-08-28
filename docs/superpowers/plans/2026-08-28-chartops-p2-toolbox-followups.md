# ChartOps P2 + 评审跟进清单 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 ChartOps 工具箱（helm lint / verify / package / dependency 管理 + MCP 工具），并清掉 P0/P1 评审留下的全部跟进项（死命令弃用、Profiles 删除 UI、预存在 bug 修复、竞态守卫）。

**Architecture:** P2 的四个 CLI 包装（lint/verify/package/deps）落 `local.rs`（resolve → helm argv → 共享 capture helper），`ops.rs` 新增 `helm_capture` 通用捕获函数；命令面 4 个新 registry 命令；MCP 按 `mcp/tools/helm.rs` 现有 Params+注册宏模式补 5 个工具。跟进清单全是小修：前端 5 处 + 后端 3 处，模式均已在代码库中存在。

**Tech Stack:** Rust (tokio process), React 19 + vitest, rmcp。无新增依赖。

## Global Constraints

- 沿用分支全部既有约束：移动端单层 `#[cfg(not(any(target_os = "ios", target_os = "android")))]`；wire camelCase + **wire 形状 serde round-trip 测试必须有**（P1 wire 缺陷教训）；写操作审计；`k7s_deps::` 依赖路径；cargo 用 `CARGO_TARGET_DIR=/Users/zhangyi/my_project/k7/target`（worktree `/Users/zhangyi/my_project/k7/.worktrees/chartops-p0`，分支 `feat/chartops-p0-local-chart-library`，PR #40）。
- 新 registry 命令必须同步 `crates/k7s-commands/src/lib.rs` 的 `register_commands!` 宏与 `COMMAND_NAMES`（reconciliation 测试强制）。
- i18n en.ts + zh.ts + dictionaries.ts 类型三处同步；`t()` 带 fallback。
- MCP 新工具：read-only 语义（list/render/lint/deps-list 只读；package/deps-build/deps-update 是本地文件操作、不触集群——与现有 helm_add_repo 等本地写操作同级别，允许）。
- 已知预存在 flaky：`web::auth::tests::resolve_token_round_trips_file`（Task 2 修复它）。

---

### Task 1: 前端跟进清单（5 处小修，全部带测试）

**Files:**
- Modify: `frontend/src/components/actions/HelmRollbackForm.tsx`（~line 161）
- Modify: `frontend/src/components/helm/HelmInstallWizard.tsx`（repo-chart values 预填，~line 147-156）
- Modify: `frontend/src/components/helm/LocalCharts.tsx`（openFile 竞态守卫 + Profiles 删除按钮）
- Modify: `frontend/src/components/helm/ChartRenderPreview.tsx`（values 安全校验）
- Test: 各文件对应 `*.test.tsx`

**逐项：**

1. **HelmRollbackForm 排序 bug（预存在）**：helm history 返回最新在前（P1 终审已对照 helm 源码确认），`revs[revs.length - 2]` 实际选中第二旧而非「上一个」。改为 `revs[1]`（第二个 = 上一个 revision），注释更正。测试：mock 3 条 history（rev 3/2/1 最新在前），断言默认选中 2。
2. **repo-chart values 预填失败（预存在）**：向导 values 步调 `helmRenderDefaultValues(chart.name, selectedVersion)`，但后端 `helm show values <chart>` 需要 `repo/name`。改为 `chart ? \`${chart.repo}/${chart.name}\` : ...`（仅 repo-chart 分支；localChart 分支不受影响）。测试：repo 模式断言以 `repo/name` 调用。
3. **LocalCharts openFile/openDetail 竞态守卫**（P0 遗留）：用 `useRef<number>` 单调请求 id（参照 HelmInstallWizard 的 `diffReqRef` 模式），过期响应丢弃。测试：持有第一个 fetch、切换选中、放行旧响应，断言不渲染。
4. **Profiles 删除 UI**：向导「加载方案」行旁加删除按钮（选中 profile 后可用）→ ConfirmDialog（复用 P0 模式，title 用新 i18n key `helm.profiles.manage`，body 用已有 `helm.profiles.confirmDelete`）→ `helmProfileDelete(name)` → 刷新列表。i18n 如缺 key 则 en/zh/dictionaries 补齐。测试：mock 删除被调用且列表刷新。
5. **ChartRenderPreview values 安全校验**：渲染前对编辑后 values 跑现有 `isSafeHelmValues`（`lib/security`，向导同款），不过则错误条（复用其报错文案模式）。测试：恶意 values（如含 `--{`）不触发 helmRenderPreview。

**Steps:** 每项 TDD（先失败测试→修→过）；全量 `pnpm typecheck && pnpm test -- --run` 绿后一次提交：
`fix(frontend): review follow-ups — rollback default rev, repo values prefill, race guards, profile delete UI`

---

### Task 2: 后端跟进清单（3 处）

**Files:**
- Modify: `crates/k7s-commands/src/commands/helm.rs` + `registry.rs` + `lib.rs`（死命令移除）
- Modify: `crates/k7s-core/src/kube/helm/market.rs`（import_chart/list_local_charts 若无其他调用者一并删，先 grep 确认：`grep -rn "import_chart\|list_local_charts" crates/ --include="*.rs"`）
- Modify: `crates/k7s-core/src/kube/helm/profiles.rs`（values 上限）
- Modify: `crates/k7s-server/src/web/auth.rs`（tests 模块，flaky 修复）
- Test: profiles.rs tests + auth.rs tests

**逐项：**

1. **死命令移除**：`helm_import_chart` / `helm_local_charts` 从 commands/helm.rs（tauri fn + impl + Args）、registry.rs、lib.rs 宏 + COMMAND_NAMES 全部移除；`market.rs::import_chart/list_local_charts/chart_cache_dir` 若 grep 确认无其他调用者一并删除（P0 时前端已切换新命令，`helm-local-charts/` 缓存目录遗留磁盘上不迁移不删除）。验证：`cargo test -p k7s-commands` reconciliation 过 + `cargo check --workspace`。
2. **Profiles values 上限**：`save_profile` 校验 `p.values.len() <= 256 * 1024`，超限 `AppError::Other("profile values exceed 256 KiB limit")`。测试：256KiB+1 拒绝、恰好 256KiB 通过。
3. **flaky auth 测试修复（预存在）**：`web::auth::tests` 中设置/清除进程全局 `K7S_WEB_TOKEN` 环境变量的测试在并行 runner 下互踩。修法：测试模块内 `static ENV_LOCK: Mutex<()>`，涉及的测试（grep `K7S_WEB_TOKEN` in auth.rs tests）持锁运行。验证：`for i in 1 2 3 4 5; do cargo test -p k7s-server --features web resolve_token; done` 全过。

**Steps:** 逐项改 + 验证，一次提交：
`fix(helm): drop dead import/local-charts cmds, profile values cap, serialize flaky auth env test`

---

### Task 3: P2 — helm lint / verify

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/ops.rs`（新增 `pub(crate) async fn helm_capture(args: Vec<String>, kubeconfig: Option<&str>) -> AppResult<String>`：which_helm → 可选 kubeconfig 临时文件（`--kubeconfig`，同 render 模式）→ capture stdout、非零退 出含 stderr 报错）
- Modify: `crates/k7s-core/src/kube/helm/local.rs`（`pub async fn lint_chart(root: &Path, id: &str) -> AppResult<String>`：resolve → `helm lint <path>`；`pub async fn verify_chart(root: &Path, id: &str) -> AppResult<String>`：仅 Tgz（Dir 报错 "verify requires a packaged chart (.tgz)"）→ `helm verify <path>`）
- Modify: `crates/k7s-commands/src/commands/helm.rs` + `registry.rs` + `lib.rs`（`local_chart_lint {id}` / `local_chart_verify {id}`，camelCase Args，审计：lint/verify 只读不记审计）
- Test: local.rs in-file tests——helm 不存在时返回清晰错误（用不存在的 HELM 路径环境注入不可行则测 argv 构造：抽 `fn lint_argv(path) / verify_argv(path)` 纯函数并测）；Dir 调 verify 报错测试。

**Steps:** TDD → 实现 → `cargo test -p k7s-core helm::` + reconciliation → fmt/clippy → 提交：
`feat(helm): local chart lint + verify via helm CLI`

---

### Task 4: P2 — helm package / dependency

**Files:**
- Modify: `crates/k7s-core/src/kube/helm/local.rs`
- Modify: 命令层三件套（同 Task 3 模式）
- Test: local.rs in-file tests

**逐项：**

1. **package**：`pub async fn package_chart(root: &Path, id: &str) -> AppResult<LocalChartEntry>`——仅 Dir（Tgz 报错 "already packaged"）→ `helm package <dir> --destination <root>` → 成功后 `parse_tgz_metadata` 新包返回 entry；审计 `local_chart_package {id}`。argv 纯函数 `package_argv(dir, dest)` + 测试。
2. **dependency**：`pub async fn chart_deps(root: &Path, id: &str, action: DepsAction) -> AppResult<String>`，`pub enum DepsAction { List, Build, Update }`（serde lowercase）→ `helm dependency list|build|update <path>`。命令 `local_chart_deps {id, action}`；List 只读不审计，Build/Update 审计 `local_chart_deps {id, action}`。argv 纯函数 + 测试；无效 action 反序列化报错测试。

**Steps:** TDD → 实现 → 全链验证 → 提交：
`feat(helm): package dir charts + dependency list/build/update`

---

### Task 5: P2 — 前端接线（lint/verify/package/deps + i18n + mock）

**Files:**
- Modify: `frontend/src/providers/types/helm.ts`（`type ChartDepsAction = 'list' | 'build' | 'update'`）
- Modify: `frontend/src/providers/types/provider.ts` + `BaseRpcProvider.ts`（`localChartLint(id): Promise<string>`、`localChartVerify(id): Promise<string>`、`localChartPackage(id): Promise<LocalChartEntry>`、`localChartDeps(id, action): Promise<string>`）
- Modify: `frontend/src/providers/mock/mockHelm.ts` + MockProvider 接线
- Modify: `frontend/src/components/helm/LocalCharts.tsx`（详情区「工具箱」操作行：Lint / Verify（仅 tgz）/ Package（仅 dir）/ Deps 下拉（list/build/update）→ 输出走已有的输出查看区（复用 ChartRenderPreview 的只读展示或简单 pre），package 成功后刷新列表并提示新 entry）
- Modify: `frontend/src/lib/i18n/en.ts` + `zh.ts` + `dictionaries.ts`（`helm.local.tools.{lint,verify,package,deps,depsList,depsBuild,depsUpdate,run,onlyTgz,onlyDir,packaged}`，en/zh 双语）
- Test: LocalCharts.test.tsx 追加——Lint 按钮调用 provider 并展示输出；dir 型 verify 按钮禁用；package 成功刷新列表。

**Steps:** TDD → 实现 → 全套件 + typecheck → 提交：
`feat(frontend): chart toolbox — lint/verify/package/deps actions`

---

### Task 6: P2 — MCP 工具补全（5 个）

**Files:**
- Modify: `crates/k7s-server/src/mcp/tools/helm.rs`（Params 结构体 + 工具函数体，模式照抄现有 `helm_show_values` 等：`json_result`/`tool_error` helpers）
- Modify: `crates/k7s-server/src/mcp/server.rs`（`#[tool]` 方法注册 + 描述；如有工具清单 doc/宏列表同步）
- Test: 若 tools 层有测试先例则跟随；否则验证靠 `cargo check -p k7s-server --features web` + 现有 MCP 测试不回归

**5 个工具（Params 字段 camelCase，schemars derive 同现有）：**

1. `helm_local_charts` {} → `local::scan_local_charts(<data_dir>/charts)` 列表（借 `crate::mcp::kube_api` 或 manager 拿 data_dir 的方式与现有工具取 CoreState 一致——读 `helm::helm_history` 怎么拿 manager/state 再写）
2. `helm_render_preview` {chart, version, values} → `ops::render_chart_templates`
3. `helm_lint_chart` {id} → `local::lint_chart`
4. `helm_package_chart` {id} → `local::package_chart`（写本地文件，与 helm_add_repo 同级别允许）
5. `helm_chart_deps` {id, action} → `local::chart_deps`

工具描述写明用途（供 AI 客户端选择）。验证：`cargo check -p k7s-server --features web && cargo test -p k7s-server --features web`；server.rs 里若有工具计数/清单文案（grep `96 个\|tools` 或工具列表注释）同步更新。

**Steps:** 实现 → 编译/测试 → 提交：
`feat(mcp): local chart tools — list/render-preview/lint/package/deps`

---

### Task 7: 文档 + 收尾全量验证

**Files:**
- Modify: `docs/USAGE.md`（工具箱小节：lint/verify/package/deps 用法与约束——verify 仅 tgz、package 仅 dir、deps 需网络拉依赖时走 build/update）
- Modify: `CHANGELOG.md`（Unreleased 追加 P2 + 跟进修复条目，含 MCP 工具计数更新）

**Steps:**
1. 文档（中文，同风格，数字/名称对代码）。
2. 全量验证：`cargo test --workspace`、`cargo test -p k7s-server --features web`、`cargo fmt --all --check`、`cargo clippy --workspace --all-targets`、`cd frontend && pnpm test -- --run && pnpm typecheck && pnpm build`。全绿（Task 2 后 auth flaky 应不再出现）。
3. 提交：`docs: P2 toolbox + follow-up fixes usage + changelog`

---

## Self-Review 记录

- Spec §5 P2 覆盖：lint/verify → Task 3；package → Task 4；helm dependency → Task 4；MCP 工具补全 → Task 6（含 render_preview 工具化）。跟进清单 8 项全部落位：Task 1（5 项前端）+ Task 2（3 项后端）。
- wire 一致性：4 个新命令 camelCase Args + registry/宏/COMMAND_NAMES 三表同步；`DepsAction` serde lowercase 与 TS `'list'|'build'|'update'` 对齐；MCP Params camelCase + schemars。
- 审计边界：lint/verify/deps-list 只读不审计；package/deps-build/deps-update 审计——与 P0/P1 口径一致（写本地状态才审计）。
- MCP 侧不新增鉴权面（/mcp 已有 token 语义，v0.5.2 评审后已加）。
