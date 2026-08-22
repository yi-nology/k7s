# UI Polish Pass — Design

Date: 2026-08-04
Status: approved by user (brainstorm session, direction A + sidebar reorganization)

## Background

A live audit (demo mode, 1440×900) found consistent friction across the resource
table, detail panel, Dashboard, Metrics Explorer, and overall consistency/density.
The user confirmed all four areas and all four problem classes (readability/density,
visual quality, layout, consistency), and specifically called out that the Dashboard
entry is buried at the bottom of the sidebar instead of being the top-level home.

Chosen direction: **A — targeted polish** on the existing design language and token
system (no design-system rebuild, no component-library swap), plus the two cheapest
items from direction C (icon unification, chart legend/empty states).

## Scope

Everything below is CSS-module + `tokens.css` + sidebar config work. No Rust
backend changes. No changes to data flow, providers, or watch logic.

## 1. Resource table page

- **Column fit**: switch `ResourceTable` to `table-layout: fixed` with proportional
  column widths; NAME flexes to consume remaining width so there is no dead space
  at the right edge on wide windows.
- **Detail-open squeeze**: when the detail panel opens, the table container gets a
  `min-width` floor + `overflow-x: auto` instead of hard-clipping right-hand
  columns (CPU/MEM/AGE/STATUS currently get cut off).
- **Density**: row height from ~40px to 32px (within existing `--space` tokens);
  visible rows per screen ~13 → ~16+.
- **"+ New" button**: restyle from solid accent fill to ghost (border +
  accent-colored label) to match the tool aesthetic.

## 2. Detail panel

- **Logs toolbar**: reflow into two rows — row 1: filter input + container
  picker; row 2: ts / time-range / previous / save. This eliminates the
  clipped/wrapped buttons at the panel's default width without adding a menu.
- **Log timestamp legibility**: raise `--text-log-ts` one step (toward the
  `#5C5C66` panel-palette step) so timestamps read against `--bg-terminal`.
- **Header meta**: ns / node / age / status become wrap-safe chips; long pod names
  get `text-overflow: ellipsis` and no longer crush the meta row.

## 3. Dashboard

- **Breadcrumb sync**: while the Dashboard overlay is open, the breadcrumb shows
  `context / Dashboard` (same for other overlays) instead of stale
  `Workloads / Pods`.
- **Cluster overview consolidation**: Cluster Health ring + CPU + Memory bars merge
  into one horizontal three-segment "cluster overview" card, removing the empty
  right two-thirds of the current health card.
- **Stat cards**: numerals all use `--text-primary`; only the label carries the
  semantic hue, ending the current per-card random coloring.

## 4. Metrics Explorer

- Legend (series names) and Y-axis unit labels on charts.
- Empty/loading states: show an explicit placeholder instead of a bare axis frame.
- Saved-query row action buttons (reload / delete) enlarged to ≥28px hit area.

## 5. Consistency & navigation

- **Overlay layering**: every overlay (Dashboard, PromQL, Alerting, Grafana,
  Audit, Images, …) renders on a `--scrim` backdrop with `--shadow-lg`, clearly
  separating it from the table beneath.
- **Icons**: replace the ad-hoc Unicode glyphs (◉ ▲ ❐ ☺ ⎈ …) in the sidebar with
  a single icon set (lucide), uniform 14px. If lucide is not already a
  dependency, add `lucide-react`.
- **Sidebar reorganization** (user-approved):

  ```
  ◐ Dashboard                    ← standalone, pinned top, default landing view
  ─────────────────────────
  WORKLOADS   Pods Deployments ReplicaSets StatefulSets DaemonSets Jobs CronJobs HPAs
  NETWORK     Services Ingresses IngressClasses NetworkPolicies
              ‧ Endpoints ‧ Service Topology ‧ Ingress Routes ‧ Ingress Editor
  STORAGE     PersistentVolumeClaims PersistentVolumes StorageClasses
  CONFIG      ConfigMaps Secrets ServiceAccounts ResourceQuotas
  ACCESS      Roles ClusterRoles RoleBindings ClusterRoleBindings
  HELM        Releases ‧ Helm Market
  CLUSTER     Nodes Namespaces Events
  ─────────────────────────
  OBSERVABILITY (collapsible)  Metrics Alerting Grafana Audit
  IMAGES (collapsible)         Registries Import
  TOOLS (collapsible)          Pod Files Templates Diff Plugins
  ─────────────────────────
  CUSTOM (CRDs, unchanged logic, stays last)
  ```

  - Default landing view after connect: Dashboard (currently Pods).
  - Group order change is confined to `GROUP_ORDER` in `src/lib/kinds.ts`; no
    type or data-structure changes.
  - Network-group overlays keep their position but get visually de-emphasized
    (nested indent) to distinguish them from resource kinds.
  - TOOLS group starts collapsed; it reuses the existing
    `CollapsibleOverlayGroup` component. i18n keys are reused.

## Testing

- Existing `vitest` suite must stay green (sidebar order is asserted in
  `kinds.test.ts` / store tests — update expectations where order is pinned).
- Visual regression via `pnpm dev:shots` (VITE_DEMO=1): re-take the six README
  screenshots after the pass and eyeball diff; add one new shot for the Dashboard
  overlay showing the consolidated overview card.
- Manual check in both dark and light themes (tokens are dual-defined; any new
  token must exist in `:root`, `[data-theme="light"]`, and
  `[data-theme="light"] [data-surface="panel"]`).

## Out of scope

- No design-token palette changes (accent, status hues stay as-is).
- No layout shell changes (topbar, statusbar, hotbar untouched).
- No functional changes to log streaming, metrics queries, or watchers.
