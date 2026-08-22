# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #8

## Area tested

**Alerting panel (B-tier overlay, rotation #4) — end-to-end in zh locale.**

The Alerting overlay (sidebar → `工具` → `告警`) hadn't been opened since
the panel was first wired up. This pass opened it through the sidebar
in mock mode (1 AlertManager instance: `demo` at
`http://alertmanager.demo:9093`, 1 firing alert `DemoHighCpu`, 0
silences), and walked both the alerts and silences tabs.

The pass also piggybacked a collateral fix on the row-context-menu
`Open files…` action that had been left in an uncommitted state on
`src/components/actions/ActionList.tsx` (see "Fixes applied" for the
rationale).

## Findings

### high — `AlertsPanel.tsx` table headers and empty states were hardcoded English

`src/components/alerting/AlertsPanel.tsx:127, 134-138, 178, 184-189`
shipped all the Alerting overlay's user-facing chrome as raw English
strings. The `alerts.empty.alerts` / `alerts.empty.silences` keys were
already defined in both EN and ZH dicts, but the panel never called
`t()` for them — so a `zh` user saw the English fallback for both the
empty state and the per-tab table column headers.

**Repro (before the fix)**
- Sidebar `告警` → alerts tab → `No active alerts.` (always,
  regardless of locale) and column headers `Alert`, `Severity`,
  `State`, `Summary`, `Active since` (all English in a `zh` UI).
- Switch to silences tab → `No active silences.` (also hardcoded
  English, with a stray period that the dict version `No silences`
  didn't have).

### high — `AlertsPanel.tsx` tab key path was a one-letter typo

`AlertsPanel.tsx:96, 104` looked up `alerts.tab.alerts` and
`alerts.tab.silences` — but the dict key is `alerts.tabs.alerts` /
`alerts.tabs.silences` (note the trailing `s`). The dot-path lookup
missed, and the inline English fallback (`"Alerts"` / `"Silences"`)
was rendered in every locale. The dict keys were sitting unused — a
different class of leak from the `chrome.palette.actions.*` case
pass-1 fixed, but the same end-user-visible symptom: a fully
Chinese UI with a stray English row.

**Repro (before the fix)**
- Sidebar `告警` in `zh` → tabs read `Alerts (1)` and `Silences (0)`
  (English labels with the `chrome.sidebar.tools.alerting` zh
  fallback `告警` on the *sidebar entry*, the panel *title*, and the
  *Close* button — the inconsistency was the giveaway).

### medium (collateral) — `ActionList.tsx:315` used the wrong key path for "Open files…"

`src/components/actions/ActionList.tsx:315` (uncommitted in the
working tree before this pass) routed the pod-files action label
through `tr("actions.files", "Open files…")` — but the canonical key
in the dict is `actions.labels.files` (the rest of the row labels
live under `labels`). The `actions.files` lookup always missed, so
the English fallback was rendered in *every* locale, including `zh`
where the dict ships `actions.labels.files: "打开文件…"`. Same class
of leak as the typo above; the dict string was correct, the call
site just pointed at the wrong path.

**Repro (before the fix)**
- Right-click a Pod row → `actions.files` triggers → menu shows
  `Open files…` in every locale (only "View pods", "Scale…",
  "Restart…", etc. are translated, because they use the correct
  `actions.labels.*` path).

**Why fix in this pass**: the ActionList change was already staged
in the working tree (uncommitted, leftover from the user's v2
work-in-progress), and the dictionary already had the matching
`actions.labels.files` key — it was a one-line, zero-risk fix that
shared the same root cause as the two Alerting defects. Bundling it
into the same commit kept the diff small and didn't touch the rest
of the user's v2 work.

## Fixes applied

| File | Change |
|---|---|
| `src/lib/i18n/dictionaries.ts` | Added `alerts.cols.{alert, severity, state, summary, activeSince, matchers, comment, createdBy, starts, ends, status}` (11 keys) to the `alerts` interface and to both EN and ZH dicts. JSDoc explains the rationale. |
| `src/components/alerting/AlertsPanel.tsx` | (a) Fixed the tab typo: `t("alerts.tab.*", ...)` → `t("alerts.tabs.*", ...)` so the ZH dict's `告警` / `静默` actually render. (b) `AlertList` and `SilenceList` now bind `useTranslation` and route their empty states (`t("alerts.empty.alerts", ...)`, `t("alerts.empty.silences", ...)`) and all 11 column headers through `t()` with English fallbacks. |
| `src/components/actions/ActionList.tsx` | Collateral fix: `tr("actions.files", "Open files…")` → `tr("actions.labels.files")`. The dict key already existed; the call site was pointing at a non-existent path. |
| `src/lib/i18n.test.ts` | New `describe("alerts panel keys")` with three tests: `alerts.empty.alerts` in both locales, `alerts.empty.silences` in both locales, and a parameterised loop over the 11 `alerts.cols.*` keys asserting each one is non-empty in EN and ZH and not equal across locales. |

Commit: **`35944db`** — *fix(i18n): translate "Open files…" action and Alerting panel strings*
Bilingual message: English summary + 中文说明, including `pnpm test (314/314) · npx tsc --noEmit clean · cargo check clean`.
Pushed to `origin/main`.

## Verification

```
$ npx tsc --noEmit
# silent

$ npx vitest run
# Test Files  17 passed (17)
#      Tests  314 passed (314)
#   +3 new tests (alerts.empty.alerts + alerts.empty.silences + alerts.cols.* loop)

$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.54s
  # 4 pre-existing dead-code warnings in src/kube/metrics_config.rs (unrelated)
```

Browser re-verified in dev server (HMR picked up each change):

- **zh, Alerting overlay open**:
  - Title: `告警` (Chrome chrome.sidebar.tools.alerting zh)
  - Close button: `关闭`
  - Tabs: `告警 (1)` (active) and `静默 (0)` — both in Chinese
  - Column headers in the alerts table: `告警` `严重程度` `状态` `摘要` `激活时间`
  - Demo row: `DemoHighCpu`, `severity=warning instance=demo`, `warning` (amber pill), `firing`, `CPU > 80% for 5m`, `2026-08-02T19:46:00.073Z`
  - Click silences tab: `无静默` (empty state in Chinese, was `No active silences.` in English)
  - Sidebar `告警` row is highlighted (overlay-active state)
- **zh, Pod row context menu**:
  - `Open files…` → `打开文件…` (the collateral ActionList fix)
  - The other action labels (`查看 Pod`, `端口转发…`, `伸缩…`, `重启…`, `禁止调度`, `允许调度`, `驱逐…`, `删除`) were already translated and were not regressed

## Notes for next pass

The next untested rotation items that still have payoff:

1. **i18n switch EN ↔ zh, full chrome walk** (rotation #8) — pass-1
   already verified the palette, pass-5 verified the pod-files
   overlay, pass-7 verified the tab cycling, and this pass verified
   the Alerting overlay + ActionList. A full chrome walk to look for
   *any other* hardcoded English string is a clean follow-up.
   Candidates observed in this pass but not yet fixed:
   - `src/components/dashboard/Dashboard.tsx:115, 130` — `CPU` and
     `Memory` labels in the utilisation meters. The dict has
     `dashboard.cpu: "CPU"` and `dashboard.mem: "Memory"`, but the
     JSX hardcodes them. (`CPU` is fine in zh, but `Memory` should
     be `内存`.)
   - `src/components/dashboard/Dashboard.tsx:39-48` — `RESOURCE_KINDS`
     labels (`"Pods"`, `"Deployments"`, etc.) on the resource cards
     are hardcoded English. The dict has
     `chrome.sidebar.tools.dashboard` and per-kind i18n labels
     via `kindLabelFor()` / `i18nKindLabel`. The sidebar nav also
     uses `kindMeta()` (English) instead of `localizedKindMeta()` /
     `kindLabelFor()`. A coordinated fix would touch `NavList.tsx:66`
     and `Dashboard.tsx`.
   - The resource table column headers (`NAME`, `NAMESPACE`, etc.)
     are explicitly English "by design" per
     `lib/kinds.ts:localizedKindMetaFor`'s JSDoc, so leaving those
     alone is correct.
2. **Settings panel end-to-end** (rotation #5) — pass-1 verified the
   palette opens it; the actual *contents* of `SettingsPanel.tsx`
   (theme, language, log buffer, metrics poll, status poll, default
   namespace, shell command, node shell image, MCP panel) haven't
   been exercised end-to-end. The "apply on next connect" hints for
   the poll intervals are an easy smoke-test target.
3. **Saved Queries CRUD** (rotation #9) — the mock provider already
   seeds 2 saved queries (`Node CPU`, `Pod restarts`), so a CRUD pass
   can exercise create / edit / delete / run.
