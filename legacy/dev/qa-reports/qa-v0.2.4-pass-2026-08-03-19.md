# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #19

## Area tested

**Metrics Explorer — saved-queries CRUD polish
(post-rotation follow-up, round 5).** The main rotation
(#1 through #14) closed every entry in the original rotation,
and pass-15 / pass-16 / pass-17 / pass-18 audited residual i18n
leaks and form-polish defects against the pattern pass-12
established for the HelmMarket add-repo form (`<form onSubmit>`
+ Enter-to-submit + real `disabled` + in-flight text + clamp +
`pattern` where relevant). Pass-11 explicitly logged two
follow-ups on the MetricsExplorer saved-queries surface and
flagged a third on the save bar that came up while reading the
panel. Pass-19 closes all three.

1. **Save bar — "edit existing" affordance**
   (`src/components/metrics/MetricsExplorer.tsx:250-273`,
   pre-fix). The `Save` action button was always labelled the
   same way regardless of whether the typed name matched an
   existing saved query. A user overwriting `Node CPU` (or any
   name they'd forgotten they had) got no visual hint until the
   `savedQueriesUpsert` silently mutated state. Pre-fix label:
   always `Save` / `保存`. Post-fix: the button flips to
   `Update` / `更新` and a small warn-coloured inline hint
   (`Will overwrite the existing query with this name.` /
   `将覆盖已存在的同名查询。`) renders below the bar when
   the typed name matches an existing saved query
   (case-insensitive, trimmed).

2. **Save action — in-flight state**
   (same lines, pre-fix). The pre-refactor button had
   `disabled={!saveName.trim()}` only — no in-flight text, no
   early-return on the in-flight state. A double-click could
   queue two `savedQueriesUpsert()` calls. Same defect class
   as pass-12 (HelmMarket add-repo), pass-13 (Templates
   Apply), and pass-18 (ActionList scale / forward). The
   handler now early-returns on `saving`, sets
   `saving = true` before the `await`, and resets it in
   `finally`. The button shows `Saving…` / `保存中…` during
   the request, and the two name / note inputs go grey so the
   user can see the request is being processed.

3. **Saved-list header — "Clear cache" button has no feedback**
   (`MetricsExplorer.tsx:280-287`, pre-fix). The pre-refactor
   onClick just fired `savedQueriesClearCache()` with no
   state change — the user clicked, nothing visible happened,
   and they had no idea whether the click landed. New
   `idle | ok` state mirrors the McpPanel CopyButton pattern:
   the button text briefly flips to `Cleared` / `已清空` for
   1.5s, with a `--status-ok` accent ring, then reverts.

> **Browser limitation this pass:** the in-app Browser render
> queue remains stuck for the **10th** consecutive pass (same
> symptom as pass-10 through pass-18). Verification was by
> code review, HMR / Vite serving the new modules (curl'd the
> served `MetricsExplorer.tsx` / `MetricsExplorer.module.css` /
> `dictionaries.ts` and confirmed the new `t()` calls + new
> CSS classes + new en / zh leaves), and tsc / vitest / cargo
> check.

## Findings

### 1. [high] Save bar's "edit existing" affordance is missing

`src/components/metrics/MetricsExplorer.tsx:250-273` (before
this pass). The save bar accepted any `saveName.trim()` and
called `savedQueriesUpsert` which silently overwrites. The
mock provider happens to no-op on the list, so the in-app
demo doesn't surface the defect visually, but the real Rust
backend at `savedQueriesUpsert` does overwrite. The user has
no warning and no confirmation — they could clobber a saved
query they care about because they forgot the name was taken.

The fix is structural, not just a hint:

- A derived `isOverwrite` checks
  `saved.some((q) => q.name.toLowerCase() === trimmedName.toLowerCase())`.
- When `isOverwrite`, the action button label switches
  `saveAction` → `updateAction` (en: `Save` → `Update`,
  zh: `保存` → `更新`).
- A small `.overwriteHint` block renders below the bar with
  warn-coloured text describing the overwrite. The CSS uses
  `var(--status-warn, #c79b2b)` so it falls back to a hard
  colour if the design tokens don't ship `--status-warn`.

### 2. [high] Save action has no in-flight state — double-click race

Same defect class as the pre-pass-12 HelmMarket add-repo and
pre-pass-13 Templates Apply. The pre-refactor save action
button had `disabled={!saveName.trim()}` only, with no
`disabled` during the in-flight `savedQueriesUpsert` and no
"in flight" text. A double-click (or a fast Enter-spam)
queues two upserts. The handler has no early-return on the
in-flight state, so a programmatic `.submit()` could also
bypass the `disabled` button (same class as pass-18's
HelmMarket fix).

The fix:

- New `saving` state, set to `true` before the `await` and
  reset in `finally` (so a thrown error doesn't leave it
  stuck).
- Handler early-returns on `saving` at the top.
- Action button is `disabled={!saveName.trim() || saving}`
  (the pre-existing `.primary:disabled` rule from the
  stylesheet already gives the right visual treatment:
  `cursor: not-allowed; opacity: 0.5;`).
- Button text switches `saveAction` / `updateAction` →
  `saving` during the request. The note / name inputs
  receive `disabled={saving}` and a new
  `.saveBar input:disabled { opacity: 0.6; }` rule.

### 3. [high] "Clear cache" button has no visual feedback

`src/components/metrics/MetricsExplorer.tsx:280-287` (before
this pass). The pre-refactor onClick was just
`onClick={() => { void getProvider().savedQueriesClearCache(); }}`.
No state change, no feedback, no in-flight text. The user
clicks, the page doesn't change, and they have no idea
whether anything happened — exactly the kind of "click into
the void" experience pass-9 called out for the Settings
panel's reset button and pass-15 called out for the detail
panel's "fetch new logs" button.

The fix mirrors the McpPanel CopyButton's `idle | ok | err`
state:

- New `cacheState: "idle" | "ok"` state.
- The button's `onClick` fires the provider method, sets
  `cacheState = "ok"`, and a 1.5s `setTimeout` reverts to
  `"idle"`.
- Button text swaps `clearCacheBtn` → `clearCacheOk` during
  the `ok` window (en: `Clear cache` → `Cleared`,
  zh: `清空缓存` → `已清空`).
- New `.btnSmallOk` class adds a `--status-ok` border /
  foreground for the success visual, then the original
  `.btnSmall` returns when the state reverts.

### 4. [low] Save bar inputs were never disabled while saving

Sub-defect of #2: even with the button `disabled`, the user
could keep typing into the name / note inputs during the
in-flight request, then press Enter again. The Enter handler
calls `saveCurrent` which is already gated on `saving`, so
the second request is dropped — but the visual feedback was
missing. Now both inputs are `disabled={saving}` and the
`.saveBar input:disabled { opacity: 0.6; }` rule gives a
clear "this is mid-action" signal.

## Fixes applied

All in commit `51caba2`.

### `src/components/metrics/MetricsExplorer.tsx`

**State additions** (lines 48-63, after this pass):

- `saving: boolean` — guards the save action during the
  in-flight `savedQueriesUpsert`.
- `cacheState: "idle" | "ok"` — transient feedback for the
  cache-bust button.
- `trimmedName` / `isOverwrite` derived from `saveName` and
  the `saved` list (case-insensitive, trim-insensitive
  match).

**`saveCurrent` handler** (lines 140-159): adds
`if (... || saving) return;` early-return, sets
`saving = true` before the `await`, resets in `finally`.

**`clearCache` handler** (lines 169-180, new): fires the
provider method, sets `cacheState = "ok"`, schedules the
1.5s revert.

**Save bar JSX** (lines 290-327, after this pass):

- Wrapped in a new `<div className={styles.saveBarWrap}>`
  that holds the existing bar + the new conditional
  `.overwriteHint`.
- Both name / note inputs gain `disabled={saving}`.
- The action button gains `type="button"`
  (it's inside a `not-a-form` div, so `type="button"` keeps
  the future-proofing consistent with pass-18's button
  pattern; not strictly needed today but harmless).
- The action button's disabled condition is now
  `disabled={!saveName.trim() || saving}`.
- The action button's text is a 3-way:
  - `saving` → `metricsExplorer.saved.saving` /
    `保存中…`
  - `isOverwrite` → `metricsExplorer.saved.updateAction` /
    `更新`
  - otherwise → `metricsExplorer.saved.saveAction` /
    `保存`
- The `.overwriteHint` renders only when `isOverwrite` and
  reads `metricsExplorer.saved.overwriteHint` /
  `将覆盖已存在的同名查询。`

**Saved-list header Clear cache button** (lines 333-346,
after this pass): the inline `onClick` becomes
`onClick={clearCache}`, the className is
`${styles.btnSmall} ${styles.btnSmallOk}` when
`cacheState === "ok"`, and the text swaps
`clearCacheBtn` → `clearCacheOk` (en: `Clear cache` →
`Cleared`, zh: `清空缓存` → `已清空`).

### `src/components/metrics/MetricsExplorer.module.css`

- New `.saveBarWrap` (a tiny wrapper that just owns
  `margin-bottom: var(--space-2);` so the `.overwriteHint`
  sits flush with the bar).
- New `.saveBarWrap .saveBar { margin-bottom: 0; }` so the
  wrapper's bottom-margin doesn't double up with the bar's
  pre-existing margin.
- New `.overwriteHint` — warn-coloured, `var(--text-xs)`,
  `2px var(--space-2)` padding.
- New `.saveBar input:disabled { opacity: 0.6; }` — the
  visual treatment for the name / note inputs during the
  in-flight save.
- New `.btnSmallOk` — `--status-ok` colour + border, used by
  the Clear cache button during the 1.5s "Cleared" window.

### `src/lib/i18n/dictionaries.ts`

**Type** — 4 new leaves inside `metricsExplorer.saved`:

```ts
saved: {
  // ... existing ...
  updateAction: string;     // NEW
  overwriteHint: string;    // NEW
  saving: string;           // NEW
  clearCacheOk: string;     // NEW
  // ... existing ...
};
```

**EN** — `updateAction: "Update"`,
`overwriteHint: "Will overwrite the existing query with this name."`,
`saving: "Saving…"`, `clearCacheOk: "Cleared"`.

**ZH** — `updateAction: "更新"`,
`overwriteHint: "将覆盖已存在的同名查询。"`,
`saving: "保存中…"`, `clearCacheOk: "已清空"`.

### `src/lib/i18n.test.ts`

- The existing `ships the metricsExplorer.saved.* sub-keys
  in both locales` loop grows from 10 keys to 14:
  `updateAction`, `overwriteHint`, `saving`, `clearCacheOk`
  appended.
- New `preserves the pass-19 overwrite-action / saving /
  clearCacheOk wording` test pins the canonical en / zh
  values for all 4 new keys, plus a verb check on
  `overwriteHint`: the English copy must contain `overwrite`
  (case-insensitive) and the Chinese copy must contain
  `覆盖` — both are the verb the user needs to make the
  right call. A future refactor that drops the verb (e.g.
  `Same name as existing`) trips this assertion.
- New `distinguishes saveAction (Save) from updateAction
  (Update) — they must not collapse` regression test.
  Pin that `saveAction` and `updateAction` resolve to
  distinct values in both locales. A future refactor that
  collapsed them into one string (e.g. `save` with a `name`
  arg) would lose the affordance — the button would always
  say `Save` even when it's about to overwrite. This
  test guards that refactor.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **382 passed (380 → 382, +2 new)**.
  The new `preserves the pass-19 overwrite-action / saving /
  clearCacheOk wording` test exercises all 4 new keys + the
  verb check on `overwriteHint`. The new `distinguishes
  saveAction (Save) from updateAction (Update)` test pins
  the distinct-values contract in both locales.
- `cargo check --manifest-path src-tauri/Cargo.toml` —
  clean (4 pre-existing warnings, unrelated to this pass;
  same as pass-15 / pass-16 / pass-17 / pass-18).
- Vite HMR confirmed serving the updated `MetricsExplorer.tsx`
  (the served bundle references the new `cacheState` /
  `isOverwrite` / `saving` state, the 3-way button text, the
  new `saveBarWrap` / `overwriteHint` JSX, and the new `t()`
  calls for `metricsExplorer.saved.{updateAction, overwriteHint,
  saving, clearCacheOk}`), the updated
  `MetricsExplorer.module.css` (served bundle includes the new
  `._saveBarWrap_*` / `._overwriteHint_*` / `._btnSmallOk_*`
  class exports and the `input:disabled` rule), and the
  updated `dictionaries.ts` (serves all 4 new en leaves + all
  4 new zh leaves).
- Working tree clean after the commit, pushed to `origin/main`
  (`79f1be8..51caba2  main -> main`).

## Notes for next pass

- **Post-rotation follow-up, round 5 (this pass)** closed
  pass-11's two explicit follow-ups on the saved-queries
  surface ("Clear cache" button has no feedback; save bar
  has no "edit existing" affordance) and a third defect
  (save action has no in-flight state) that came up while
  reading the panel. The form-polish audit is now uniform:
  every major form surface in the app has been audited
  against the pass-12/13/18/19 fix pattern (`<form onSubmit>`
  + Enter-to-submit + real `disabled` + in-flight text +
  clamp + `pattern` where relevant + an explicit overwrite
  affordance where the action can mutate user data).
- **Open follow-ups still on the queue** (not addressed by
  this pass):
  - **Pass-13**: empty text fields in Templates form silently
    fall through to defaults via the renderer's `||` fallback;
    needs a coordinated `required` policy decision (and would
    touch the templates.test.ts `clampInt` tests if the policy
    is "block apply on empty" instead of "silently fall back").
  - **Pass-14 / 17**: only `title="Grafana"` remains as a
    hardcoded brand string; the other small hardcoded `title=`
    attributes have all been swept.
  - **Pass-15 suggested**: MCP server health / latency
    indicator (no live health UI on the McpPanel; the cards
    are static).
  - **Pass-16 suggested**: Resource table column resize /
    reorder UX.
  - **Pass-17 suggested**: Cluster switcher `connected ·
    v1.28.0` mid-dot separator + version field UX
    (truncation behaviour for long version strings).
  - **Pass-17 suggested**: WatchFooter pulsing dot + count
    (the dot pulses constantly regardless of whether any
    watch is actually happening — a non-state-dependent
    decoration).
- **In-app Browser render queue is stuck for the 10th
  consecutive pass** — same symptom as pass-10 through
  pass-18. Pass-19's verification chain was code review +
  HMR / Vite serve + tsc / vitest / cargo check, which has
  caught every defect to date. The new fix's defect class
  is structural (visible by reading the TSX and seeing the
  `disabled` block, the 3-way button text, the
  `cacheState` flow, the `isOverwrite` derivation).
- **Self-cleanup heuristic (from the cron task spec)**:
  "If the prior reports cover MOST of the rotation and last
  3 passes found no new issues → the cron is done." Pass-16
  found 1 high + 1 low, pass-17 found 3 high + 2 low
  (observed), pass-18 found 3 high + 2 low, pass-19 found
  3 high + 1 low. The rate of finding new issues is steady
  but the defect class is narrowing — pass-19's defects are
  all the same form-polish / affordance class pass-12/13/18
  established. The cron has not yet hit the "3 quiet
  passes" threshold, so the next pass should either pick
  one of the open follow-ups above or move to a deeper
  sub-area. Possible deeper sub-areas for the next pass:
  - **MCP server health / latency** (pass-15's
    suggestion; the McpPanel has 3 static cards with no
    live health indicator like the cluster switcher has).
  - **WatchFooter pulsing dot + count** (pass-17's
    suggestion; the dot's visual state under connect /
    disconnect could be checked).
  - **Resource table column resize / reorder UX**
    (pass-16's suggestion; the table renders at fixed
    column widths and a re-order / hide affordance would
    surface after a few sessions of real use).
  - **Templates `required` policy** (pass-13's
    follow-up; an empty name field currently falls through
    to the default, and the user has no idea their value
    was rejected).
- **The v0.2.4 rotation plus 5 rounds of post-rotation
  polish is now substantive**: every major form surface
  (HelmMarket add-repo, Templates, ActionList scale,
  ActionList port-forward, MetricsExplorer save bar,
  MetricsExplorer cache-bust) has been audited against the
  pass-12/13/18/19 fix pattern.
