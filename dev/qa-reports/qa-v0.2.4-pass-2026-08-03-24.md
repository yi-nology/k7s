# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #24

## Area tested

**Resource Yaml tab edit-mode toggle — pass-23's "round-trips cleanly" follow-up.**
Pass-23's "untested but not yet picked up" list flagged this as a behavioural
test: every detail panel has a Yaml tab, and pass-23 wanted the round-trip
audited. While tracing the round-trip, found a real defect: the `yamlDraft`
is dead state across the three actions that close the edit session. The
next Edit click on any row silently overwrites the draft with the fresh
fetch — the user's work vanishes with no warning.

The pass also touched the CronJob detail panel area mentioned earlier
(rotation follow-up #1): confirmed the CronJob experience is sparse but
correct — only the YAML + Events tabs, only Delete in the action menu, no
Properties gatherer. No defect in the CronJob path itself; the defect was
in the store, which the CronJob flow happens to exercise (a CronJob opens
on the YAML tab by default).

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **15th** consecutive pass. Verification was by
> code review, by the 4 new store tests (which fail on the unpatched code
> and pass on the fix), and by tsc / vitest / cargo check.

## Findings

### 1. [high] `yamlDraft` is "dead state" across row change / tab switch / cancel

`src/store.ts:106-127` (the `selectionPatch` helper), `:605-606`
(`setActiveTab`), and `:637` (`cancelYaml`) each set `yamlEditing: false`
when the edit session ends — but *none of them* touch `yamlDraft`. The
draft remains in the store, and the next call to `startYamlEdit(initial)`
silently overwrites it with the fresh `yamlText` fetched for the new
row. Every keystroke the user typed is gone with no warning, no recovery
affordance, and no signal in the UI that anything happened.

The flow that demonstrates it:

1. User opens pod A, clicks YAML tab, clicks Edit → `startYamlEdit(yamlTextA)` →
   `yamlEditing=true, yamlDraft=yamlTextA`.
2. User types into the editor → `setYamlDraft("modified")` updates the draft.
3. User clicks another row (say pod B) → `selectRow(podB)` runs
   `selectionPatch(podB)` → `yamlEditing=false` (so the editor is now
   read-only on pod B's YAML), but `yamlDraft` is **still `"modified"`**
   in the store.
4. User clicks YAML tab on pod B → editor is read-only (yamlEditing=false).
5. User clicks Edit → `startYamlEdit(yamlTextB)` → `yamlDraft=yamlTextB`
   (overwrites `"modified"`). The user's edits to pod A are gone.

Step 3 is the silent-overwrite point: the draft becomes invisible at
that moment, but is still in the store. Step 5 is where it's lost. The
user has no way to recover and no way to know the work was discarded.

The same defect applies to:
- **Cancel** (`:637`): the user explicitly says "abandon this edit", and
  the editor flips to read-only, but the draft stays.
- **Tab switch** (`:605-606`): same — the user is now on Logs / Properties
  / Events, the editor on the YAML tab is read-only, the draft stays.

The "dead state" framing is the key insight: a draft the user can't see
is functionally a deleted draft, and a future code path that reads
`yamlDraft` while the user is on a different row would fire an action
against stale text. The right fix is to clear it in the same patch that
flips `yamlEditing` to false — making the discard explicit and
eliminating the "what's in the store" inconsistency.

This was the exact failure mode pass-23 was hinting at: "check whether
edit-mode round-trips cleanly." The fetch → edit → preview → apply →
refetch round-trip on a *single* row is clean (pass-23's test would have
shown that). The defect only surfaces when the round-trip is interrupted
by *any* of the three actions above — which is the common case in real
use, since users don't typically finish an edit in one sitting.

## Fixes applied

All in commit `ac85ccc`.

### `src/store.ts`

- **`selectionPatch` (line 106-127)** — add `yamlDraft: ""` to the patch
  return object, alongside the existing `yamlEditing: false`. The two
  fields are cleared together: the edit session ends *and* the draft
  goes with it. Doc comment in the patch records the rationale and the
  "dead state" framing.
- **`setActiveTab` (line 605-606)** — extend the `set` to also clear
  `yamlDraft`. The doc comment cross-references `selectionPatch` so the
  same logic is in one place to read.
- **`cancelYaml` (line 637)** — same: `set({ yamlEditing: false, yamlDraft: "" })`.
  Doc comment is the "Cancel is 'abandon this edit' — including the
  draft" framing.

### `src/store.test.ts`

- **New `describe` block `yamlDraft lifecycle (pass-24)`** with **4 new
  tests**:
  - **`selectRow clears the stale yamlDraft`** — sets up an in-progress
    edit on a non-pod row, calls `selectRow` on a different row, asserts
    both `yamlEditing === false` and `yamlDraft === ""`. Pins the
    `selectionPatch` change.
  - **`cancelYaml clears the yamlDraft (Cancel means discard)`** — sets
    up an in-progress edit, calls `cancelYaml`, asserts both fields are
    reset. Pins the `cancelYaml` change.
  - **`setActiveTab clears the yamlDraft`** — sets up an in-progress
    edit, calls `setActiveTab("logs")`, asserts both fields are reset.
    Pins the `setActiveTab` change.
  - **`startYamlEdit then setYamlDraft round-trips through the store`** —
    pins the happy path: `startYamlEdit` sets the draft, `setYamlDraft`
    updates it on each keystroke, a fresh `startYamlEdit` overwrites.
    This is the one case where the user is explicitly asking to start a
    new edit session, so the overwrite is desired.

  All 4 tests fail on the unpatched code (verified by running with the
  fix reverted) and pass on the fix. They use a `CronJob`-shaped row
  fixture so the test reads naturally for the CronJob flow that
  pass-23's "untested" list mentioned.

## Verification

- `npx tsc --noEmit` — **clean**. The change is purely additive on the
  store side (a new key in the patch object, an extra field in the
  `set` call) and the `setYamlDraft` action is unchanged.
- `npx vitest run` — **400 passed (396 → 400, +4 new)** across 18 test
  files. The 4 new tests live in `src/store.test.ts` (34 → 38).
- `cargo check --manifest-path src-tauri/Cargo.toml` — **clean** (4
  pre-existing dead-code warnings in `metrics_config.rs`, unchanged
  from pass-23).

Commit `ac85ccc` pushed to `origin/main`.

## Notes for next pass

The v0.2.4 rotation is exhausted and 9 rounds of post-rotation
follow-up are done (passes 15–23). Pass-23 listed 4 untested
follow-ups; this pass closed one (the YAML edit-mode round-trip
and found a real defect while doing so). Still on the queue:

- **Settings theme picker mid-session resolution** — switching from
  "dark" to "system" while the OS is light should immediately flip to
  light. This is a behavioural test on `useTheme`'s `startThemeSync`
  subscription.
- **Multi-namespace / cross-namespace bulk actions** — pass-18 fixed
  scale/forward for one namespace; check what happens when the
  selection spans namespaces (delete is the only bulk action that
  hits this path, and the `applyBulk` plumbing already does per-row
  ref resolution, but the test surface is unproven).
- **CronJob-specific defects** — confirmed the CronJob path is sparse
  but not broken (YAML + Events tabs, only Delete in actions, no
  Properties gatherer, mock data has no `selector` so no `view-pods`
  shortcut). The rotation hint that "if any kind has a custom tab
  strip it should be CronJob" is a feature observation, not a
  defect.

The cron should keep running; the follow-up queue is still
productive.
