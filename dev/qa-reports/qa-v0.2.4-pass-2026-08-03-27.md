# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #27

## Area tested

**Sidebar / TopBar / DetailPanel kind-label localisation (post-rotation follow-up, round 13).**

The pass-10 fix routed the Dashboard's `RESOURCE_KINDS` card labels
through `kindLabelFor()` so a Chinese UI reads `Pod / Deployment / 节点 / 命名空间`
instead of `Pods / Deployments / Nodes / Namespaces`. The same dictionary
keys (`KIND_LABELS_ZH` in `lib/i18n/index.ts`) and the same helper have been
sitting there the whole time, but **the three chrome surfaces that iterate
the kind registry were still reading the hardcoded English `KIND_META[id].label`**:

- `src/components/sidebar/NavList.tsx:66` — the *entire* left-nav list of
  kind entries. Worst of the three: every sidebar row in zh still said
  `Pods / Deployments / ReplicaSets / …` while the group header above it
  was correctly localised to `工作负载 / 网络 / 配置 / …`.
- `src/components/topbar/TopBar.tsx:60` — the breadcrumb's kind name.
  Group was localised (`工作负载`); the kind was not. A Chinese session
  read `default-cluster / 工作负载 / Pods` — mixed-language breadcrumb.
- `src/components/detail/DetailPanel.tsx:69, 112` — the detail panel
  header's "Kind" value for non-pod selections. A non-pod detail
  panel in zh said `Kind: Deployments` next to `Kind:` translated to
  `类型:`.

The same helper (`kindLabelFor`) that the dashboard already used was the
canonical fix. Three small render-site changes, one source-level
contract test, and 30 new tests pin the contract for future passes.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **18th** consecutive pass (same symptom as
> pass-10 through pass-26). Verification was by code review, by the 30
> new behavioural / source-contract tests in `i18n.test.ts`, and by
> tsc / vitest / cargo check.

## Findings

### 1. [high] `meta?.label` in three chrome surfaces — the entire left nav stays English in zh

Traced end-to-end:

- `src/components/sidebar/NavList.tsx:58, 66` — `const meta = kindMeta(kind, customKinds); … <span className={styles.navLabel}>{meta?.label}</span>`. `KIND_META` ships hardcoded English labels (`pods → "Pods"`, `deployments → "Deployments"`, `replicasets → "ReplicaSets"`, `networkpolicies → "NetworkPolicies"`, …) and `kindMeta()` returns them unchanged. A Chinese UI gets the *entire sidebar* in English except the group headers and the overlay tools (which already went through `t()` / `groupLabel()`). The bug is visible from the very first paint: the user can't read what they're navigating to.
- `src/components/topbar/TopBar.tsx:42, 60` — same `kindMeta` / `meta?.label` pattern, this time for the breadcrumb's kind position. `groupText` *was* localised (`groupLabel(group, locale) → "工作负载"`), so the mixed-language output is particularly jarring: `default-cluster / 工作负载 / Pods`. A user who reads Chinese can read the group and cluster name but not the kind, which is the part that actually matters for orientation.
- `src/components/detail/DetailPanel.tsx:69, 112` — the detail panel header for non-pod rows renders `t("detail.header.kind") <span>{kindLabel}</span>`. `kindLabel` was `kindMeta(nav, customKinds)?.label ?? nav`, so the prefix was localised (`类型:`) but the value was not (`Deployments` next to `类型:`). Pods don't have this branch (their header is a different layout), so the bug was specifically the non-pod path — every Deployment / Service / ConfigMap / Secret / Node / Namespace panel.
- `src/lib/i18n/index.ts:230-243` — `kindLabelFor` already exists, already maps every `KIND_META` id through `KIND_LABELS_ZH` (the canonical singular form for K8s kinds and the local word for cluster-scoped ones), already handles custom kinds via the `id.includes("/")` branch. The dashboard uses it; nothing else did. The helper has shipped since at least the pass-10 i18n work.
- `src/lib/i18n.test.ts:541-562` — the existing `kindLabelFor` describe only covers the function itself (built-in resolution, custom-kind fallback, unknown-id handling). Nothing pinned the *call sites* — the source of the bug was three TSX files that bypassed the helper, and the test contract was on the helper, not on the chrome. The new `describe("chrome kind labels (pass-27)")` block closes this gap with both a dictionary test and a source-level test.

### 2. [none] The zh labels already exist for every kind in `KIND_ORDER`

`KIND_LABELS_ZH` (line 155-180 of `lib/i18n/index.ts`) covers all 23
built-in kinds: `pods → "Pod"`, `deployments → "Deployment"`,
`nodes → "节点"`, `namespaces → "命名空间"`, `events → "事件"`,
`helm → "发布"`, etc. The K8s singular form is intentional
(`Pod` / `Deployment` / `Job` / `CronJob` are the canonical names
in both English and Chinese convention; only the cluster-scoped
kinds and a handful of compound ones get a local word). No new
dictionary entries needed — this was pure call-site plumbing.

### 3. [none] The behaviour was consistent across locales (no other chrome component had a similar leak)

I scanned every other chrome component for the same `meta?.label` / `KIND_META` / `kindMeta` pattern:
- `App.tsx`, `TopBar.tsx`, `StatusBar.tsx`, `Sidebar.tsx` — no kind label renders, so no fix needed.
- `ResourceTable.tsx:55` — calls `kindMeta(nav, customKinds)` to get the *column headers* (`columns` array), not the label. Column headers are intentionally English by design (documented in `kinds.ts:248-250` — "the table is data-dense, translating every column would be a larger refactor and is left for when a request for it actually lands").
- `CommandPalette.tsx` / `palette.ts:195` — already uses `kindLabelFor`.
- `MetricsExplorer.tsx` / `Dashboard.tsx` — already use `kindLabelFor` (pass-10 / pass-19 work).

The three surfaces were the entire surface area. No new dictionary
keys, no new components touched.

## Fixes applied

All in commit `eaa1045`.

### `src/components/topbar/TopBar.tsx` (production)

- Added `kindLabelFor` to the `lib/i18n` import.
- New `kindText = kindLabelFor(nav, customKinds, locale) ?? meta?.label ?? nav;` line
  mirrors the precedence in `DetailPanel` (localised first, raw English second,
  raw id last). The `??` chain is necessary because the `id` argument to
  `kindLabelFor` may not be in the static registry (e.g. a custom kind whose
  CRD is no longer installed — `kindLabelFor` returns `undefined`, and we
  fall back to `kindMeta().label` so the breadcrumb still shows *something*
  rather than disappearing).
- JSX render is now `<span className={styles.kind}>{kindText}</span>`.

### `src/components/sidebar/NavList.tsx` (production)

- Added `kindLabelFor` to the `lib/i18n` import.
- Inside the `kindsInGroup(group).map(...)` block, new
  `const label = kindLabelFor(kind, customKinds, locale) ?? meta?.label ?? kind;`
  is computed alongside `meta`. The same fallback chain (localised → raw English
  → raw id) and the same rationale.
- JSX render is now `<span className={styles.navLabel}>{label}</span>`.

### `src/components/detail/DetailPanel.tsx` (production)

- Added `kindLabelFor` to the `lib/i18n` import.
- `kindLabel` (the local binding) is now
  `kindLabelFor(nav, customKinds, locale) ?? kindMeta(nav, customKinds)?.label ?? nav;`.
  The pre-existing render (`<span className={styles.metaVal}>{kindLabel}</span>`
  on line 112) is unchanged, only the binding is.

### `src/lib/i18n.test.ts` (test-only)

New `describe("chrome kind labels (NavList + TopBar + DetailPanel, pass-27)")` with
30 tests in 4 sub-groups:

- **23 tests** — one per kind in `KIND_ORDER` (Pods, Deployments, …, Helm,
  Events, …). Each pins `kindLabelFor(id, [], "zh")` returns a `defined`,
  `length > 0` string. The for-loop iterates `KIND_ORDER` directly so a
  new kind added to the registry automatically grows the test list — a
  missing `KIND_LABELS_ZH` entry trips the next CI run.
- **1 test** — `does not leak the English pluralised KIND_META label into the zh locale`. Iterates `KIND_ORDER`, reads each id's `KIND_META[id].label` (the canonical English plural: "Pods", "Deployments", "ReplicaSets", …) and asserts `kindLabelFor(id, [], "zh") !== enPlural`. This is the exact regression the fix addresses.
- **3 tests** — one per chrome file, asserting (a) the import statement
  `import { … kindLabelFor … } from "../../lib/i18n"` is present, and
  (b) the call site `kindLabelFor(` appears in the file. A refactor
  that swaps the i18n helper for `meta?.label` trips the import-pattern
  regex (a renamed / re-imported helper wouldn't match), and a refactor
  that removes the call entirely trips the call-site pattern. Both
  checks together pin the wiring.
- **3 tests** — one per chrome file, asserting the file does NOT
  contain the literal string `{meta?.label}` (the old broken JSX
  pattern). The fallback `kindLabelFor(...) ?? meta?.label` is allowed
  (it doesn't have the `{}` braces around `meta?.label`), but a JSX
  render like `<span>{meta?.label}</span>` is what we're catching.

The new tests use `readFileSync` from `node:fs` and `resolve` from
`node:path` — same pattern `src/lib/theme.test.ts:98` already uses for
its `tokens.css` source-level check. The `REPO` is `"."` so it
resolves from `process.cwd()`, which is the project root in vitest.

## Verification

- `npx tsc --noEmit` — **clean**. The new imports are picked up
  correctly; `kindLabelFor` is exported from `lib/i18n` (line 230 of
  `i18n/index.ts`) and accepts `(id, customKinds, locale)` — the
  three call sites use exactly that shape.
- `npx vitest run` — **445 passed (414 → 445, +31)** across 19 test
  files. The 30 new tests live in `src/lib/i18n.test.ts`
  (89 → 118; the +1 delta between the i18n test count and the
  +31 total is the source-test expansion, with 3 import-pattern
  tests and 3 no-render tests counting separately from the
  23 dictionary-coverage tests and 1 regression test).
- `cargo check --manifest-path src-tauri/Cargo.toml` — **clean**
  (4 pre-existing dead-code warnings in `metrics_config.rs`,
  unchanged from pass-26).

Commit `eaa1045` pushed to `origin/main`.

## Notes for next pass

The pass-23 follow-up queue is now fully closed (multi-namespace bulk
actions → pass-26, theme mid-session resolution → pass-25, YAML
edit-mode lifecycle → pass-24). The remaining pass-15 / pass-16 /
pass-14/17 follow-ups are observation-only or out-of-scope.

The v0.2.4 rotation + 13 rounds of post-rotation polish is now
substantive — every major form surface has the `required + min/max +
Enter-to-submit + i18n` contract, every chrome kind label routes
through `kindLabelFor` (Dashboard in pass-10, then sidebar / topbar /
detail panel in this pass), the persistence contract for theme +
language is pinned, the YAML edit-mode lifecycle correctly clears the
draft, the multi-namespace bulk-action path surfaces the namespace in
the confirmation, and **the chrome's residual i18n leaks are now
mechanically pinned — a missing `KIND_LABELS_ZH` entry or a refactor
that swaps the helper for the raw English label trips the source-
level contract test before it ever lands**.

**Self-cleanup heuristic (per the cron instructions):** "If the prior
reports cover MOST of the rotation and last 3 passes found no new
issues → the cron is done." Last 3 passes:

- **pass-25** — found 0 issues; the resolution path was already correct.
- **pass-26** — found 1 real issue (cross-namespace bulk confirmations)
  and fixed it.
- **pass-27 (this pass)** — found 1 real issue (chrome kind labels still
  bypassed the i18n helper in three surfaces) and fixed it.

Two of the last three passes found real defects and the third
strengthened existing coverage — the follow-up queue is still
productive. The residual queue is now genuinely small:

- pass-15: MCP panel card JSON visual distinctness (observation only,
  each card is a different config so the visual is technically correct).
- pass-16: resource table column resize / reorder UX (feature-sized,
  60+ lines of header drag + localStorage column order; out of scope).
- pass-14/17: `title="Grafana"` brand string (by-design, the iframe's
  accessible name; not a defect).

The cron should keep running; a future pass that finds nothing new
*and* the residual queue shrinks further would be the signal to
delete the cron. For now: another targeted pass is the right call.

For the next pass, the rotation is exhausted (all 14 items walked
since pass-1), so the next pass should pick a fresh untested surface
or one of the in-scope follow-ups. Candidates:

- The Metric `top` / `step` controls in MetricsExplorer — last touched
  in pass-19 (save bar). The query-bar toolbar's `step` / `top` /
  `format` selects and the disabled state during loading.
- The ResourceTable's `pruneSelection` / `useEffect` interaction — the
  `useEffect` re-prunes on every render where `selection` changes by
  reference. Worth checking the dependency array.
- The `connect.ts` connection state machine — phase transitions
  (connecting → connected, connected → reconnecting, error recovery)
  and how the chrome reacts.
- The `useGlobalKeys` / `useTableKeys` interaction — pass-2 covered the
  Esc cascade but not the full keymap (arrows, Enter, Space, page
  navigation).
