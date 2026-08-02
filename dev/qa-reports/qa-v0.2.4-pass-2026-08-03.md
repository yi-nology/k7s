# k7s v0.2.4 — QA pass 2026-08-03 (row context menu + overlay Esc)

## Area tested

Rotation item **#1 — Row context menu 8 actions** (`view-pods, port-forward, scale, restart, cordon, uncordon, drain, delete`).
Plus the pod-only "Open files…" entry that lives inside the same menu.
The QA pass surfaced a sibling issue in the same trip (Esc does not close feature
overlays) — that's also reported and fixed here.

## Findings

### High — Feature overlay (Pod Files, Helm Market, Dashboard, …) does not close on Esc
**File:** `src/hooks/useGlobalKeys.ts:38-50`

The global Esc cascade had five layers (palette, open menu, multi-row selection,
filter, detail panel) but no layer for a feature overlay. Opening Pod Files from
a pod's row context menu left the only exit as the in-panel Close button, which
isn't reachable while the user is mid-keystroke. Replicated in the browser:
right-click a pod → Open files… → press Esc → overlay stays.

The other overlays (HelmMarket, Dashboard, Metrics, Grafana, Endpoints,
TopologyPanel, AlertsPanel, ImageRepoPanel, TemplatePicker) all had the same
gap.

### Low — i18n fallback for `actions.files` label
**File:** `src/components/actions/ActionList.tsx:315`

`tr("actions.files", "Open files…")` ships with an inline fallback because the
key is not in either the `en` or `zh` dictionary. The English string wins
everywhere, which is the documented behaviour of the inline-fallback pattern
("a half-translated UI rather than a blank one"), so this is a gap in the
Chinese dictionary, not a regression. Logged for the i18n rotation pass.

## Fixes applied

- **`src/hooks/useGlobalKeys.ts`** — added `else if (s.overlay) s.closeOverlay();`
  between the open-menu layer and the multi-selection layer, with a comment
  explaining the "most recent thing you did" rule.
- **`src/hooks/useGlobalKeys.test.ts`** — added a new Escape-cascade test that
  opens `pod-files` over a non-empty filter, presses Esc, and asserts the
  overlay closes while the filter is preserved. Also reset `overlay: null` in
  the `beforeEach` so the existing tests can't leak state into the new one.

**Commit:** `4b6496f` — `fix(ux): close feature overlay on Escape`

Pushed to `origin/main`.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean (exit 0) |
| `npx vitest run` | **305 / 305** passing in 17 files, ~2.9 s |
| `cargo check --manifest-path src-tauri/Cargo.toml` | clean (4 pre-existing dead-code warnings only) |
| Browser re-test | Right-click pod → Open files… → Esc → table returns ✓ |

The 18 unit tests in `useGlobalKeys.test.ts` (was 17) cover the new overlay
dismissal, the menu dismissal, the multi-selection dismissal, the filter
clear, the detail-panel close, the palette close, ⌘K open/toggle/ctrl,
the k9s `:` idiom, and the `[` / `]` tab cycling across pod/node/helm kinds.

## What was visually confirmed in the browser

- Right-click a pod row → context menu appears anchored at the cursor, with
  `Forward…`, `Restart…`, `Open files…`, and `Delete…` (red, danger group).
  Order matches `META` in `src/lib/actions.ts:77-89` (safe first, then
  dangerous).
- Selecting `Open files…` opens the Pod Files overlay, listing the mock
  pod's `/etc`, `/var`, `/tmp`, and `demo.txt`.
- Pressing Esc now closes the overlay and the table re-appears. Filter
  (if set) is preserved.

The remaining actions per kind (view-pods on a workload with a selector,
scale on a Deployment/StatefulSet, restart on a pod or rollout-kind,
cordon/uncordon/drain on a node, forward on a pod or service, delete on
everything except nodes/namespaces/helm) are gated in
`src/lib/actions.ts:113-135` and covered by the 27 unit tests in
`src/lib/actions.test.ts`.

## Notes for next pass

- The CronJob list, Services, and Nodes weren't visually exercised this pass
  because the in-browser sidebar navigation kept clicking through the active
  kind. Worth a more direct driver (URL-based nav or a `setNav` keyboard
  shortcut) for the next pass.
- The Chinese dictionary is missing `actions.files` ("打开文件…"). Add it
  to the zh block in `src/lib/i18n/dictionaries.ts:1027-1056` to retire the
  inline fallback.
- Next up on the rotation: **#6 ⌘K command palette** (open, search, navigate,
  run) and **#2 Pod Files panel** (file list, tar download) — the latter is
  partially exercised by the overlay-close fix but the file-viewer and
  download paths still need a real pass.
