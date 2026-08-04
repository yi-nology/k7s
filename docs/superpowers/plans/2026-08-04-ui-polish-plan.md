# UI Polish Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix readability, density, layout, and consistency issues across the resource table, detail panel, Dashboard, Metrics Explorer, overlays, and sidebar — all within the existing design-token system and without touching Rust backend.

**Architecture:** Pure CSS-module + minimal TS adjustments. No new component trees, no provider changes. Each task targets one self-contained visual area so changes can be verified and reviewed in isolation. The one new dependency is `lucide-react` (icon library) replacing ad-hoc Unicode glyphs in the sidebar.

**Tech Stack:** React 19, CSS Modules, Zustand store, `tokens.css` design tokens, lucide-react (new), vitest + `dev:shots` visual regression.

## Global Constraints

- Every token defined in `:root` MUST also exist in `[data-theme="light"]` and `[data-theme="light"] [data-surface="panel"]` — no orphan dark-only tokens.
- Row height (`ROW_HEIGHT`) is a TS constant used by virtual-scroll math in `src/lib/virtual.ts`; changing it affects spacer heights and scroll-to-row positioning automatically.
- `GROUP_ORDER` in `src/lib/kinds.ts` is the single source of sidebar group ordering; `kinds.test.ts` may assert on this array and must be updated.
- i18n keys (e.g. `chrome.sidebar.tools.dashboard`) are reused verbatim — no new keys needed for this pass.
- Screenshots must pass `pnpm dev:shots` (VITE_DEMO=1) without visual regressions after each task.

---

## File Map

| Area | File(s) | Scope |
|---|---|---|
| Tokens | `src/styles/tokens.css` | `--text-log-ts` fix (dark + light + panel) |
| Table | `src/components/table/ResourceTable.module.css` | `tableFixed`, `.row`, `.newBtn` |
| Table (TS) | `src/components/table/ResourceTable.tsx` | column widths, `ROW_HEIGHT` constant |
| Detail panel | `src/components/detail/DetailPanel.module.css` | `.meta` flex-wrap, `.header` layout |
| Logs tab | `src/components/detail/LogsTab.tsx`, `LogsTab.module.css` | toolbar two-row reflow |
| Overlays | `src/App.module.css` | `.overlay` scrim + shadow |
| Dashboard | `src/components/dashboard/Dashboard.tsx`, `Dashboard.module.css` | breadcrumb, overview card, stat colors |
| Metrics | `src/components/metrics/MetricsExplorer.tsx`, `MetricsExplorer.module.css` | legend, empty state, button size |
| Sidebar icons | `src/components/sidebar/NavList.tsx`, `Sidebar.module.css` | lucide icon import, `.navIcon` sizing |
| Sidebar order | `src/lib/kinds.ts` | `GROUP_ORDER` reorder |
| Sidebar tests | `src/lib/kinds.test.ts` | update group-order assertions |
| Package | `package.json` | add `lucide-react` |

---

## Task 1: Install lucide-react dependency

**Files:**
- Modify: `package.json`

**Why first:** Every later sidebar task imports from `lucide-react`; installing once avoids per-task `pnpm add` churn.

- [ ] **Step 1: Add lucide-react**

```bash
cd /Users/zhangyi/my_project/k7s
pnpm add lucide-react
```

- [ ] **Step 2: Verify build still compiles**

```bash
pnpm typecheck
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add lucide-react dependency for sidebar icon unification"
```

---

## Task 2: Fix log timestamp contrast (`tokens.css`)

**Files:**
- Modify: `src/styles/tokens.css`

**Why:** `--text-log-ts` is `#4c4c55` in `:root` (dark) — on `--bg-terminal: #08080C` the contrast ratio is ~1.7:1, effectively invisible. Step it up one notch.

- [ ] **Step 1: Patch dark palette**

In `src/styles/tokens.css`, find the `:root` block. Change:

```css
--text-log-ts:    #4c4c55;
```

to:

```css
--text-log-ts:    #5C5C66;
```

(`#5C5C66` matches the existing `:root` `--text-linenum: #34343c` → lightened one step, consistent with the panel palette's `--text-log-ts: #5C5C66` in `[data-theme="light"] [data-surface="panel"]`.)

- [ ] **Step 2: Verify light palette is consistent**

In `[data-theme="light"]`, find:

```css
--text-log-ts:    #9696A0;
```

No change needed — already distinct from background (`#F6F6F9`).

- [ ] **Step 3: Verify panel palette is consistent**

In `[data-theme="light"] [data-surface="panel"]`, find:

```css
--text-log-ts:    #5C5C66;
```

Matches the new `:root` value. No change needed.

- [ ] **Step 4: Visual check**

```bash
VITE_DEMO=1 pnpm dev &
# open Pods → click CrashLoopBackOff pod → Logs tab
# timestamps should now be clearly readable
pkill -f "vite"
```

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css
git commit -m "fix(tokens): raise --text-log-ts contrast in dark palette (#4c4c55 → #5C5C66)"
```

---

## Task 3: Resource table — density, column fit, +New button

**Files:**
- Modify: `src/components/table/ResourceTable.module.css`
- Modify: `src/components/table/ResourceTable.tsx`

### Step 3a: Row height (constant)

- [ ] **Step 3a-1: Change `ROW_HEIGHT` in ResourceTable.tsx**

Find line:

```ts
const ROW_HEIGHT = 28;
```

Change to:

```ts
const ROW_HEIGHT = 26;
```

This propagates automatically to virtual-scroll spacers via `rowWindow()`.

- [ ] **Step 3a-2: Reduce non-virtual cell padding in CSS**

In `ResourceTable.module.css`, find:

```css
.td {
  padding: 11px 18px;
}
```

Change to:

```css
.td {
  padding: 8px 18px;
}
```

(`8px top+bottom + ~10px content line-height = ~26px row` — matches `ROW_HEIGHT`.)

### Step 3b: Column widths — always fixed layout

- [ ] **Step 3b-1: Make `tableFixed` unconditional**

In `ResourceTable.tsx`, find the `<table>` element (~line 323):

```tsx
<table className={`${styles.table} ${virtual ? styles.tableFixed : ""}`}>
```

Change to:

```tsx
<table className={`${styles.table} ${styles.tableFixed}`}>
```

- [ ] **Step 3b-2: Always render `<colgroup>`**

Find the conditional `<colgroup>` block (~lines 328–334). Change the guard from `{virtual && (` to just `{(` — the colgroup renders for all table sizes. The column widths come from `columnWidth()` which uses header names, not row counts.

- [ ] **Step 3b-3: Make NAME column fill remaining space**

In `columnWidth()` (~line 473), find the `"NAME"` case returning `"22%"`. Change to:

```ts
case "NAME": return "1fr";   // flex-col via colgroup minmax trick — see CSS
```

Actually: `table-layout: fixed` with `1fr` in a `<col>` doesn't work directly. Instead, keep NAME as a percentage but use a larger value that works with the fixed set of columns. A simpler fix: use `min-width` on the table itself so the right side doesn't float empty, and make NAME `auto` (in fixed layout, `auto` = whatever remains after fixed columns):

```ts
case "NAME": return "auto";
```

The other percentage-based columns (`8%`, `12%`, `16%`, etc.) will divide their share of the table width first; NAME gets whatever space remains.

- [ ] **Step 3b-4: Set table min-width to prevent column collapse**

In `ResourceTable.module.css`, add to `.tableFixed`:

```css
.tableFixed {
  table-layout: fixed;
  min-width: 900px;
}
```

This ensures at 900px minimum the columns are legible; below that, `overflow-x: auto` on the container scrolls horizontally.

### Step 3c: Detail-open horizontal scroll

- [ ] **Step 3c-1: Ensure table container scrolls horizontally when panel open**

The table container is `.tableArea` in `App.module.css` — it already has `overflow: auto` from its flex context. The key change is that `min-width: 900px` on the table (step 3b-4) will force it wider than the available 52% of the viewport when the detail panel (48%) is open, triggering the horizontal scrollbar.

Verify: no additional CSS change needed — `min-width: 900px` on the table + `overflow: auto` on its flex parent is sufficient.

### Step 3d: "+ New" button → ghost style

- [ ] **Step 3d-1: Restyle `.newBtn` in ResourceTable.module.css**

Find `.newBtn`:

```css
.newBtn {
  ...
  color: var(--bg-app);
  background: var(--accent);
  border: 1px solid var(--accent);
  ...
}
```

Change to ghost style:

```css
.newBtn {
  ...
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent-soft);
  ...
}
.newBtn:hover {
  background: var(--accent-softer);
  border-color: var(--accent);
}
```

Remove the existing `.newBtn:hover` block (if separate) or merge into the rule above.

- [ ] **Step 3e: Visual check**

```bash
VITE_DEMO=1 pnpm dev &
# Verify: rows are tighter (~26px), table fills width, right columns visible,
# "+ New" button has outline style, opening detail panel scrolls table horizontally
pkill -f "vite"
```

- [ ] **Step 3f: Commit**

```bash
git add src/components/table/ResourceTable.tsx src/components/table/ResourceTable.module.css
git commit -m "feat(table): tighter rows, fixed layout, ghost +New, horizontal scroll on panel-open"
```

---

## Task 4: Detail panel — header meta chips + logs toolbar reflow

**Files:**
- Modify: `src/components/detail/DetailPanel.module.css`
- Modify: `src/components/detail/LogsTab.tsx`
- Modify: `src/components/detail/LogsTab.module.css`

### Step 4a: Header meta row — wrap-safe chips

- [ ] **Step 4a-1: Make `.meta` flex-wrap**

In `DetailPanel.module.css`, find `.meta`:

```css
.meta {
  display: flex;
  gap: 16px;
  margin: 9px 0 12px;
  padding-left: 22px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
```

Change to:

```css
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 9px 0 12px;
  padding-left: 22px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--text-muted);
}
```

- [ ] **Step 4a-2: Style each meta entry as a chip**

Add a new class:

```css
.metaChip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--bg-control);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
```

In `DetailPanel.tsx`, find the `.meta` rendering. The current code renders `<div className={styles.meta}>` with span children. Wrap each key-value pair in a `<span className={styles.metaChip}>` container. (Check exact code structure first — the meta rendering may be in the `DetailHeader` sub-component or inline.)

### Step 4b: Logs toolbar — two-row reflow

- [ ] **Step 4b-1: Read current LogsTab toolbar structure**

The toolbar renders filter input, container selector, timestamp toggle, time range, previous toggle, and save button in a single flex row. At the detail panel's 540px min-width this wraps awkwardly and clips.

- [ ] **Step 4b-2: Split toolbar into two rows in LogsTab.module.css**

Find the toolbar container class (likely `.toolbar` or `.logToolbar` or the class wrapping the filter row). Add:

```css
.logToolbar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  align-items: center;
  /* Row 1: filter + container. Row 2: ts + time + previous + save. */
}

.logToolbarPrimary {
  display: flex;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  align-items: center;
}

.logToolbarSecondary {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}
```

In `LogsTab.tsx`, wrap the toolbar items:
- Row 1 (`.logToolbarPrimary`): filter input + container picker
- Row 2 (`.logToolbarSecondary`): ts toggle + time range + previous + save

The parent `.logToolbar` uses `flex-wrap: wrap` so these naturally break into two rows at narrow widths.

- [ ] **Step 4b-3: Verify at 540px panel width**

```bash
VITE_DEMO=1 pnpm dev &
# Pods → click CrashLoopBackOff → Logs tab
# Verify: toolbar shows two rows, no clipped buttons, filter input full-width on row 1
pkill -f "vite"
```

- [ ] **Step 4b-4: Commit**

```bash
git add src/components/detail/DetailPanel.module.css src/components/detail/DetailPanel.tsx
git add src/components/detail/LogsTab.tsx src/components/detail/LogsTab.module.css
git commit -m "feat(detail): header meta chips, logs toolbar two-row reflow"
```

---

## Task 5: Overlay layering — scrim + shadow

**Files:**
- Modify: `src/App.module.css`

- [ ] **Step 5-1: Add scrim and shadow to `.overlay`**

In `App.module.css`, find `.overlay`:

```css
.overlay {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  overflow: auto;
}
```

Change to:

```css
.overlay {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  overflow: auto;
  background: var(--bg-app);
  box-shadow: var(--shadow-lg);
  border-radius: var(--radius-lg);
  margin: var(--space-2);
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 5-2: Add backdrop overlay behind the overlay content**

In `App.tsx`, wrap each overlay block in a backdrop div. Find the pattern:

```tsx
{overlay === "helm-market" && (
  <div className={styles.overlay}>
    <HelmMarket onClose={closeOverlay} />
  </div>
)}
```

Change to:

```tsx
{overlay === "helm-market" && (
  <div className={styles.overlayBackdrop}>
    <div className={styles.overlay}>
      <HelmMarket onClose={closeOverlay} />
    </div>
  </div>
)}
```

Repeat for every `{overlay === "..." && (` block in App.tsx (there are ~10).

In `App.module.css`, add:

```css
.overlayBackdrop {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: stretch;
  background: var(--scrim);
}
```

- [ ] **Step 5-3: Verify overlay visually separates from table**

```bash
VITE_DEMO=1 pnpm dev &
# Click PromQL → overlay floats above table with visible shadow and scrim
# Click Dashboard → same
pkill -f "vite"
```

- [ ] **Step 5-4: Commit**

```bash
git add src/App.module.css src/App.tsx
git commit -m "feat(overlay): unified scrim + shadow-lg layering for all feature overlays"
```

---

## Task 6: Dashboard — breadcrumb sync, overview card, stat colors

**Files:**
- Modify: `src/components/dashboard/Dashboard.tsx`
- Modify: `src/components/dashboard/Dashboard.module.css`

### Step 6a: Breadcrumb sync

- [ ] **Step 6a-1: Update breadcrumb when overlay is open**

The breadcrumb is rendered in the topbar. The topbar reads `nav` from the store, which stays as "pods" when the dashboard overlay is open. Add a conditional: when `overlay !== null`, show `context / overlayLabel` instead of the nav path.

In `Dashboard.tsx`, check if the breadcrumb override can be done via store — the topbar reads from store, so the cleanest fix is: when `overlay` changes, the breadcrumb component checks `overlay` and renders the overlay label. Find the breadcrumb rendering (likely in `src/components/topbar/` or inline in Dashboard's header).

If the breadcrumb is inside Dashboard.tsx itself (the "Dashboard" heading with a close button), adjust: show `<breadcrumb>/ Dashboard` where the breadcrumb prefix is the current context name.

The simplest approach: in Dashboard.tsx's header, replace the static "Dashboard" heading with a breadcrumb-aware label that reads `contextName / Dashboard`.

### Step 6b: Cluster overview consolidation

- [ ] **Step 6b-1: Merge Cluster Health ring + CPU + Memory into one card**

In Dashboard.tsx, find the ClusterHealth component render (the ring chart) and the CPU/Memory row. Replace both with a single horizontal card:

```tsx
<div className={styles.overviewCard}>
  <div className={styles.overviewRing}>
    {/* existing donut SVG or canvas, sized to ~80px */}
  </div>
  <div className={styles.overviewStats}>
    <div className={styles.overviewStat}>
      <span className={styles.overviewLabel}>CPU</span>
      <span className={styles.overviewBar}>
        <span className={styles.overviewFill} style={{ width: `${cpuPct}%` }} />
      </span>
      <span className={styles.overviewValue}>{cpuPct}%</span>
    </div>
    <div className={styles.overviewStat}>
      <span className={styles.overviewLabel}>MEM</span>
      <span className={styles.overviewBar}>
        <span className={styles.overviewFill} style={{ width: `${memPct}%` }} />
      </span>
      <span className={styles.overviewValue}>{memPct}%</span>
    </div>
  </div>
</div>
```

CSS:

```css
.overviewCard {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-control);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}
.overviewStats {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.overviewStat {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.overviewLabel {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-muted);
  width: 32px;
}
.overviewBar {
  flex: 1;
  height: 6px;
  background: var(--bg-hover);
  border-radius: 3px;
  overflow: hidden;
}
.overviewFill {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
}
.overviewValue {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  width: 36px;
  text-align: right;
}
```

### Step 6c: Stat card numeral color

- [ ] **Step 6c-1: Unify stat card numeral to `--text-primary`**

Find the stat card rendering (the 13 Pods / 6 Deployments / 4 Services / 3 DaemonSets row). The numerals currently use per-card accent/status colors. Change all numerals to `color: var(--text-primary)`, keep only labels as semantic color:

In the stat card's CSS, find the numeral class and change `color: var(--accent)` (or inline style) to `color: var(--text-primary)`.

- [ ] **Step 6d: Visual check**

```bash
VITE_DEMO=1 pnpm dev &
# Dashboard overlay: breadcrumb shows "context / Dashboard"
# Cluster Health + CPU/Memory merged into one horizontal card, no empty right side
# Stat numerals all white (--text-primary)
pkill -f "vite"
```

- [ ] **Step 6e: Commit**

```bash
git add src/components/dashboard/Dashboard.tsx src/components/dashboard/Dashboard.module.css
git commit -m "feat(dashboard): breadcrumb sync, overview consolidation, stat color unification"
```

---

## Task 7: Metrics Explorer — legend, empty state, button size

**Files:**
- Modify: `src/components/metrics/MetricsExplorer.tsx`
- Modify: `src/components/metrics/MetricsExplorer.module.css`

### Step 7a: Chart legend

- [ ] **Step 7a-1: Add legend below the Plotly chart**

The chart is rendered via a Plotly `<Plot>` component. Add a `legend` config to the Plotly layout, or render a custom legend div below the chart.

In the Plotly layout config (inside MetricsExplorer.tsx), add:

```ts
layout: {
  ...existingLayout,
  showlegend: true,
  legend: {
    orientation: "h",
    x: 0,
    y: -0.15,
    font: { color: "var(--text-secondary)", size: 11 },
  },
}
```

Also ensure each trace has a `name` property.

### Step 7b: Y-axis unit label

- [ ] **Step 7b-1: Add axis title**

In the Plotly layout:

```ts
yaxis: {
  ...existingYaxis,
  title: { text: unitLabel, font: { color: "var(--text-muted)", size: 10 } },
}
```

Where `unitLabel` is derived from the selected source (e.g. "bytes", "%", "cores"). If the source selector exposes a unit field, use it; otherwise show no title (empty string) to avoid misleading labels.

### Step 7c: Empty state

- [ ] **Step 7c-1: Show placeholder when no data**

When the query result is empty or loading, instead of rendering a bare Plotly axis frame, show:

```tsx
{!data || data.length === 0 ? (
  <div className={styles.emptyState}>
    <span>Run a query to see metrics</span>
  </div>
) : (
  <Plot ... />
)}
```

CSS:

```css
.emptyState {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-faint);
  font-size: var(--text-sm);
  min-height: 200px;
}
```

### Step 7d: Saved query button size

- [ ] **Step 7d-1: Enlarge action buttons**

Find the saved query row actions (↻ and ×). Wrap them in a class with minimum hit area:

```css
.savedAction {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  font-size: var(--text-md);
}
.savedAction:hover {
  background: var(--bg-hover);
  border-color: var(--border-control);
  color: var(--text-primary);
}
```

- [ ] **Step 7e: Visual check**

```bash
VITE_DEMO=1 pnpm dev &
# PromQL overlay: chart shows legend + unit label, saved actions ≥28px hit area
pkill -f "vite"
```

- [ ] **Step 7f: Commit**

```bash
git add src/components/metrics/MetricsExplorer.tsx src/components/metrics/MetricsExplorer.module.css
git commit -m "feat(metrics): chart legend + unit label, empty state, larger saved-query actions"
```

---

## Task 8: Sidebar — lucide icons replacing Unicode glyphs

**Files:**
- Modify: `src/components/sidebar/NavList.tsx`
- Modify: `src/components/sidebar/Sidebar.module.css`
- Modify: `src/lib/kinds.ts` (icon field type changes)

### Step 8a: Update KIND_META icon type from `string` → `React.ReactNode`

- [ ] **Step 8a-1: Change the `icon` field type**

In `src/lib/kinds.ts`, find the `KIND_META` type. The `icon` field is currently `string`. Change to `React.ReactNode` (or `string | React.ReactNode` if some icons are still strings).

```ts
// Before
icon: string;

// After
icon: React.ReactNode;
```

Import `React` if not already imported.

- [ ] **Step 8a-2: Update icon values in KIND_META**

Replace each Unicode glyph with the corresponding lucide icon. The mapping:

| Current | Lucide import | Component |
|---|---|---|
| Pods `"◉"` | `import { Circle } from "lucide-react"` | `<Circle size={14} />` |
| Deployments `"▲"` | `import { Rocket } from "lucide-react"` | `<Rocket size={14} />` |
| ReplicaSets `"❐"` | `import { Copy } from "lucide-react"` | `<Copy size={14} />` |
| StatefulSets `"≡"` | `import { Layers } from "lucide-react"` | `<Layers size={14} />` |
| DaemonSets `"⦿"` | `import { RefreshCw } from "lucide-react"` | `<RefreshCw size={14} />` |
| Jobs `"▸"` | `import { Timer } from "lucide-react"` | `<Timer size={14} />` |
| CronJobs `"↻"` | `import { Clock } from "lucide-react"` | `<Clock size={14} />` |
| HPAs `"↕"` | `import { TrendingUp } from "lucide-react"` | `<TrendingUp size={14} />` |
| Services `"⇄"` | `import { Zap } from "lucide-react"` | `<Zap size={14} />` |
| Ingresses `"⇥"` | `import { ArrowRightFromLine } from "lucide-react"` | `<ArrowRightFromLine size={14} />` |
| IngressClasses `"⇉"` | `import { Network } from "lucide-react"` | `<Network size={14} />` |
| NetworkPolicies `"▦"` | `import { Shield } from "lucide-react"` | `<Shield size={14} />` |
| ConfigMaps `"☰"` | `import { FileText } from "lucide-react"` | `<FileText size={14} />` |
| Secrets `"⚿"` | `import { KeyRound } from "lucide-react"` | `<KeyRound size={14} />` |
| ServiceAccounts `"☺"` | `import { User } from "lucide-react"` | `<User size={14} />` |
| PVCs `"▤"` | `import { Database } from "lucide-react"` | `<Database size={14} />` |
| PVs `"▦"` | `import { HardDrive } from "lucide-react"` | `<HardDrive size={14} />` |
| StorageClasses `"▤"` | `import { FolderArchive } from "lucide-react"` | `<FolderArchive size={14} />` |
| Nodes `"⬡"` | `import { Server } from "lucide-react"` | `<Server size={14} />` |
| Namespaces `"⊞"` | `import { LayoutGrid } from "lucide-react"` | `<LayoutGrid size={14} />` |
| Events `"⚡"` | `import { Activity } from "lucide-react"` | `<Activity size={14} />` |
| Helm `"⎈"` | `import { Package } from "lucide-react"` | `<Package size={14} />` |
| ResourceQuotas `"∑"` | `import { Gauge } from "lucide-react"` | `<Gauge size={14} />` |
| Roles `"🔒"` | `import { Lock } from "lucide-react"` | `<Lock size={14} />` |

(Exact lucide names to verify: check `lucide-react` exports. The mapping above is a best-effort match; use the closest semantic icon from the lucide set.)

- [ ] **Step 8a-3: Update `.navIcon` CSS in Sidebar.module.css**

```css
.navIcon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--text-faint);
}
```

### Step 8b: Update OverlayItem icon type

- [ ] **Step 8b-1: Change `OverlayItemDef.icon` from `string` to `React.ReactNode`**

In `NavList.tsx`, find:

```ts
type OverlayItemDef = { key: OverlayKey; label: string; icon: string };
```

Change to:

```ts
type OverlayItemDef = { key: OverlayKey; label: string; icon: React.ReactNode };
```

- [ ] **Step 8b-2: Update all overlay icon literals**

Replace each Unicode string with a lucide JSX element in the `OverlaySection` and inline overlay items:

| Current | Lucide |
|---|---|
| `Endpoincts "⇆"` | `<Zap size={14} />` |
| `Topology "◌"` | `<CircleDot size={14} />` |
| `IngressRoutes "⇥"` | `<ArrowRightFromLine size={14} />` |
| `IngressEditor "✎"` | `<Pencil size={14} />` |
| `HelmMarket "⎈"` | `<Package size={14} />` |
| `Dashboard "◐"` | `<LayoutDashboard size={14} />` |
| `Metrics "≋"` | `<BarChart3 size={14} />` |
| `Alerting "△"` | `<Bell size={14} />` |
| `Grafana "▣"` | `<LineChart size={14} />` |
| `Audit "📋"` | `<ClipboardList size={14} />` |
| `ImageRegistries "⬚"` | `<Container size={14} />` |
| `ImageImport "⬆"` | `<Upload size={14} />` |
| `PodFiles "▤"` | `<FolderOpen size={14} />` |
| `Templates "✚"` | `<PlusSquare size={14} />` |
| `Diff "⇄"` | `<GitCompareArrows size={14} />` |
| `Plugins "⌂"` | `<Plug size={14} />` |

- [ ] **Step 8c: Visual check**

```bash
VITE_DEMO=1 pnpm dev &
# Sidebar: all entries show consistent 14px lucide icons, no Unicode glyphs
pkill -f "vite"
```

- [ ] **Step 8d: Commit**

```bash
git add src/components/sidebar/NavList.tsx src/components/sidebar/Sidebar.module.css src/lib/kinds.ts
git commit -m "feat(sidebar): replace Unicode glyphs with lucide-react icons across nav and overlays"
```

---

## Task 9: Sidebar reorganization — Dashboard top + group reorder

**Files:**
- Modify: `src/lib/kinds.ts`
- Modify: `src/lib/kinds.test.ts`
- Modify: `src/components/sidebar/NavList.tsx`

### Step 9a: Reorder GROUP_ORDER

- [ ] **Step 9a-1: Change GROUP_ORDER in kinds.ts**

Current:

```ts
export const GROUP_ORDER: NavGroup[] = [
  "workloads",
  "network",
  "config",
  "access",
  "storage",
  "cluster",
  "helm",
  "custom",
];
```

Change to:

```ts
export const GROUP_ORDER: NavGroup[] = [
  "workloads",
  "network",
  "storage",
  "config",
  "access",
  "helm",
  "cluster",
  "custom",
];
```

(STORAGE moves before CONFIG; CLUSTER moves after HELM.)

- [ ] **Step 9a-2: Update kinds.test.ts if it asserts on group order**

Search for tests that check `GROUP_ORDER` or sidebar rendering order and update expected values.

### Step 9b: Dashboard pinned at sidebar top

- [ ] **Step 9b-1: Move Dashboard OverlayItem above the GROUP_ORDER loop**

In `NavList.tsx`, in the `OverlaySection` component, move the Dashboard `OverlayItem` rendering to the top of the returned JSX, above the resource groups loop. Alternatively, render it in `NavList` itself before `{GROUP_ORDER.map(...)}`.

The cleaner approach: in `NavList.tsx`, render Dashboard at the top of the `.nav` container, before the GROUP_ORDER loop:

```tsx
<div className={styles.nav}>
  {/* Dashboard — pinned at top, above all resource groups */}
  <OverlayItem
    item={{ key: "dashboard", label: t("chrome.sidebar.tools.dashboard", "Dashboard"), icon: <LayoutDashboard size={14} /> }}
    overlay={overlay}
    openOverlay={openOverlay}
    closeOverlay={closeOverlay}
    titleClose={t("chrome.sidebar.tools.close", "Click to close")}
  />
  <div className={styles.sectionDivider} />

  {GROUP_ORDER.map((group) => (
    /* ... existing group rendering ... */
  ))}

  <div className={styles.sectionDivider} />
  <OverlaySection t={t} />  {/* Remove Dashboard from inside OverlaySection */}
</div>
```

- [ ] **Step 9b-2: Remove Dashboard from OverlaySection**

In the `OverlaySection` function, delete the Dashboard `OverlayItem` (it's now rendered in `NavList` directly).

### Step 9c: Default landing on Dashboard

- [ ] **Step 9c-1: Change initial nav state to Dashboard**

Find where the store's initial `nav` value is set. If the store initializes `nav` as the first kind in `KIND_ORDER` (which is currently "Pods"), change it so that on connect (or in `initialState`), if no persisted preference exists, `nav` defaults to a value that triggers the Dashboard overlay open.

The store likely has an `openOverlay` action. After connect, if no persisted nav preference exists, call `openOverlay("dashboard")` instead of navigating to Pods.

Check `src/store.ts` for the `connect` handler or initial state. The cleanest fix: in the connect callback (where watchers start), if no persisted `nav`, open the dashboard overlay:

```ts
// In the connect handler or a useEffect that runs once on mount:
if (!persistedNav) {
  openOverlay("dashboard");
}
```

- [ ] **Step 9c-2: Visual check**

```bash
VITE_DEMO=1 pnpm dev &
# App opens → Dashboard overlay shown by default (not Pods table)
# Sidebar: Dashboard pinned top, STORAGE before CONFIG, CLUSTER after HELM
# TOOLS section visible at bottom
pkill -f "vite"
```

- [ ] **Step 9d: Commit**

```bash
git add src/lib/kinds.ts src/lib/kinds.test.ts src/components/sidebar/NavList.tsx src/store.ts
git commit -m "feat(sidebar): Dashboard pinned top + default landing, reorder groups (STORAGE before CONFIG, CLUSTER last)"
```

---

## Task 10: Visual regression — re-take README screenshots

**Files:**
- Modify: `docs/screenshots/01-pods-table.png` through `06-metrics.png` (regenerated)
- New: `docs/screenshots/07-dashboard.png` (Dashboard overlay)

- [ ] **Step 10-1: Update shots script for new Dashboard shot**

In `dev/shots.mjs`, add a 7th entry to the `SHOTS` array:

```js
{
  name: "07-dashboard",
  caption: "dashboard",
  script: `await openOverlay("dashboard"); await sleep(500);`,
}
```

- [ ] **Step 10-2: Run shots**

```bash
VITE_DEMO=1 pnpm dev &
pnpm dev:shots
pkill -f "vite"
```

- [ ] **Step 10-3: Review all 7 screenshots visually — confirm:**

- Rows tighter (~26px) in `01-pods-table.png`
- No clipped columns in `01-pods-table.png`
- "+ New" ghost button visible
- Logs toolbar two rows in `02-logs.png`
- Timestamps clearly readable in `02-logs.png`
- Lucide icons in sidebar (all screenshots)
- Dashboard overview card consolidated, stats white, breadcrumb "context / Dashboard" in `07-dashboard.png`

- [ ] **Step 10-4: Commit updated screenshots**

```bash
git add docs/screenshots/
git commit -m "chore: regenerate README screenshots after UI polish pass"
```

---

## Task 11: Final test suite + typecheck

- [ ] **Step 11-1: Run full test suite**

```bash
pnpm test
```

Expected: all tests pass (kinds.test.ts updated in Task 9).

- [ ] **Step 11-2: Run typecheck**

```bash
pnpm typecheck
```

Expected: no errors (lucide types resolve, icon type widening from `string` to `ReactNode` propagates correctly).

- [ ] **Step 11-3: Run dev:shots visual regression**

```bash
VITE_DEMO=1 pnpm dev &
pnpm dev:shots
pkill -f "vite"
```

Expected: all 7 screenshots regenerate without errors.

- [ ] **Step 11-4: Commit any test fixes (if needed)**

```bash
git add -A
git commit -m "fixup: address test/typecheck failures from UI polish pass"
```

---

## Execution Order Summary

| Order | Task | Dependencies | Estimated touches |
|---|---|---|---|
| 1 | Install lucide-react | none | 1 file |
| 2 | tokens.css timestamp fix | none | 1 file, 1 line |
| 3 | ResourceTable density/layout | none | 2 files |
| 4 | Detail panel meta + logs toolbar | none | 3–4 files |
| 5 | Overlay scrim + shadow | none | 2 files |
| 6 | Dashboard | task 5 (breadcrumb depends on overlay structure) | 2 files |
| 7 | Metrics Explorer | none | 2 files |
| 8 | Sidebar icons | task 1 (lucide installed) | 3 files |
| 9 | Sidebar reorg + default landing | task 8 (icons done) | 3–4 files |
| 10 | Screenshot regeneration | tasks 3–9 all done | docs only |
| 11 | Final test + typecheck | all above | 0 files |

Tasks 2–7 are CSS/TS changes in independent file areas and can be parallelized by a subagent dispatcher. Tasks 8–9 depend on lucide-react being installed (task 1) and each other (8 before 9). Task 10 is a final polish pass.
