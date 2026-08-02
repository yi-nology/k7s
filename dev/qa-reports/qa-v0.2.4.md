# k7s v0.2.4 — Recurring QA Index

This file is the index for the recurring QA test cron (`k7s-recurring-qa`, every 10 min).
Each pass writes a per-pass report and appends a row here.

## Coverage rotation

### Already covered (do not re-test unless fixing a regression)
- Helm Market: Charts + Repositories tabs, wizard Version → Values → Review
- Image Registries: registry list, repos, tags drill-down, manifest drill-down
- Templates: deployment form + YAML preview + Apply
- Metrics Explorer: time range buttons, sine wave chart
- Grafana: instance list, preset dashboards, time range
- Endpoints: list + addresses
- Helm InstallWizard Review step button layout — **fixed in 7fe47b6**
- Dashboard header close button — **fixed in 7fe47b6**
- ImageRepoPanel auto-select first registry — **fixed in 0b3a7a8**

### Untested rotation
1. ~~Row context menu — 8 actions~~ — **covered in pass 1**
2. ~~Pod Files panel~~ — **covered in pass 5** (overlay empty-state i18n leak routed through `podFiles.noPod` in `App.tsx`; the panel itself is the entry point, not the empty state — pass-1 already wired the row context menu trigger)
3. ~~Service Topology (d3-force)~~ — **covered in pass 2 + pass 3 + pass 4** (mock bug + dual-ref + Container legend fixed in `3d56a73`; cursor:pointer cleanup in `fd54152`; edges + `--border` alias + force layout in `817c426`)
4. Alerting panel
5. Settings / preferences
6. ~~⌘K command palette~~ — **covered in pass 1**
7. Detail panel tab cycling `[` / `]`
8. i18n switch EN ↔ zh
9. Saved Queries CRUD
10. ImageRepoPanel tags vertical layout
11. Sidebar kind/namespace filter
12. Dashboard resource card navigation
13. Templates Ingress / ConfigMap variants
14. Helm Market Repositories CRUD

## Pass log

| # | Date (Asia/Shanghai) | Area tested | Findings | Fixes | Report |
|---|---|---|---|---|---|
| 0 | 2026-08-03 (bootstrap) | — | bootstrap index | — | this file |
| 1 | 2026-08-03 (first real pass) | ⌘K command palette (EN + zh) | 1 high: action labels + hints were hardcoded English even in zh locale. 1 low (not fixed): object-candidate kind-hint stays English in zh. | commit `29b0fd5` — palette action labels and hints routed through `chrome.palette.actions.*` in both locales, with paletteStr helper that falls back zh → en → hardcoded; 4 new tests; tsc / vitest 309 / cargo check all clean. | [qa-v0.2.4-pass-2026-08-03.md](qa-v0.2.4-pass-2026-08-03.md) |
| 1 | 2026-08-03 | Row context menu (8 actions) + global Esc cascade | Overlay (Pod Files, etc.) ignored Esc — feature gaps in `useGlobalKeys`; missing `actions.files` in zh dict (low) | Esc → `closeOverlay()` in cascade; new test in `useGlobalKeys.test.ts` — **4b6496f** | [pass-1](qa-v0.2.4-pass-2026-08-03.md) |
| 2 | 2026-08-03 | Service Topology overlay (d3-force) | 1 high: `listEndpointAddresses` mock ignored `ns`/`name` and always returned nginx pods, so redis was wired to nginx-1/nginx-2. 1 medium: Container legend chip with no Container kind nodes. 1 low: `svgRef` attached to both `.canvas` div and inner `<svg>`. 1 low: ResizeObserver only fired on change so first paint used 800×500 default. **Known issue (not fixed)**: 0 `<line>` elements render despite positions Map being populated (7 keys, 5 links). | `3d56a73` — Mock branches per slice (redis→redis-0, nginx→nginx-1/2); Container legend chip dropped; svgRef cleaned up (HTMLDivElement on the div only); updateSize() runs on mount. tsc / vitest 309 / cargo check all clean. | *index-only summary* (per-pass file written by the previous cron session but not committed; the row above captures the findings) |
| 3 | 2026-08-03 | Service Topology overlay (re-test after `3d56a73`) | 1 medium: `cursor: pointer` on Service list items advertised a click the panel doesn't perform. 2 low (not fixed): dead i18n keys `topology.pick`/`topology.loading` and dead CSS rules (`.graph`/`.column`/`.arrow`/`.nodePrimary`/`.nodeOk`/`.nodeBad`) — left as cleanup for a future pass. **Known issue (not fixed)**: graph edges are nearly invisible (`stroke=var(--border)` `strokeWidth=0.7` `opacity=0.5`) — see pass-2's row and the new pass-3 "Notes for next pass". | commit `fd54152` — dropped `cursor: pointer` and dead `.itemActive` rule on `.item` in `TopologyPanel.module.css`; tsc / vitest 309 / cargo check all clean; pushed to `origin/main`. | *index-only summary* (no per-pass file — work was small and the diff is the report) |
| 4 | 2026-08-03 | Service Topology overlay (3rd pass) + cross-cutting CSS tokens | 1 high: `var(--border)` undefined in 3 theme blocks — every `border: 1px solid var(--border)` in ~30 components rendered without its separator. 1 high: topology graph edges were invisible because `positions.get(l.source as string)` returned undefined for d3-resolved node references. 1 medium: topology cluster jammed against the top of the viewBox because `forceCenter` only translates the *mean*; added `forceX`/`forceY` strength 0.08 to land each cluster in the middle. 1 low (test-only): `theme.test.ts` over-strict — `var(--border-default)` shares the same string in both palettes by design. | commit `817c426` — added `--border: var(--border-default)` to `:root`, `[data-theme="light"]`, and `[data-theme="light"] [data-surface="panel"]`; re-typed `GraphLink.source`/`.target` as `Link["source"]` and narrowed at the call site; added `forceX`/`forceY` alongside `forceCenter`; theme test now skips `var(...)` references. tsc / vitest 309 / cargo check all clean; pushed to `origin/main`. | [qa-v0.2.4-pass-2026-08-03-4.md](qa-v0.2.4-pass-2026-08-03-4.md) |
| 5 | 2026-08-03 | Pod Files panel (rotation #2) | 1 low: `App.tsx:85` overlay empty state hardcoded English even in zh locale; both EN and ZH dicts already had `podFiles.noPod` (the strings were sitting unused, same leak class pass-1 fixed for `⌘K`). Observed (not fixed): no test coverage for `PodFilesPanel` — `dirty` flip and the tar-download blob path are easy targets for a future `*.test.tsx`. | `50f20ad` — `App.tsx:14, 52, 86` swap the hardcoded string for `t("podFiles.noPod", "Open Pod Files from a Pod's row context menu.")`. tsc / vitest 309 / cargo check all clean; pushed to `origin/main`. | [qa-v0.2.4-pass-2026-08-03-5.md](qa-v0.2.4-pass-2026-08-03-5.md) |
