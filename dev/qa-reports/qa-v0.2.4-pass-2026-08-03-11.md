# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #11

## Area tested

**Saved Queries CRUD** (rotation #9) — the saved-queries panel that lives
inside the Metrics Explorer overlay
(`src/components/metrics/MetricsExplorer.tsx`). This was the
last Phase-2 feature that hadn't been audited at the i18n / UX level:
the original v0.2.4 pass only smoke-tested that the panel rendered,
and several recent passes flagged the contract as un-pinned.

What this pass walks through:

1. **C reate** — toggle the Save affordance → fill name + note → click
   the save action. Verifies the action button honours its validation
   and the Enter key on the name input submits the same handler.
2. **R ead** — the saved-list renders when `saved.length > 0`, with
   the per-row name, PromQL, refresh, and delete affordances.
3. **U pdate** — the `savedQueriesUpsert` Rust command at
   `src-tauri/src/kube/saved_queries.rs:86-101` replaces in place by
   name; the React side relies on the `cacheBust` re-fetch to surface
   the change.
4. **D elete** — `removeSaved` at `MetricsExplorer.tsx:134-140` uses a
   native `confirm()` built from the parameterised
   `metricsExplorer.saved.confirmRemove` function.
5. **Refresh / force re-query** — the outer `Refresh` button
   (line 240-247) and the per-row `↻` button (line 292-298) both
   claim "ignore the cache" semantics, but only the row button
   actually goes through the cached `saved_queries_run` path.

> **Browser limitation this pass:** the in-app Browser tool's render
> queue is still stuck (same symptom as pass-10 — every `inspect` /
> `navigate` / `wait` returns `Background Browser render queue wait
> timed out`). Verification was done by code review, by `curl
> http://localhost:1420/src/components/metrics/MetricsExplorer.tsx`
> to confirm Vite HMR was serving the new module
> (`disabled: !saveName.trim()` on the save action button, the new
> Enter handler on the name input, the corrected `refreshTitle`
> fallback), and by tsc / vitest / cargo check.

## Findings

### 1. [medium] The outer Refresh button's tooltip promises a cache bypass that the implementation does not deliver

`MetricsExplorer.tsx:240-247` is the "Refresh" button in the
query-bar row:

```tsx
<button
  className={styles.btn}
  onClick={() => run()}
  disabled={!result}
  title={t("metricsExplorer.refreshTitle", "Force re-query, ignoring the cache")}
>
  {t("metricsExplorer.refresh", "Refresh")}
</button>
```

`run()` (line 72-98) calls `getProvider().metricsQuery(instance, promql)`
or `metricsQueryRange(...)`. Both of those provider methods map to the
Rust `metrics_query` / `metrics_query_range` commands at
`src-tauri/src/commands.rs:1607-1620`, which call
`metrics_config::query()` / `query_range()` directly — no in-memory
cache. So the click re-runs the query against Prometheus, but **there
is no cache to bypass** on this path.

The cache lives only in `saved_queries::run_saved` at
`src-tauri/src/kube/saved_queries.rs:143-174` and is keyed by
`(instance, promql)`. Only the per-row `↻` button (line 292-298,
calling `runSaved(q, true)`) goes through that cached path; the
matching i18n key `metricsExplorer.saved.refreshHint` ("Run, ignoring
the cache") is accurate for it.

This is the exact regression class: UI claims a behaviour the code
does not have. Less harmful than the i18n leaks recent passes have
fixed (it never renders wrong text in any locale), but it does
mislead the user about what the click does.

### 2. [low] Save action button is enabled with an empty name — click is a silent no-op

`MetricsExplorer.tsx:262-264`:

```tsx
<button className={styles.primary} onClick={saveCurrent}>
  {t("metricsExplorer.saved.saveAction", "Save")}
</button>
```

`saveCurrent` (line 116-132) starts with `if (!saveName.trim() || !promql.trim()) return;`,
so a click with an empty name silently returns. The visual signal is
zero — the button is bright/accent-coloured, the user clicks, nothing
happens. The neighbouring Save toggle button (line 232-239) is
already `disabled={!promql.trim()}` and the main Run button
(line 224-231) is `disabled={loading || !instance || !promql.trim()}`,
so the established style for this overlay is "disable, don't no-op".

### 3. [low] Name input has no Enter-key submit, unlike the main PromQL input

The main query input at `MetricsExplorer.tsx:218-220` is:

```tsx
onKeyDown={(e) => {
  if (e.key === "Enter") void run();
}}
```

The save bar's name input (line 252-256) has no equivalent. So a user
who types a name and hits Return has to reach for the mouse to save —
small friction, but the rest of the panel already supports the
keyboard-submit pattern.

## Fixes applied

### `src/components/metrics/MetricsExplorer.tsx`

1. **Refresh tooltip no longer claims a cache bypass.**
   The English `metricsExplorer.refreshTitle` value changed from
   `"Force re-query, ignoring the cache"` to
   `"Re-run the current query"`. The Chinese equivalent
   `"强制重新查询,忽略缓存"` → `"重新运行当前查询"`. The per-row
   `metricsExplorer.saved.refreshHint` ("Run, ignoring the cache" /
   "运行,忽略缓存") is unchanged because that one *is* accurate — it
   labels the `↻` button that calls `runSaved(q, true)`. The button
   label itself ("Refresh" / "刷新") is unchanged; only the
   tooltip-level claim is corrected. The JSX-side `title` fallback
   was updated to match the new en string so a missing dictionary
   entry renders the same text.
2. **Save action button gains `disabled={!saveName.trim()}`.**
   Matches the pattern at line 226 (Run) and line 235 (Save toggle).
   The CSS at `MetricsExplorer.module.css:149-152` already has a
   `.primary:disabled` state (`cursor: not-allowed; opacity: 0.5;`),
   so no style work was needed.
3. **Name input gets Enter-key submit.** New `onKeyDown` handler on
   the name input that calls `void saveCurrent()` on `Enter`,
   matching the main query input's pattern exactly.

### `src/lib/i18n/dictionaries.ts`

Two line-pair edits (en + zh) for `metricsExplorer.refreshTitle`. No
key rename, no shape change — only the string value. The other 16
keys in the `metricsExplorer.saved.*` group are untouched (the
panel already routes them through `t()` correctly; the new tests
pin that).

### `src/lib/i18n.test.ts`

New `describe("metrics explorer saved-queries strings", …)` block
with **4 new tests** (330 → 334 total):

1. **`refreshTitle` no longer contains the misleading cache claim** —
   the en string is asserted to not contain `"ignoring the cache"` /
   `"ignore the cache"` (case-insensitive) and the zh string to not
   contain `"忽略缓存"`. The exact bug this commit addresses; a
   future re-introduction of the misleading copy fails the test
   with a clear message.
2. **`refreshTitle` is pinned to the canonical en / zh values** —
   `en === "Re-run the current query"`, `zh === "重新运行当前查询"`.
   Guards against silent copy drift.
3. **`metricsExplorer.saved.*` sub-keys all non-empty in both
   locales** — 10 keys (`title`, `saveTitle`, `save`, `namePlaceholder`,
   `notePlaceholder`, `saveAction`, `clearCache`, `clearCacheBtn`,
   `refreshHint`, `removeHint`). The CRUD chrome the panel renders;
   same leak class as `chrome.palette.actions.*` / `topology.*`
   (drops a key, render falls through to the second argument of
   `t()` and the panel keeps working but the test would still pass
   because the second argument is the literal English text).
4. **`confirmRemove` stays a function in both locales** — the
   `removeSaved` handler at line 134-140 builds its confirm prompt
   via `t("metricsExplorer.saved.confirmRemove", \`Delete saved query
   "${name}"?\`)`. The dictionary value is a
   `(name: string) => string`, not a plain string. The test pins
   the function shape and the en / zh return values for the
   `name = "cpu"` case (`Delete saved query "cpu"?` /
   `删除已保存查询 "cpu"?`). A future refactor that turns the value
   into a static string would silently break the name interpolation
   and fail this test.

Commit: **`ad2b714`** — *fix(metrics): accurate Refresh tooltip + disable save action on empty name*
Bilingual message: English summary + 中文说明.
Pushed to `origin/main`.

## Verification

```
$ npx tsc --noEmit
# silent (clean)

$ npx vitest run
# Test Files  17 passed (17)
#      Tests  334 passed (334)
#   +4 new tests (metrics explorer saved-queries strings block in i18n.test.ts)

$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.57s
  # 4 pre-existing dead-code warnings in src/commands.rs and
  #   src/kube/metrics_config.rs (unrelated)
```

Vite HMR confirmed serving the updated module
(`curl http://localhost:1420/src/components/metrics/MetricsExplorer.tsx`
returns the new file with `disabled: !saveName.trim()` on the save
action button, the Enter handler on the name input, and the
corrected `refreshTitle` fallback; `curl
http://localhost:1420/src/lib/i18n/dictionaries.ts` returns the new
`Re-run the current query` / `重新运行当前查询` values).

## Observed, not fixed — the in-app Browser render queue is still stuck

Same symptom as pass-10: every `navigate`, `inspect`, `wait` returns
`Background Browser render queue wait timed out`. Tried twice this
pass (once at the start, once after the fixes were applied), no
recovery. Recovery path is still `/quit` + relaunch of MiniMax Code.
The fix is small, mechanical, and well-isolated, and the new test
contract pins the exact wording, so the lack of in-app visual
verification is mitigated.

Logged because the next pass may hit the same stuck queue.

## Observed, not fixed — "Clear cache" button has no visual feedback

The "Clear cache" button at `MetricsExplorer.tsx:272-280` calls
`getProvider().savedQueriesClearCache()` (which maps to
`saved_queries::clear_cache()` in the Rust backend at
`src-tauri/src/kube/saved_queries.rs:191-195`). The call returns
`void` and the React handler ignores the result; the user has no
visual confirmation the click did anything. A minimal fix would be
a transient inline "Cache cleared" indicator (small piece of local
state) or a brief visual state change on the button itself (e.g.
"Cleared ✓" for 1.5s). Not part of this pass because the bug is
"low confidence in what happened", not "the click does something
wrong", and the pass was already touching the same `saveBar` /
`savedHeader` area. Logged for a future pass.

## Observed, not fixed — no edit flow for saved queries

A user who wants to change a saved query's PromQL or note has to
delete and re-add. The `saved_queries::upsert` Rust command at
`src-tauri/src/kube/saved_queries.rs:86-101` already has
"replace by name" semantics (find the existing entry by name, swap
in the new record), so a future "click name → save bar opens
pre-filled → edit and re-save" affordance would slot in cleanly.
Currently the save bar at line 250-272 always starts empty, so
even typing the same name again is treated as a deliberate
"overwrite" with no visual hint. Not a regression — the panel was
designed this way in v0.2.4 — but a small UX improvement. Logged
for a future pass.

## Notes for next pass

The remaining rotation items are still standing and well-isolated:

1. **ImageRepoPanel tags vertical layout polish** (rotation #10) —
   pass-0 covered the registry → repos → tags drill-down, but the
   *vertical* layout of the tag list (vs the current grid) hasn't
   been poked.
2. **Templates Ingress / ConfigMap form variants** (rotation #13) —
   the Templates overlay was only ever exercised with the
   Deployment form (the original v0.2.4 pass); the Ingress and
   ConfigMap form paths are an easy extra surface to verify.
3. **Helm Market Repositories CRUD** (rotation #14) — Repositories
   tab was covered in the original Helm Market pass at the read
   level; the add/edit/delete flow lives in `src/components/helm/`
   and is a clean follow-up target.
4. **Saved Queries "Clear cache" feedback** (this pass's
   "Observed, not fixed" item) — small piece of state, ~10 LOC.
5. **Saved Queries edit flow** (this pass's "Observed, not fixed"
   item) — would need the save bar to accept an optional
   "editing existing name" prop and re-style accordingly.
6. **In-app Browser queue stall** (this pass's "Observed, not
   fixed" item, same as pass-10's) — if the next pass hits the
   same stuck queue, the recovery path is `/quit` + relaunch of
   MiniMax Code. After two consecutive passes with the same
   symptom, the next session may also need to consider this as a
   known-stable issue rather than a transient stall.
