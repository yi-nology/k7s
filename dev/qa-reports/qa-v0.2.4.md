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
2. Pod Files panel
3. Service Topology (d3-force)
4. Alerting panel
5. Settings / preferences
6. ⌘K command palette
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
