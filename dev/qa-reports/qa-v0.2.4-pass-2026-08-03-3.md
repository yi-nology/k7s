# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai)

## Area tested

**Service Topology overlay (B-tier — recommended in the prior pass's
"Notes for next pass")** end-to-end in the dev server's MOCK provider.

- Open via the sidebar `◌ Service Topology` Tools item (had to scroll
  the nav to reach it — every other item is reachable through the
  scroll wheel, Service Topology is the 9th of 10 in `TOOLS`).
- Service list on the left: `nginx` and `redis`, each with `namespace ·
  N slice(s) · N ready` meta.
- d3-force canvas on the right: 7 nodes (2 services, 2 slices, 3 pods)
  laid out by the 300-tick force simulation.
- Legend at the bottom: `Service  Endpoint  Pod` (Container is filtered
  out by the committed `Object.keys(KIND_COLORS).filter(...)` — the
  MockProvider doesn't emit Container nodes yet).
- Header `Close` button (top-right) closes the overlay.
- Language menu opens via the `EN` glyph and exposes `中文` /
  `English` — both selectable.

## Findings

### medium — `cursor: pointer` on Service list items advertised a click the panel doesn't perform

`src/components/topology/TopologyPanel.module.css:45` shipped
`cursor: pointer` on `.item` (and on the dead `.itemActive` rule) while
`TopologyPanel.tsx:96-108` renders each row as a static `<li>` with no
`onClick` — the old card-list click was lost when the panel was
rewritten around `TopologyGraph`. A user hovering the rows in the new
design sees a clickable cursor, tries, and gets nothing.

**Repro (before the fix)**
- Sidebar `◌ Service Topology` → list rows render as a pointer cursor.
- Click on `nginx` or `redis`: no inspector, no node selected, no
  state change.

### low — dead i18n keys in the `topology` namespace

`topology.pick` ("Pick a service on the left") and
`topology.loading` ("Loading…") are defined in both EN and ZH dicts
(`src/lib/i18n/dictionaries.ts:836-837, 1293-1294`) but `grep` finds
no reader in the source. The panel has no loading state and no
"pick-a-service" empty state — the strings are leftovers from an
earlier card-list iteration. `topology.col.endpoints` and
`topology.col.pods` are similarly unused (only `col.service` is
referenced). Not fixed in this pass — they look like forward-planned
scaffolding rather than typos; cleanup should be a single PR once the
panel stabilises.

### low — more dead CSS in `TopologyPanel.module.css`

`.graph`, `.column`, `.arrow`, `.nodePrimary`, `.nodeOk`, `.nodeBad`
(`.module.css:73-86, 95-117`) date from the pre-graph card layout and
are not referenced anywhere in the TSX. Same story: leave alone for
now so the diff stays minimal — sweep in a dedicated pass.

### observed, not fixed — graph edges are nearly invisible

Committed `TopologyGraph.tsx:271-274` renders edges with
`stroke="var(--border)" strokeWidth=0.7 opacity=0.5`. Against the
panel's `--surface-0` background the lines fade to the point that
clicking a Service and looking for connections to its Pod is more
guesswork than graph-reading. The previous pass's notes flagged this
as the "next biggest target" and the v2 work-in-progress had a
debug-only red overlay making it bearable. Left untouched — this is
the user-owned iteration, not a regression.

## Fixes applied

| File | Change |
|---|---|
| `src/components/topology/TopologyPanel.module.css` | Drop `cursor: pointer` and the dead `.itemActive` rule on the Service list items. Replaced the grouped selector with `.item` only and added a one-line comment explaining why the cursor is gone (so a future "wire up onClick" pass knows to put it back). |

Commit: **`fd54152`** — *fix(topology): drop misleading cursor:pointer on Service list items*
Pushed to `origin/main`.

## Verification

```
$ npx tsc --noEmit                 # silent
$ npx vitest run                   # 17 files, 309 tests, all green
$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.53s
  # 4 pre-existing dead-code warnings in src/kube/metrics_config.rs
```

Browser re-verified after hot-reload on `TopologyPanel.module.css`:

- Panel opens via the sidebar item.
- Service list rows render with the default arrow cursor instead of
  a pointer — the misleading affordance is gone.
- Close button still dismisses the overlay; Escape still works
  (covered by the existing pass-1 `useGlobalKeys` cascade).
- Graph still renders 7 nodes (no incidental damage from the CSS edit,
  since `.canvas`/`.wrap`/`.legend`/`.inspector` are unchanged).

## Notes for next pass

- The **edge visibility** problem is the real next thing: a dedicated
  pass should decide on a stroke color + width + opacity that read
  on the panel's surface, and add a "selected service" path (lift
  the selected state, or add a sidebar `onClick` that scrolls the
  canvas to the matching node). Both changes touch the WIP
  `TopologyGraph.tsx`, so a fresh pass should coordinate with the
  user's in-flight iteration.
- The dead-i18n-key and dead-CSS sweep is well-isolated — a follow-up
  pass that wants a tiny mechanical fix can just remove
  `topology.{pick,loading,col.endpoints,col.pods}` from both dicts
  and the 6 dead classes in `TopologyPanel.module.css` in a single
  `chore(topology): drop dead UI leftovers` commit.
- Other untested rotation items still standing: Pod Files, Alerting,
  Settings/preferences, Detail panel `[`/`]` tab cycling, Saved
  Queries CRUD, Sidebar kind/namespace filter, Dashboard resource
  card navigation, Templates Ingress/ConfigMap variants, Helm
  Repositories CRUD.
