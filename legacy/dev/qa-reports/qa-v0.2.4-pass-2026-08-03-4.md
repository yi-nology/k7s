# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #3

## Area tested

**Service Topology (B28-2) + cross-cutting CSS token health**

Service Topology was the explicit "next biggest target" the previous
pass (qa-v0.2.4-pass-2026-08-03-2) handed off. The pass-2 had already
landed:
- per-service mock data in `MockProvider.listEndpointAddresses`
- drop the "Container" legend chip
- `svgRef` retype + single attachment point
- `updateSize()` on mount

Pass-3 picked up the two remaining topology defects (no edges, off-
center cluster) and discovered a third cross-cutting bug — the
`--border` CSS variable that ~30 components reference was never
defined, so panel/card/table separator lines silently dropped across
the whole app.

## Findings

### high — `var(--border)` was undefined; 30+ components rendered without their borders

Every `border: 1px solid var(--border)` / `border-bottom: 1px solid
var(--border)` in the CSS modules fell through to `border: 1px solid
<empty>`, which the browser drops. Visually: AlertsPanel tabs, table
row separators, the TopologyPanel sidebar divider, the
TopologyGraph canvas outline, the settings panel, the metric explorer,
the Helm wizard step indicator, the PodFiles editor toolbar, and so
on — all rendered without their separator lines. The design tokens
defined `--border-default` / `--border-strong` / `--border-control` /
`--border-menu` / `--border-hover` but never the bare `--border`
that the modules were looking for.

**Repro (before the fix):** open Tools → Image Registries. The
registry list panel has no right-border between the list and the
repo grid; the "Add registry" button has no outline; the search
field has no border. Compare the same panel after the fix and the
dividers/buttons are visible.

**Fix** (`src/styles/tokens.css:48-56, 172, 267`): add
`--border: var(--border-default);` to all three theme blocks —
`:root` (dark), `[data-theme="light"]` (light), and
`[data-theme="light"] [data-surface="panel"]` (light-mode dark
panels). Aliasing to `--border-default` keeps the design intent
("border = default separator") and means theme overrides for the
default still flow through.

### high — Topology graph edges were invisible

`TopologyGraph.tsx` was looking up the edge endpoint positions with
`positions.get(l.source as string)`. d3-force mutates the link
array in place — after the first simulation, `l.source` and
`l.target` are node *references* (objects with `.id`), not strings.
`Map.get(nodeObject)` uses reference equality and the map is keyed
by string ids, so every lookup missed and every `<line>` returned
`null`. The previous pass (#2) had isolated the same issue but
treated it as "still a known issue" without shipping a fix.

**Repro (before the fix):** open Service Topology. The 7 nodes
render correctly but no `Service → Endpoint → Pod` lines are
drawn — the entire relationship graph is missing.

**Fix** (`src/components/topology/TopologyGraph.tsx:62-72, 278-307`):
- Type the source/target as `Link["source"]` (which is
  `NodeDatum | string | number`) instead of overriding `string` —
  re-declaring a wider union as narrower was the original
  `tsc` blocker.
- At render time, narrow with `typeof l.source === "string" ? l.source : l.source?.id`
  (and the same for `target`). Either form keys into the positions
  map.
- Update the hot-link check to compare against the resolved `sourceId`
  / `targetId` (not the raw property), so hover highlighting still
  matches the rendered string id.

### medium — Topology cluster was off-center, jammed against the top edge

`forceCenter` only translates the *mean* of the nodes to
`(cx, cy)`. With 7 nodes forming two tight Service→Endpoint→Pod
clusters and only 300 ticks, the link+charge forces could park a
cluster near the corner of the viewBox, then `forceCenter` would
translate the corner-cluster so the mean landed at the center but
the cluster itself sat in the lower-right of the SVG, which read as
"the graph is broken" even though the math was right.

**Fix** (`src/components/topology/TopologyGraph.tsx:230-232`): add
`forceX(cx).strength(0.08)` and `forceY(cy).strength(0.08)` on top
of the existing `forceCenter`. Per-node attraction to the target
coordinates is much weaker than `forceCenter` (which moves the
whole cluster rigidly), so the two clusters still end up in
different parts of the canvas — but each cluster now sits in the
middle of the viewBox instead of jammed against an edge.

### low (test-only) — `theme.test.ts` "genuinely different values" was over-strict

After the `--border` alias landed, the test that asserts no token
shares the same value between light and dark palettes flagged
`--border` because both palettes store the same `var(--border-default)`
string. The test's *intent* is to catch copy-paste bugs where a
light token accidentally has a dark colour value — aliases are
exactly the case where the raw string is allowed to match.

**Fix** (`src/lib/theme.test.ts:151-160`): filter out entries whose
value starts with `var(`. Literal-value equality (which is what
would actually render the same colour) is still caught.

## Fixes applied

| File | Change |
|---|---|
| `src/styles/tokens.css` | Added `--border: var(--border-default);` to the three theme blocks (`:root`, `[data-theme="light"]`, `[data-theme="light"] [data-surface="panel"]`) — the missing alias 30+ components reference. |
| `src/components/topology/TopologyGraph.tsx` | `GraphLink.source` / `.target` typed as `Link["source"]` so both string and node-reference branches type-check; per-link render narrows `l.source` / `l.target` via `typeof` before the `positions.get` lookup, so edges render in both cases; added `forceX` / `forceY` with strength 0.08 alongside `forceCenter` to land the cluster in the middle of the viewBox. |
| `src/lib/theme.test.ts` | The "genuinely different values" check skips entries whose value is a `var(...)` reference, so token aliases don't false-positive. |

Commit: **`817c426`** — *fix(ux): add --border alias and topology edges/layout*

## Verification

```
$ npx tsc --noEmit              # silent
$ npx vitest run                # 17 files, 309 tests, all green
$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo]   # 4 pre-existing dead-code warnings, unrelated
```

Browser re-verified in dev server (HMR picked up each change):

- **Image Registries / Metrics / Settings / Helm wizard / PodFiles**:
  panel outlines, button borders, table row separators, and
  sidebar/grid dividers are all visible now. The bug was an
  everywhere-at-onces defect — once the alias lands, the entire
  chrome gets a notch crisper.
- **Service Topology**:
  - Sidebar list still shows `nginx (1 slice · 3 ready)` and
    `redis (1 slice · 1 ready)`.
  - Graph shows 7 nodes: 2 services (nginx, redis), 2 endpoints
    (nginx-slice-1, redis-slice-1), 3 pods (nginx-1, nginx-2, redis-0).
  - Edges are now drawn — `nginx → nginx-slice-1 → {nginx-1, nginx-2}`
    and `redis → redis-slice-1 → redis-0` show as faint lines in
    `var(--border)`.
  - The cluster lands roughly in the middle of the viewBox instead
    of being jammed against the top edge.
- **Alerts panel**: 1 alert `DemoHighCpu` (severity: warning) shows
  in the table with the amber `--status-warn` pill, table rows
  have visible bottom borders, sidebar divider visible.

## Notes for next pass

- Topology graph: the inspector for the hovered/selected node still
  shows just `label`, `namespace`, and the `meta` rows. The graph
  builder currently populates `meta` with `{N} slices` / `{N} ready`
  for services and `{ready}/{total} ready` for endpoints — a future
  pass could surface the EndpointSlice address list on hover (cheap
  to add; the data is already in `sliceAddrs` in the same `useEffect`).
- Force layout: with `forceX`/`forceY` strength 0.08 the layout is
  noticeably more centred, but a 7-node graph still has 100+ pixels
  of empty padding on the sides of the canvas. If we ever grow the
  mock seed to 20+ services the layout will start to look dense
  automatically; if we keep the demo at 2 services, a manual
  `forceCollide` pass would tighten the cluster.
- Suggested next pass area: **Pod Files panel** (rotation #2) — the
  previous pass only verified the Esc-to-close cascade works; no
  pass has actually exercised the file tree, the breadcrumb
  navigation, the textarea save flow, or the tar download blob
  path. PodFilesPanel.tsx has a `useState` for `dirty` but no test
  covers it.
