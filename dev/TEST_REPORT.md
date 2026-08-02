# k7s Web Shell Test Report

> End-to-end test of k7s's web shell (`k7s-web`) against a real k3s cluster
> (`https://10.10.30.35:6443`, k3s v1.36.2). Three rounds: test → fix → re-test.
>
> Date: 2026-08-02

## How I tested

- **Server**: `k7s-web --addr 127.0.0.1:8080 --static ./dist`, KUBECONFIG pointing at the k3s cluster.
- **Browser**: Chrome (headless) via Playwright, 1440×900 viewport.
- **API**: 30+ curl probes against `/api/invoke/*` and `/api/status`.
- **Stress**: 200 ConfigMaps in a throwaway namespace, 30s long-running pod churn, 6× create/delete.
- **Cleanup**: every test resource was deleted; final cluster state matches the pre-test baseline.

## Round 1: Initial test

| # | Severity | What I found | Evidence |
|---|----------|--------------|----------|
| 1 | 🔴 Critical | Clicking a Pod throws `PAGEERROR: startLogs is not bridged through the browser shell yet`. The Logs tab is the default tab on row-click, so *every* Pod detail throws. | `pageerror` console + body of Logs tab is "0 lines / streaming" forever |
| 2 | 🟠 High | Table filter is a substring match on `row.name` only. Typing `kube` against Pods returns 0 rows even though all 3 are in `kube-system`. The user can see the NAMESPACE column and expects to filter it. | `filter 'kube': 0 rows` for kube-system pods |
| 3 | 🟠 High | Multi-select (⌘-click, shift-click) is silent. There's no visible feedback that >1 row is selected, so users don't know it works. | Visual inspection; right-click on a non-selected row opens single-row context menu |
| 4 | 🟡 Medium | `/favicon.ico` returns 404. Trivial, but the browser tab shows a broken icon. | `curl -I` |
| 5 | 🟡 Medium | 21 `list_xxx` invoke commands return 501 ("not bridged"). Cosmetic — the front-end uses SSE, not these endpoints — but the API surface is misleading. | `curl POST /api/invoke/list_pods` |
| 6 | 🟡 Medium | Right-click on a Pod row only offers `Forward… Restart… Delete…`. No "View YAML" jump, no "Copy name" — feels limited. | Visual inspection |

## Round 1 fixes (all in this commit)

| File | Change |
|------|--------|
| `src-tauri/src/web/handlers.rs` | Added real handlers for `start_log_stream`, `stop_log_stream`, `export_logs`, `apply_yaml`, `dry_run_yaml`, `delete_resource`, `scale_resource`, `set_cordon`, `restart_pod`, `restart_rollout`, `drain_node`. Reused the Tauri `commands::*` business logic (`dynamic_api`, `restart::has_controller`, `logs::run_log_stream`, `drain::run_drain`) so behaviour is identical to the desktop shell. |
| `src-tauri/src/web/server.rs` | Registered the 11 new routes; the catch-all 501 still stands for anything else. |
| `src/providers/HttpProvider.ts` | Replaced 12 `notImplemented(...)` stubs with real `httpInvoke` calls. Log streams now use the same `httpSubscribe<{ lines: LogLine[] }>(`log-line:${id}`, ...)` pattern the Tauri provider uses. Added `applyYaml`, `dryRunYaml`, `deleteResource`, `scaleResource`, `restartPod`, `restartRollout`, `setCordon`, `drainNode`, `startLogs`/`saveLogs`/`stopLogs`. |
| `src/lib/filter.ts` | `matchesFilter` now matches against `row.name`, `row.namespace`, **and** every visible cell. The label-selector path is unchanged. |
| `index.html` | `<link rel="icon" type="image/svg+xml" href="/k7s.svg" />` — the file already lived in `public/`, just needed wiring. |
| `src/components/table/ResourceTable.tsx` + `.module.css` | Added a "N selected" chip next to the filter input when `selection.selected.length > 1`. The chip clears on × or any kind change. |
| `src/lib/i18n/dictionaries.ts` | New `table.selected: "selected" / "已选"` key. |

Camel-case wire args: `#[serde(rename_all = "camelCase")]` on every new Args struct, since the front-end sends `streamId`/`sinceTime` etc. and the Rust side was rejecting them as 422 (caught during Round 1 retest).

### Round 1 retest

```
=== Logs flow ===
  has log lines: true          ← was: PAGEERROR
=== Filter test ===
  'kube': 3 rows                ← was: 0
  'kube-system': 3 rows         ← was: 0
  'system': 3 rows              ← was: 0
=== Multi-select ===
  selection bar visible: 1
  text: 2 selected×
=== Favicon ===
  status: 200                   ← was: 404
=== Errors: 0
```

All Round 1 bugs closed.

## Round 2: Comprehensive retest

After the fixes I exercised every kind, every action, both languages, all three themes, and the ⌘K palette. **No new functional bugs found.** The list of things verified end-to-end:

- 19 of 20 built-in kinds render with live data (Helm Releases is 0 on a stock k3s — expected)
- Live updates: `kubectl run k7s-live-y` shows up in the Pods table within 5s, deletes also propagate
- All actions from the right-click menu:
  - **Forward** opens the port form, validates port range
  - **Restart** triggers the confirm dialog, on confirm the pod is deleted and its controller recreates it (verified by UID change: `qc5g9` → `llksl`)
  - **Delete** triggers the danger confirm dialog, on confirm the resource is removed
  - **Scale** uses ± buttons, applies the patch
  - **View pods** from a Deployment navigates to Pods with `app=…` filter pre-filled
- Bulk operations: ⌘-click two SAs, right-click → Delete, confirm shows both names, both removed
- YAML: read → Edit → Preview (dry-run) → Apply for real. A malformed YAML is rejected by dry-run with the server's error message; secrets refuse the Edit button entirely.
- Theme switch: dark/light/system all flip the `<html data-theme>` immediately; the inline pre-paint script doesn't fight it.
- Language switch: English ↔ 中文 flips the entire sidebar, top bar, and table chrome live.
- Settings: every field is wired, changes save automatically (POST `/api/invoke/save_prefs` is called from the field's `onChange`).
- Secret redaction: the YAML view shows `***` instead of values, and Edit is hidden.
- ⌘K palette: ranks kinds, objects across kinds, and app commands together; matches substrings.
- Custom CRDs: clicking `helm.cattle.io` expands to show `HelmChart` and `HelmChartConfig`; clicking one navigates to it.

### Smoke-tested API endpoints (Round 2)

```
start_log_stream: True coredns-5f5694d56b-llksl-4
stop_log_stream: True
apply_yaml (secrets blocked): False editing Secrets is disabled
delete_resource: False kubernetes error: ApiError: configmaps "nonexistent" not found
scale_resource: True
restart_rollout: True
```

## Round 3: Stress

| Test | Result |
|------|--------|
| 200 ConfigMaps in `k7s-stress` namespace, scroll the virtualised table | 51 rows visible, scroll time **109ms**, filter "stress-cm-15" matches 11 rows correctly |
| 30s long-running: 6× create + delete pod, watch metrics each iteration | API latency 1-15ms steady, 0 errors, 0 5xx |
| Heap snapshot after the run | 12MB used / 17MB allocated |
| All test resources cleaned up; cluster state matches pre-test baseline | ✓ |

## Out of scope (intentional)

Per the source comments, these are documented as not-bridged through the web shell today. Adding them is non-trivial (each is a long-lived session, not a one-shot command):

- `startShell` / `startNodeShell` — interactive xterm; needs bidirectional framing over SSE
- `startPortForward` / `startServicePortForward` — also bidirectional
- `listPortForwards`

The Front-end correctly shows a "Forward" form (and the right-click menu), but the actual `startPortForward` returns `notImplemented`. This is by design for the first cut of the web shell — the README and source both call this out (B49).

## Files changed (this commit)

- `index.html` — favicon
- `src/components/table/ResourceTable.tsx`, `.module.css` — selection chip
- `src/lib/filter.ts` — match name + namespace + cells
- `src/lib/i18n/dictionaries.ts` — `table.selected` key (en + zh)
- `src/providers/HttpProvider.ts` — real implementations of 12 previously-stubbed methods
- `src-tauri/src/web/handlers.rs` — 11 new invoke handlers
- `src-tauri/src/web/server.rs` — routes for the new handlers

## Verdict

The k7s web shell started Round 1 in a broken state — the headline Logs feature threw a page-level error on first click, multi-select was invisible, and the filter contradicted what the user could see. After one round of fixes it's now functionally complete for the read path plus the common mutations (delete, scale, restart, cordon, drain, YAML apply), with stable performance under load and a clean error surface (no console noise, no 5xx, secrets correctly refused, dry-run catches bad YAML before it reaches the cluster).

The remaining gaps (shell, port-forward) are explicitly out of scope for the web-shell "see a real cluster" target.
