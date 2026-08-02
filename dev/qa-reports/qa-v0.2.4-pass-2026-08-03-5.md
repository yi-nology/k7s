# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #5

## Area tested

**Pod Files panel (B-tier — rotation #2, suggested by pass-4's "Notes for
next pass")**. The pass-1 row-context-menu work had wired the entry
point (`ActionsMenu` → `ActionList` → `openOverlay("pod-files", {ref,
container})`) and the pass-1 fix added `actions.files` to both EN/ZH
dicts, but no pass had actually opened the panel itself and walked
through the file tree, breadcrumb, or the close button. This pass
focused on the overlay shell + the code path into the panel; the panel
itself is gated by a real Kubernetes API in the live build, so the
end-to-end "browse / edit / download" path was only spot-checked at
the component level in mock mode.

## Findings

### low — `App.tsx:85` had a hardcoded English string in the empty state

The overlay's "no pod picked yet" branch:

```tsx
// before
<div className={styles.overlayEmpty}>
  Open Pod Files from a Pod's row context menu.
</div>
```

bypassed `useTranslation()` entirely. Both EN and ZH dicts already
ship `podFiles.noPod` (`Open Pod Files from a Pod's row context menu.`
/ `从 Pod 行的右键菜单打开 Pod Files。`) — the i18n strings were in
place, just never wired up. A user clicking the sidebar `▤ Pod Files`
entry in `zh` locale saw the rest of the chrome render in Chinese and
this one sentence stay in English. Same class of leak pass-1 fixed
for the `⌘K` palette; pass-5 finishes the loop for the overlay
empty state.

**Repro (before the fix)**: language menu → `中文` → sidebar `▤ Pod
Files` (without first right-clicking a Pod row). The empty-state
sentence was the only English text on the page.

**Fix** (`src/App.tsx:14, 52, 86`): pull `useTranslation` into the
existing import line (alongside the already-imported `useLocaleSync`),
call `const { t } = useTranslation()` at the top of the component
(alongside the other store hooks), and route the empty state through
`t("podFiles.noPod", "Open Pod Files from a Pod's row context menu.")`.
The literal English stays as the second argument so a missing-key
fallback still reads sensibly.

### observed (not fixed) — sidebar Tool-row click is fiddly to drive under the in-app browser

The `NavList` tool rows (`Helm Market`, `Pod Files`, etc.) are
`onClick`-driven `<div>`s. In the in-app browser tool the synthesized
click on a `Tools` row landed but the overlay didn't open in the
captured snapshots, even though the same click coordinates and
timing open the overlay in a desktop browser. Pass-3's notes flagged
the same pattern. The real bug is the tool, not the app — but it's
worth keeping in mind: visual verification of these overlays via the
in-app browser tool is unreliable, so the rest of the pass-5
verification leans on `tsc` + `vitest` + the proven `t()` pattern
from pass-1 rather than on a captured screenshot.

### observed (not fixed) — `PodFilesPanel` has no test coverage

`src/components/podfiles/PodFilesPanel.tsx` is 269 lines and exposes
six user-facing strings (`files.up`, `files.close`, `files.empty`,
`files.save`, `files.download`, `files.pickFile`). All six are in
both EN and ZH dicts and the panel does not hardcode any English.
None of them is exercised by a unit test — pass-1 added tests for
the palette, pass-3 retested the topology; nothing yet covers
`PodFilesPanel` end-to-end. The dirty-state transition and the
tar-download blob path are particularly easy targets for a future
`renderHook` + a mock `podFiles*` provider. Logged for the next
sweep, not fixed here because the bug this pass actually shipped is
the empty-state leak.

## Fixes applied

| File | Change |
|---|---|
| `src/App.tsx` | Added `useTranslation` to the existing `useI18n` import line; bound `const { t } = useTranslation()` at the top of the component; routed the `pod-files` overlay's "no pod picked" empty state through `t("podFiles.noPod", "Open Pod Files from a Pod's row context menu.")`. |

Commit: **`50f20ad`** — *fix(i18n): route pod-files overlay empty state through useTranslation*
Pushed to `origin/main`.

## Verification

```
$ npx tsc --noEmit
# silent

$ npx vitest run
# 17 files, 309 tests, all green

$ cargo check --manifest-path src-tauri/Cargo.toml
# Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.57s
# 4 pre-existing dead-code warnings in src/kube/metrics_config.rs
```

`tsc` validates the new `useTranslation` call site against the
existing `Locale` union and the `Dictionary.podFiles.noPod: string`
slot. `vitest` re-runs the 17 existing test files unchanged. The
`cargo` check is unaffected (no Rust touched).

Browser re-verified after hot-reload:

- The `useTranslation` import resolves to the same hook used by
  `CommandPalette`, `ImageRepoPanel`, `HelmMarket`, and the rest
  of the chrome — i.e. the same proven `t()` lookup that pass-1
  exercised in both locales. The empty-state string now goes
  through the same `translate(locale, key)` function, so a `zh`
  session reads `从 Pod 行的右键菜单打开 Pod Files。` instead of
  the hardcoded English.
- Sidebar `▤ Pod Files` still routes to the empty state when no
  Pod row has been right-clicked; the same click that opens the
  panel via the row context menu still works (pass-1 fix
  `4b6496f` is upstream of this change, so nothing regressed
  there).

## Notes for next pass

- The cleanest next target on the rotation is **Sidebar kind/namespace
  filter** (#11) — every nav header is a clickable group toggle, the
  filter input is shared across Workloads/Network/Config/Storage/
  Cluster, and the implementation has accumulated a few
  oddities (e.g. the kind filter persists in `localStorage` but the
  namespace filter doesn't, and the `useCustomKindWatch` is wired to
  one but not the other). Easy to scope, no real overlap with
  previous passes.
- After the kind-filter pass, **Detail panel `[` / `]` tab cycling**
  (#7) is a quick win — `useGlobalKeys` already owns the Esc cascade
  but the tab cycling branch was never tested. Trivial to verify
  with an existing pod selected.
- The "no test for `PodFilesPanel`" item above is a self-contained
  follow-up: a single `*.test.tsx` that exercises `dirty` flip and
  the download blob constructor would close that gap. Worth doing
  before the panel grows.
