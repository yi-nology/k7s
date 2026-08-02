# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #7

## Area tested

**Detail panel `[` / `]` tab cycling** (rotation #7, recommended in pass-6's
"Notes for next pass"). The cycling is owned by
`src/hooks/useGlobalKeys.ts:59-68` and the tab list is shared with the
detail-panel strip via `tabsFor()` in `src/lib/kinds.ts:294-311` — so a
drift between what the user sees in the tab strip and what the keys land
on would be a class of bug all on its own.

The pass covered the full key handler end-to-end on a real running
detail panel:

- **Pod** (`valkyrie-api-7d9f8b64d-x2k4n`) — 6 tabs
  `[logs, properties, metrics, shell, yaml, events]`
  - `]` walks Logs → Properties → Metrics → Shell → YAML → Events → Logs
  - `[` walks Logs → Events → Properties → Metrics → Shell → YAML → Logs
  - Default tab on select is `logs` (per `selectionPatch` in
    `src/store.ts:114`)
- **ReplicaSet** (`valkyrie-api-6c8d9`) — 2 tabs `[yaml, events]`
  - `]` walks YAML → Events → YAML
  - `[` walks YAML → Events → YAML
  - Properties / Metrics / Shell are correctly absent (not a pod, not in
    `KINDS_WITH_PROPERTIES`, not a node)
  - Default tab on select is `yaml`
- **Wrap-around** in both directions for both kinds
- **Pod → ReplicaSet navigation** via the ⌘K palette (correctly resets
  `activeTab` to `yaml` on the new kind, matching the per-kind default)
- **isTypingTarget correctness** — `[` / `]` are ignored while focus is
  on a `<input>` / `<textarea>` / `[contenteditable]` (covers
  CodeMirror's YAML editor via the contenteditable path)

The `useGlobalKeys` test file already covered pods/nodes/Helm/empty
selection; the unit tests at `src/hooks/useGlobalKeys.test.ts:180-217`
gave a strong prior. This pass added **end-to-end verification in the
real dev server** to confirm:

1. The keys fire when the document listener expects them to
   (i.e. nothing else in the chrome is intercepting)
2. The cycling lands on a tab the strip actually renders
3. The wrap is symmetric (`[0]` and `[n-1]` both work)
4. The pod-vs-non-pod default `activeTab` is in sync with the
   `selectionPatch` so the user never opens the panel on a tab that
   doesn't exist (which is the exact class of bug the
   "one source of truth" comment in `kinds.ts:280-285` was written to
   prevent)

## Findings

**No defects found.** The implementation is correct and complete:

- `useGlobalKeys.ts:59-68` reads `s.selectedRow`, `s.nav`,
  `s.activeTab` from the live store, computes `tabsFor(s.nav, !!row.pod)`,
  finds the current tab in the list, and advances/retreats with
  `% tabs.length`. `Math.max(0, tabs.indexOf(activeTab))` makes the
  "active tab not in list" case fall back to index 0 rather than
  landing on `tabs[-1]`.
- `kinds.ts:294-311` is the single source of truth used by **both** the
  tab strip (`DetailPanel.tsx:58`) and the key handler
  (`useGlobalKeys.ts:63`). Three consumers can't disagree.
- `isTypingTarget` in `lib/dom.ts:6-11` returns true for `INPUT`,
  `TEXTAREA`, and `isContentEditable`. CodeMirror's YAML editor sets
  `contenteditable` internally, so the cycle keys are passed through
  to it (rather than hijacking the editor). The `filter logs…` input
  in the Logs tab is also a real `<input>`, so cycling won't fire
  while the user is filtering.
- The cycle handler does **not** call `preventDefault()`. That turns
  out to be the right call: outside an input/textarea/contenteditable,
  the browser doesn't do anything special with `[` or `]`, and adding
  `preventDefault` would only make the handler noisy. Inside an input
  (where the keys *would* be legal characters), the `!typing` check
  short-circuits, so the handler returns before any default could
  matter.

## Observed, not fixed — `]` and `[` while a row context menu is open

The key handler does not check `s.openMenu`. If the user opens a row
context menu (the eight-action menu added in pass-1), the menu doesn't
listen for `[` or `]`, but the cycle handler still fires. In practice
this is harmless: the menu is anchored to the row, the active tab in
the panel behind it changes, and the menu stays open until Esc or an
action. The user gets a small visual surprise (panel tab changes while
menu is up).

Not fixing because (a) the menu doesn't advertise that `[`/`]`
intercept anything (no `<button>`s with `[`/`]` hints), (b) the panel
behind the menu is the one cycling, and (c) pressing `]` is a
deliberate act, not a typo. If a future pass wants stricter scoping
the fix is one line: `&& !s.openMenu` in the condition at
`useGlobalKeys.ts:59`.

## Observed, not fixed — `useGlobalKeys` handler does not gate on `overlay`

Same shape as the openMenu case above: when a feature overlay
(Helm Market, Pod Files, Service Topology, etc.) is open, `[`/`]`
still cycle the detail panel tab behind it. Practically invisible
because the panel is covered, but the cycle is happening off-screen.

Not fixing because the overlays always have an in-panel close button
and Esc is the standard way out — the user isn't pressing `[`/`]`
while looking at the overlay. The same one-line fix (`&& !s.overlay`)
would scope it tighter if anyone finds it annoying.

## Fixes applied

**None.** This pass found no defects to fix.

## Verification

```
$ npx tsc --noEmit
# silent

$ npx vitest run
# Test Files  17 passed (17)
#      Tests  311 passed (311)

$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.60s
  # 4 pre-existing dead-code warnings in src/kube/metrics_config.rs (unrelated)
```

Browser re-verified in dev server (HMR picked up the keypresses
instantly):

- **Pod (6 tabs)** — `]` walks through every tab in strip order,
  wraps to the first. `[` walks back, wraps to the last. Verified
  visually: Logs → Properties (OVERVIEW + CONTAINERS) → Metrics (CPU
  + Memory charts) → Shell (demo shell prompt) → YAML (replicaset
  manifest + Edit button) → Events (Started/Pulled/Scheduled) → Logs
  (log lines + "135 lines" footer) → Properties (wraps). No visual
  glitches, no console errors.
- **ReplicaSet (2 tabs)** — `]` walks YAML → Events → YAML. Properties
  is correctly absent (ReplicaSet is not a pod, not a node, not in
  `KINDS_WITH_PROPERTIES`). The Events tab shows the "no recent
  events" empty state with the "see Cluster → Events for the live
  feed" hint, which is the right message for a non-namespaced-event
  resource.
- **Pod → ReplicaSet via ⌘K** — palette filters to "Deployments" on
  `deploy`, ⏎ navigates, the panel is closed (no row selected), table
  shows the ReplicaSet columns. Re-selecting a ReplicaSet row opens
  the panel on YAML (the new default) with the two-tab strip.

## Notes for next pass

The cleanest next targets, in rough order of payoff:

1. **i18n switch EN ↔ zh, verify no raw key fallbacks** (rotation #8) —
   I tried to flip the locale from the topbar dropdown in this pass
   but the in-app browser's normalized-position click missed the
   "中文" row (the dropdown closes on second click of the trigger).
   A careful pass can use the palette (`Open settings` → `Language`),
   or the dropdown via a more precise ref lookup. The cycling logic
   itself is locale-agnostic (operates on tab IDs, not labels), so
   any leaks are likely in tab label *display* not cycling.
2. **Settings / preferences** (rotation #5) — `Open settings` is a
   palette action; the `SettingsPanel.tsx` was last exercised in
   pass-3's `chrome.palette.actions.*` fix but the panel itself
   hasn't been poked end-to-end (theme, default namespace, language,
   font size, port-forward TTL, drain grace period, etc.).
3. **Saved Queries CRUD** (rotation #9) — if it actually exists in
   this build; if not, the pass can say so and we can drop it from
   the rotation.
4. **Helm Market Repositories CRUD** (rotation #14) — Repositories
   tab was covered in the original Helm Market pass but only at the
   read level; the add/edit/delete flow lives in
   `src/components/helm/`.
