# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #6

## Area tested

**Sidebar kind / namespace filter / search box** (rotation #11,
recommended in pass-5's "Notes for next pass"). The k7s sidebar
itself is short (12 built-in kinds + 10 tool entries, grouped) and
has no kind filter for the built-in list — only the Custom section
gets one (and only when there are > 8 custom kinds). The actual
filter / namespace / search affordances live on the table toolbar
and the topbar, so the pass covered those end-to-end:

- Sidebar `NavList` (12 built-in kinds, the Custom section that
  only renders with `customKinds.length > 8`, and the Tools
  overlay)
- Sidebar `ClusterSwitcher` — kubeconfig context menu, current
  context highlighting, `Import kubeconfig…` row, click-outside /
  Escape behaviour
- `TopBar` — cluster breadcrumb, command-palette `⌘K` button,
  language switcher, namespace dropdown
- `ResourceTable` toolbar — `filter…` input, the `/` keyboard
  shortcut, the multi-select chip
- `useTableKeys` keyboard navigation — `j` / `k` / `Enter` / `G`
  / `gg` / `/` (already covered indirectly by pass-1, re-verified
  here as a smoke test)
- `useGlobalKeys` Escape cascade — palette → menu → overlay →
  selection → filter → detail

## Findings

### low — `table.empty` always says "no resources match filter", even when the text filter is empty

`src/components/table/ResourceTable.tsx:339` (before this pass) was
a one-liner that always showed `t("table.empty")` when the row
set was empty. That string is `"no resources match filter"` in EN
and `"无匹配资源"` in ZH — both imply the user typed a filter.
The table is empty in three distinct cases, and only one of them
is the text filter:

1. **text filter active, no rows match** — message is correct
2. **namespace picker set to a namespace that has no rows of this
   kind** (e.g. `ns: default` on a Pods view whose rows all live in
   `prod`) — message is **wrong**: the text filter is empty, the
   cause is the picker in the topbar
3. **the kind has zero rows at all** (e.g. HPAs on a cluster that
   doesn't run any) — message is **wrong**: the user has typed
   nothing, and there is literally nothing to filter against

Cases 2 and 3 are the same message and the same lie. The Chinese
copy is *less* wrong (no mention of "filter" at all), so the bug
is most visible in EN.

**Repro (before the fix)**

- Sidebar `Pods` (13 total rows) → topbar `ns: all` (13 rows
  shown)
- Click the namespace dropdown, pick `default` (which has 0 pods)
  → table reads **"no resources match filter"** even though the
  filter input is empty
- Sidebar `HPAs` (0 rows, no filters at all) → table reads the
  same **"no resources match filter"**

**Fix** (`src/components/table/ResourceTable.tsx:339-347`,
`src/lib/i18n/dictionaries.ts:154-180, 588-593, 1047-1051`):

- New `table.emptyNone` key in both EN (`"no resources"`) and ZH
  (`"无资源"`) dicts, with the same fallback-string pattern as
  every other key in the codebase
- The `Dictionary.table` interface documents the split: `empty`
  is the "filter input was typed" case, `emptyNone` is the
  "filter input is empty" case (namespace picker, or the kind
  has nothing on this cluster)
- The empty branch in `ResourceTable.tsx` now picks based on
  `tableFilter.trim() === ""`; the literal English fallback is
  kept as the second `t` argument so a missing key still reads
  sensibly
- `src/lib/i18n.test.ts` — added a `table empty-state keys`
  describe with two tests that pin the new strings in both
  locales, so the next refactor can't accidentally drop the
  `emptyNone` key the way the `chrome.palette.actions` / `topology`
  keys were dropped in earlier passes

## Observed, not fixed — sidebar has no kind filter for the built-in kinds

`NavList.tsx:40-72` renders every built-in kind in `KIND_ORDER`
unconditionally, grouped by `GROUP_ORDER`. There's no
`useState`-driven filter for the built-in list — only the Custom
section (B15) gets one, and only when there are > 8 custom kinds.
With 12 built-in kinds grouped into 7 sections (Workloads,
Network, Config, Storage, Cluster, Helm, Tools), the user can
scan the list in a glance, and k9s (the obvious reference) has
the same shape. So this is "the design", not a defect — leaving
it alone.

Logged because the brief explicitly called out
"**Sidebar kind filter**" and the answer to "does k7s have one?"
is "no, and the design doesn't seem to want one". A future pass
that wants one would add it next to the cluster switcher (above
`NavList`), gated by the same `> 8` threshold the Custom section
uses.

## Observed, not fixed — neither kind filter nor namespace filter is persisted

`src/store.ts` has zero `persist` middleware and zero
`localStorage` reads/writes. The brief asserted that the kind
filter persists in `localStorage` but the namespace filter
doesn't — both claims are false. The `defaultNamespace` field in
`Settings` *is* persisted (it's a settings key, see
`src/lib/settings.ts:23, 50, 52, 91`), but that's the
*connect-time default* — it seeds the runtime `state.namespace`
on reconnect, not a per-session persistence of the picker.

Not fixing because the behaviour matches the rest of the
in-memory chrome (table filter, sort, selection are all
session-local). If the project ever wants persistence, the
`zustand/middleware/persist` route is the clean answer, scoped
to a small allowlist of fields.

## Observed, not fixed — Custom-section filter only appears with > 8 kinds

`NavList.tsx:191` — `{kinds.length > 8 && <input … />}`. A
cluster with 8 custom kinds can't filter them; 9 can. Reasonable
threshold for "long enough to hunt through", but a user at 8 is
locked out. Lowering to `> 5` would catch the in-between cases
without ever showing a filter for a 3-item list. Out of scope
for this pass — a one-line tweak in a future one.

## Fixes applied

| File | Change |
|---|---|
| `src/lib/i18n/dictionaries.ts` | Added `table.emptyNone` (EN: "no resources", ZH: "无资源") to the `Dictionary.table` interface and both EN/ZH dicts; expanded the JSDoc on `table.empty` to spell out the "filter input was typed" vs "filter input is empty" split. |
| `src/components/table/ResourceTable.tsx` | The `rows.length === 0` branch now picks between `t("table.emptyNone", "no resources")` and `t("table.empty", "no resources match filter")` based on `tableFilter.trim() === ""`; literal English fallbacks kept so a missing key still reads sensibly. |
| `src/lib/i18n.test.ts` | New `describe("table empty-state keys")` with two tests that pin `table.empty` and `table.emptyNone` in both locales. |

Commit: **`b40c91c`** — *fix(i18n): table empty state misreports cause when filter is empty*
Pushed to `origin/main`.

## Verification

```
$ npx tsc --noEmit
# silent

$ npx vitest run
# Test Files  17 passed (17)
#      Tests  311 passed (311)
# +2 new tests (table.empty + table.emptyNone in both locales)

$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.59s
  # 4 pre-existing dead-code warnings in src/kube/metrics_config.rs
```

Browser re-verified in dev server (HMR picked up each change):

- **HPAs view, no filters** → "no resources" (was "no resources match filter" before the fix)
- **Pods view, `ns: default`, no text filter** → "no resources" (was "no resources match filter")
- **Pods view, `ns: all`, text filter `nonexistent-pod`** → "no resources match filter" (unchanged — the original copy is correct in the case it actually applies to)
- **Pods view, `ns: all`, no filters, 13 rows** → unchanged, the empty branch doesn't fire
- All other pass findings (cluster switcher menu, namespace dropdown click-outside, `/` key focuses filter, sidebar nav) re-checked and still working

## Notes for next pass

The cleanest next targets, in rough order of payoff:

1. **Detail panel `[` / `]` tab cycling** (rotation #7) — `useGlobalKeys` already owns the key handler, `tabsFor` already knows each kind's tab list, and the only untested branch is the actual `setActiveTab` call. Trivial scope, no surprises expected.
2. **i18n switch EN ↔ zh, verify no raw key fallbacks** (rotation #8) — the in-app browser makes this one a bit awkward (the EN glyph overlaps the nsButton in this build's layout, and a click on the dropdown items doesn't always land via the ref model), but a careful pass can flip locale and walk the chrome.
3. **Saved Queries CRUD** (rotation #9) — if it actually exists in this build; if it doesn't, the pass can say so and we can drop it from the rotation.
4. **Templates Ingress / ConfigMap variants** (rotation #13) — the `Templates` overlay was covered end-to-end in an earlier pass but only with the Deployment form; the Ingress/ConfigMap form paths are a small extra surface.

Sidebar nav itself (rotation #11) is now clean enough that further
poking at it will probably turn up only the "Custom-section
filter threshold" and "no kind filter for built-in kinds" items
already logged above.
