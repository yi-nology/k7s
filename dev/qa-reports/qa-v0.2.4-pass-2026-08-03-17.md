# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #17

## Area tested

**Chrome i18n sweep round 3 — always-visible chrome still hardcoded
English in zh.** Pass-15/16 left "other small hardcoded `title=`
attributes throughout the codebase" as the open follow-up; pass-17
turns that into a wider sweep across 3 panels that were never in any
prior pass.

The targets were the chrome surfaces that are visible the moment
any session starts (so the leak is the first thing every zh user
sees), and which had **no `t()` call sites at all** — not even
partial i18n:

1. **StatusBar** (`src/components/statusbar/StatusBar.tsx`) — the
   always-visible bottom strip with the cluster name, API latency,
   nodes ready, CPU/MEM, and the active kubectl context. Six labels
   (`api` / `nodes` / `ready` / `cpu` / `mem` / `kubectl ctx:`)
   rendered as raw English even in zh. The dict already shipped
   `chrome.statusbar.*` keys, but they were **function-shaped
   full sentences** (`api: (ms) => "api: ${ms}ms"`,
   `nodes: (ready, total) => "nodes ${ready}/${total} ready"`, …)
   that no call site ever read — so the StatusBar fell through to
   raw literals and the dict's intended translations sat unused.

2. **ClusterSwitcher** (`src/components/sidebar/ClusterSwitcher.tsx`) —
   the dot + status line right under the cluster name at the top
   of the sidebar. Four strings (`connected · v1.28.0` /
   `connecting…` / `disconnected` / `no cluster`) rendered as raw
   English.

3. **MetricsExplorer InstantTable** (`src/components/metrics/MetricsExplorer.tsx`) —
   the two column headers in the instant-query result table
   (`Series` / `Value`) rendered as raw English.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **eighth** consecutive pass (same symptom as
> pass-10 through pass-16). Verification was done by code review,
> HMR / Vite serving the new modules (confirmed the served
> `StatusBar.tsx` calls `t("chrome.statusbar.api")` etc., the served
> `dictionaries.ts` includes the new zh `已连接` / `连接中…` / `已断开` /
> `未选择集群` / `节点` / `就绪` / `序列` / `值` leaves), and
> tsc / vitest / cargo check.

## Findings

### 1. [high] StatusBar renders 6 hardcoded English labels

`src/components/statusbar/StatusBar.tsx:40, 44, 48, 52, 56` (before
this pass) rendered raw literals `api`, `nodes`, `ready`, `cpu`,
`mem`, `kubectl ctx:`. The dict's `chrome.statusbar` block was
function-shaped, designed for "the whole fact as a string" usage
the component never adopted. Net effect: a zh user opened the app
and the bottom strip said `api 24ms  nodes 2/3 ready  cpu 12%  mem
38%  kubectl ctx: kind-test` — the only English on screen outside
the toolbar tabs / detail panel (which pass-15 fixed) and the
in-chart code (technical by nature).

This is the same leak class pass-1 / pass-5 / pass-6 / pass-8 /
pass-10 / pass-12 / pass-13 / pass-14 / pass-15 / pass-16 fixed for
other panels. The dict was already there — it was just shaped
wrong and nothing called it.

### 2. [high] ClusterSwitcher renders 4 hardcoded English status strings

`src/components/sidebar/ClusterSwitcher.tsx:69, 167, 170, 172` (before
this pass) rendered:

- line 69: `connection.clusterName ?? connection.context ?? "no cluster"`
  — the stub when no context is selected.
- line 167: `` `connected · ${version ?? ""}`.trim() `` — the
  status line when the cluster is connected.
- line 170: `"connecting…"` — the in-flight connect state.
- line 172: `"disconnected"` — the error / idle state.

The menu items above (no contexts / import kubeconfig) already
route through `t("chrome.sidebar.*")` — pass-17 picks up the
status line, which was missed.

### 3. [high] MetricsExplorer InstantTable renders 2 hardcoded English headers

`src/components/metrics/MetricsExplorer.tsx:353-354` (before this
pass) rendered `<th>Series</th>` / `<th>Value</th>` as raw
literals. The InstantTable component never imported
`useTranslation`; the outer `MetricsExplorer` function already
used it (for the empty-state copy and the saved-queries bar), so
the local addition is a one-line `const { t } = useTranslation()`
at the top of `InstantTable`.

Same i18n leak class as the pass-8 Alerting column fix (which
added `alerts.cols.*` for 11 column headers).

### 4. [low] `title="Grafana"` on iframe — **observed, not fixed**

`src/components/grafana/GrafanaPanel.tsx:272` has
`title="Grafana"` as the `title` attribute on the `<iframe>`. The
title is used by screen readers (when announcing the iframe) and
as the browser tooltip on hover. "Grafana" is a brand name and
identical in every locale, so this is the lowest-leverage find of
the pass — the iframe is always embedded inside a panel whose
own header is already translated (`grafana.title` / `Grafana` is
the brand title, also same in both locales). The dict could grow
a `chrome.grafana.iframeTitle` key, but the value would be
"Grafana" in both locales, so the only change is one extra dict
entry and one extra `t()` call. Not worth the diff.

### 5. [low] `kubernetes monitor` brand subtitle — **observed, not fixed**

`src/components/sidebar/Sidebar.tsx:21` renders the literal
`kubernetes monitor` as the brand subtitle under the `k7s` logo.
Same as `k7s` itself, this is a brand statement, not a UI
affordance. Translating it would lose the brand voice. Pass-15
already noted the same pattern for `MCP` and other protocol /
brand strings.

## Fixes applied

All in commit `63ee32c`.

### `src/lib/i18n/dictionaries.ts`

**Type definition** — `chrome.statusbar` block is reshaped from
function-shaped to string-leaf-shaped:

```ts
// before
statusbar: {
  api: (ms: number | null) => string;
  nodes: (ready: number, total: number) => string;
  cpu: (pct: number | null) => string;
  mem: (pct: number | null) => string;
  kubectlCtx: (ctx: string | null) => string;
};

// after
statusbar: {
  api: string;        // "api" — the value stays in the component's <b>
  nodes: string;      // "nodes"
  ready: string;      // "ready" (suffix)
  cpu: string;
  mem: string;
  kubectlCtx: string; // "kubectl ctx:" (with colon)
};
```

**New `chrome.clusterSwitcher` block** — 1 function + 3 strings:

```ts
clusterSwitcher: {
  connected: (version: string | undefined) => string; // "connected · v1.28.0" / "connected"
  connecting: string;     // "connecting…"
  disconnected: string;   // "disconnected"
  noCluster: string;      // "no cluster"
};
```

**New `metricsExplorer.instantTable` block** — 2 strings
(`series` / `value`).

**EN dict** — `chrome.statusbar.{api,nodes,ready,cpu,mem,kubectlCtx}`
filled with the original hardcoded labels; the 5 dead function-shaped
keys are dropped. `chrome.clusterSwitcher.*` and
`metricsExplorer.instantTable.*` filled with the original hardcoded
strings. The `connected` function is `(version) => version ?
\`connected · ${version}\` : "connected"` — same behaviour as the
pre-refactor JSX (the `version ?? ""` empty-string trim is
unnecessary because `version` is now `string | undefined` and the
function only interpolates when truthy).

**ZH dict** — `chrome.statusbar.*` is split: `nodes` → `节点`,
`ready` → `就绪`, `kubectlCtx` → `kubectl 上下文:` get the zh noun;
`api` / `cpu` / `mem` stay English (common tech abbreviations in
Chinese docs, no translation gain). `chrome.clusterSwitcher.*`
is `已连接` / `连接中…` / `已断开` / `未选择集群` (natural zh
verbs for the connection state). `metricsExplorer.instantTable.*`
is `序列` / `值` (the canonical zh terms for "time series" /
"value" in a metrics context).

### `src/components/statusbar/StatusBar.tsx`

The component now imports `useTranslation` and the 6 labels route
through `t()`:

```tsx
<span className={styles.fact}>
  {t("chrome.statusbar.api")} <b>{api == null ? "—" : `${api}ms`}</b>
</span>
<span className={styles.fact}>
  {t("chrome.statusbar.nodes")} <b>{ready}/{total}</b> {t("chrome.statusbar.ready")}
</span>
```

The label / value split is preserved (the `<b>` stays on the
value, the label is the surrounding text) — pre-refactor the
dict assumed a `key: value` shape, but the component's
"label <b>value</b>" structure gives the value a stronger colour
and that visual hierarchy is the whole point of the
restructured v2 layout.

### `src/components/sidebar/ClusterSwitcher.tsx`

Line 69: `?? "no cluster"` → `?? t("chrome.clusterSwitcher.noCluster")`.

The `statusDisplay()` helper is changed from returning a
hardcoded `statusText` string to receiving the bound `t`
function as a third argument and routing the 3 status strings
through it:

```ts
function statusDisplay(
  phase: "idle" | "connecting" | "connected" | "error",
  version: string | undefined,
  t: (key: string, ...args: unknown[]) => string,
): { dotColor: string; statusText: string } {
  switch (phase) {
    case "connected":
      return {
        dotColor: "var(--status-ok)",
        statusText: t("chrome.clusterSwitcher.connected", version),
      };
    case "connecting":
      return { dotColor: "var(--status-warn)", statusText: t("chrome.clusterSwitcher.connecting") };
    default:
      return { dotColor: "var(--status-err)", statusText: t("chrome.clusterSwitcher.disconnected") };
  }
}
```

The call site at line 72-76 passes `t` as the third argument.

### `src/components/metrics/MetricsExplorer.tsx`

`InstantTable` gains `const { t } = useTranslation();` at the top
and the two column headers route through `t()`:

```tsx
<th>{t("metricsExplorer.instantTable.series")}</th>
<th>{t("metricsExplorer.instantTable.value")}</th>
```

`useTranslation` is already imported in the parent file
(used by the outer `MetricsExplorer` function), so no new import
is needed.

### `src/lib/i18n.test.ts`

5 new tests in a new describe block "chrome statusbar /
clusterSwitcher / metricsExplorer.instantTable (pass-17 sweep)":

1. `chrome.statusbar.{api,nodes,ready,cpu,mem,kubectlCtx}` as
   label-only leafs in en — pins the type-shape refactor (the
   dict used to ship function-shaped keys).
2. `chrome.statusbar.*` zh with 节点 / 就绪 + CLI-abbrev preservation
   + regression that the old function shape (which had `ms` / `—`
   in the value) is gone.
3. `chrome.clusterSwitcher.{connected,connecting,disconnected,noCluster}`
   in en + the `undefined` version fallback.
4. zh cluster-switcher status with 已连接 / 连接中… / 已断开 / 未选择集群
   + regression that zh does NOT render the English verbs.
5. `metricsExplorer.instantTable.{series,value}` in both locales.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **376 passed (371 → 376, +5 new)**.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean
  (4 pre-existing warnings, unrelated to this pass; same as
  pass-15 / pass-16).
- Vite HMR confirmed serving the updated `StatusBar.tsx` (calls
  `t("chrome.statusbar.api")` / `t("chrome.statusbar.nodes")` /
  `t("chrome.statusbar.ready")` / `t("chrome.statusbar.cpu")` /
  `t("chrome.statusbar.mem")` / `t("chrome.statusbar.kubectlCtx")`),
  `ClusterSwitcher.tsx` (calls `t("chrome.clusterSwitcher.noCluster")` /
  `t("chrome.clusterSwitcher.connected", version)` /
  `t("chrome.clusterSwitcher.connecting")` /
  `t("chrome.clusterSwitcher.disconnected")`), and
  `MetricsExplorer.tsx` (calls
  `t("metricsExplorer.instantTable.series")` /
  `t("metricsExplorer.instantTable.value")`).
- Working tree clean after the commit, pushed to `origin/main`
  (`14531ff..63ee32c  main -> main`).

## Notes for next pass

- **The v0.2.4 rotation + post-rotation residual i18n sweep is
  now in its third round** (pass-15 detail-panel + dashboard,
  pass-16 template titles + Inspect manifest, pass-17 statusbar
  + cluster-switcher + instant-table). Each round found real
  leaks. The remaining residual surface is small: `title="Grafana"`
  on the iframe (brand name, same in both locales — fix is one
  line but value-add is zero), `kubernetes monitor` brand
  subtitle (brand voice, would lose character in zh), and the
  few small `title=` attributes the i18n sweep hasn't touched
  yet (pass-16's "other small hardcoded `title=` attributes
  throughout the codebase" follow-up).
- **In-app Browser render queue is stuck for the eighth
  consecutive pass** — same symptom as pass-10 through pass-16.
  The `/quit` + relaunch recovery path is not available in the
  scheduled-cron context. Pass-17's verification chain was
  code review + HMR / Vite serve + tsc / vitest / cargo check,
  which has caught every i18n bug to date (the dotted-path
  traversal class in particular was caught by reading the TSX
  and the dict side-by-side, not by visual inspection).
- **Future-tagged follow-ups still open** (not addressed by
  this pass):
  - Pass-12: `pattern` attribute on the Helm Market repository
    name input (charset check for `/` / ` ` / `\`).
  - Pass-12: Add button loading / disabled state during submit.
  - Pass-11: "Clear cache" button has no visual feedback;
    save bar has no "edit existing" affordance.
  - Pass-13: empty text fields in Templates form silently fall
    through to defaults via the renderer's `||` fallback; needs
    a coordinated `required` policy decision.
  - Pass-14: other small hardcoded `title=` attributes throughout
    the codebase — pass-17 confirms only `title="Grafana"`
    remains as a brand-name string; the other candidates have
    already been swept.
- **Possible deeper sub-areas for the next pass** (if the cron
  keeps running):
  - MCP server health / status UI (pass-15 suggested this —
    the McpPanel shows the MCP section + 3 cards but no live
    health / latency indicator like the cluster switcher has).
  - Cluster switcher mid-dot separator + version field UX
    (pass-17's `connected · v1.28.0` — what if the version is
    very long? Does it truncate?).
  - WatchFooter pulsing dot + count — already i18n'd, but
    the visual state (pulsing vs static, colour) under
    connect / disconnect could be checked.
  - Resource table column resize / reorder UX.
  - A coordinated `required` policy for the Templates form
    (follow-up from pass-13).
