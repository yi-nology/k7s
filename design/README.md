# Handoff: K8s Monitor ("k7s") — Tauri + Rust desktop app

> **v2 design refresh.** Tokens, radii, and accent were reworked in August 2026
> from the original "murphy-yi" prototype: cool near-black surfaces, a Linear-style
> indigo accent with a gradient, teal-green (not matrix-green) status-ok,
> bigger radii (6/8/10/14) for layered depth, heavier use of backdrop-blur,
> halos on status dots, and a real two-theme system (dark + light) sharing
> one token table. The structural spec (sidebar | topbar | content |
> statusbar, pod detail panel) is unchanged.

## Overview

A Kubernetes cluster monitor in the spirit of Lens: left navigation over
all common resource kinds, resource tables with namespace filtering, and a
pod detail panel with **streaming logs**, **YAML view/edit**, **Properties**,
**Metrics**, and **Events**. Target implementation: a **Tauri desktop app**
— Rust backend talking to the Kubernetes API, webview frontend
recreating this design.

## About the Design Files

- `K8s Monitor.dc.html` — a high-fidelity HTML/CSS/JS prototype showing the
  intended look and behavior. The markup is hand-written; the styles
  reproduce the v2 token set.
- The implementation in this repo is the source of truth at runtime —
  `src/styles/tokens.css` holds the token table that both the prototype
  and the live app pull from. Keep the two in sync.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and interactions are final.
All styling values below come from `tokens.css` and are exact.

## Suggested Tauri/Rust architecture

Identical to the v1 handoff — `kube` + `k8s-openapi` on the Rust side,
React + Vite on the frontend, Tauri events for live data, SSE for the
browser shell. The sharding recommendation is unchanged:

- **Rust side (`src-tauri/`):** `kube` + `k8s-openapi` crates.
  - Kubeconfig contexts → cluster switcher entries
    (`kube::config::Kubeconfig::read()`).
  - List/watch each resource kind with `kube::runtime::watcher`; push updates
    to the frontend via Tauri **events** (`app.emit`) — this powers live
    table counts and the "watch: N streams active" footer.
  - Logs: `Api::<Pod>::log_stream` with `LogParams { follow: true, container,
    timestamps }`; forward lines as Tauri events (`log-line:{pod}`); cancel
    the stream task on pause/close.
  - YAML: `serde_yaml::to_string` of the fetched object; Apply =
    `Api::replace` (or server-side apply) from the edited text; report errors
    back to the UI.
  - Events tab: `Api::<Event>::list` field-selected by `involvedObject.name`.
- **Frontend:** invoke commands (`list_resources`, `get_yaml`,
  `apply_yaml`, `start_log_stream`, `stop_log_stream`) + listen to events.
  Keep a capped ring buffer (default 200 lines) for logs.
- Window: frameless optional; min size ~1280×800. Window background
  `#0A0A0F` (dark) / `#FAFAFB` (light) to match the active palette.

## Screens / Views

### App shell (single window)

Horizontal flex, full viewport, layered background:
`background: var(--grad-bg), var(--bg-app)`. The radial wash is
a single 4% accent blob in the top-left, decoupled from the flat surface
so a theme change updates both atomically.

Text `#D6D6E0`, base font `13.5px 'IBM Plex Sans'`, `font-variant-numeric:
tabular-nums` for any mono data. Monospace: `'JetBrains Mono'`. Both
bundled locally in Tauri.

### 1. Sidebar — 240px, `background:#0F0F14`, right border `1px #23232C`

The sidebar is wrapped in a `data-surface="panel"` element. In light mode
that flips the inner tokens to the dark-panel palette (`#0F0F14` panel
inside a light app) so the inspector feels intentional rather than
accidentally darker than the table.

- **Brand row** (top, padding `18px 18px 12px`):
  - 30×30 gradient mark `linear-gradient(135deg, #7B85F5 0%, #5E6AD2 100%)`
    with `border-radius: 8px`, soft outer glow
    `0 4px 14px rgba(123,133,245,.35)`, and inset highlight
    `inset 0 1px 0 rgba(255,255,255,.18)`. Centered "k7" mono 13px bold white.
  - Brand name "k7s" 14px semibold `#F2F2F8`; subtitle "kubernetes monitor"
    10px `#56566A` mono, slight tracking.
- **Cluster switcher** (`margin: 0 12px 8px`):
  - Button `padding: 8px 10px; background:#16161C; border:1px #2A2A35;
    border-radius: 8px; hover: border #5C5C7A + bg #1A1A22`.
  - 28×28 badge (gradient `#3A3A48 → #26262F`, `border-radius: 7px`, mono
    10.5px bold `#D6D6E0`, inset highlight).
  - Cluster name 12.5px semibold `#F2F2F8`, ellipsized.
  - Status line mono 10.5px `#6E6E80`: 6px dot + "connected · v1.31".
    Connected dot is `#4EC9B0` with a 3px halo at `rgba(78,201,176,.18)`.
  - 9px `▾` chevron in `#6E6E80`.
  - Open dropdown: absolute, `left:0; right:0; top:56px; z-index:50`,
    bg `#14141A`, border `1px #363645`, `border-radius: 8px`,
    `box-shadow: 0 4px 16px rgba(0,0,0,.4)`. Each row 8px 10px padding;
    6px status dot (green if current else `#57575F`); name 12.5px
    `#F2F2F8`; env tag mono 10px `#6E6E80`. Active row bg `#1A1A22`,
    hover `#20202A`. 1px divider then "＋ Import kubeconfig…" row with a
    `#7B85F5` plus glyph.
- **Nav** (scrollable, `padding: 8px 0 12px`):
  - Section headers: mono 10px uppercase `letter-spacing: 0.14em`,
    color `#56566A`. Padding `12px 18px 4px`.
  - Items: `margin: 1px 10px; padding: 6px 8px 6px 12px;
    border-radius: 6px`. 16px icon column, 12.5px label, 10.5px tabular
    count chip on the right (`background:#16161C; border-radius: 4px`).
  - **Active state:** bg `#1A2440`, 2px left border (a `::before` overlay
    using `--accent-grad` with `box-shadow: 0 0 12px var(--accent)` for
    the glow); label color `#F2F2F8` weight 600; count chip flips to
    `--accent-soft` bg + `#7B85F5` text. Plus `inset 0 0 0 1px
    var(--border-ring)` so the active row reads as a contained pill.
  - **Hover:** bg `#1A1A22`, label color `#F2F2F8`.
- **Footer**: `padding: 12px 16px; border-top: 1px #23232C; background
  rgba(0,0,0,.15)`. Mono 10.5px `#6E6E80`: 7px accent dot with
  `box-shadow: 0 0 0 3px var(--accent-softer), 0 0 12px var(--accent-soft)`
  + 2s ease-in-out pulse (`opacity` + `transform: scale`) + "watch: N
  streams active" + 14px gear (hover: color `#F2F2F8`, bg `#1A1A22`).

### 2. Top bar — 56px, glassy

- `background: rgba(10,10,15,.72)` (dark) / `rgba(255,255,255,.72)` (light)
  with `backdrop-filter: blur(20px) saturate(180%)`. The light override
  lives on `[data-theme="light"] .topbar` so theme flips update the tint
  in lockstep.
- Bottom border `1px #23232C`; `z-index: 5` so dropdowns slot under it
  but the chrome itself never goes behind the table.
- **Left — breadcrumb:** mono 13px: cluster `/` group `/` `Kind`
  (the last segment in `#F2F2F8` semibold, rest in `#6E6E80`).
  Separators `#3A3A4A` at 60% opacity.
- **Right — quick search affordance** (240px, height 32px):
  `padding: 6px 10px 6px 12px; background: #16161C; border:1px #2A2A35;
  border-radius: 8px`. "⌕" + "Search anything…" placeholder (`#56566A`)
  + two `kbd` chips showing `⌘ K` (each `padding: 1px 5px;
  background: var(--bg-app); border: 1px #2A2A35; border-radius: 4px;
  mono 10px`). Hover lifts border to `#5C5C7A`; `:focus-visible`
  promotes border to accent + `box-shadow: var(--shadow-glow)`. Click
  dispatches `setPaletteOpen(true)` (the ⌘K palette is a separate
  component — this is a discoverable pointer to it).
- **Right — language switcher** (40px wide): same chrome as the ns button
  with the locale short label (`EN` / `中`).
- **Right — namespace dropdown:** `padding: 5px 10px;
  border-radius: 8px`. Mono 11.5px: `ns:` in `#56566A`, current value
  in `#F2F2F8` weight 500, 8px `▾`. Menu absolute right-aligned,
  min-width 180px, same chrome as cluster dropdown, rows mono 11px with
  12px-wide check column rendering `✓` in `#7B85F5` for the selected ns.

### 3. Resource table

Fills the remaining width; toolbar (fixed) above a scrolling region with
sticky header.

- **Toolbar** (`padding: 12px 18px; border-bottom: 1px #1B1B23`):
  - Search field 320px: `padding: 6px 12px; background: #16161C;
    border: 1px #2A2A35; border-radius: 8px`. Mono 12px. Focus promotes
    border to accent + `0 0 0 3px var(--accent-soft)` halo.
  - Three health pills on the right: `22 running`, `1 pending`,
    `1 failed`. Each `padding: 5px 11px; border-radius: 999px; border:
    1px #2A2A35; background: #16161C`. Status dot 6px with the
    appropriate `--status-*-soft` halo. The `failed` dot uses a
    1.6s ease-in-out infinite pulse (`box-shadow` 3px→5px spread).
- **Sticky header** `background: var(--bg-chrome)`: text `uppercase
  10.5px; letter-spacing: 0.12em; color: #56566A; padding: 11px 18px;
  border-bottom: 1px #23232C`. Hover lifts color to `#A6A6B8`. Active
  sort column shows a `▲` / `▼` arrow in `#7B85F5`.
- **Rows** (`padding: 11px 18px; border-bottom: 1px #1B1B23`).
  Hover bg `#1A1A22`. Selected row bg `#1B2742`; hover on top
  `#1F2D52`. Highlighted-from-keyboard row gets `background: #16161C`
  + `box-shadow: inset 2px 0 0 var(--accent)`.
- **Cells** — monospace 12.5px, `tabular-nums`:
  - Name: `#F2F2F8` weight 500
  - Namespace / age: `#6E6E80`
  - Metrics: `#A6A6B8`
  - Warning (e.g. `1/2` ready, restarts > 5): `#E0AF68` weight 500
  - Error: `#F76E8E` weight 600
- **Status cell** — a tone-driven pill: 8px dot + 3px halo (matching
  `--status-*-soft`) + label in the same tone. Failed rows pulse the
  dot's halo from 3px to 5px over 1.4s.
- **CPU / Memory columns** prefix a 44×4 mini bar (track
  `--bg-control` with a 1px `--border-row` border; fill
  `--accent-grad` for normal rows, `--status-warn` for `pending`,
  `--status-err` for failed).
- **Empty filter state** — centered mono 12px `#56566F` at
  `padding: 56px 40px`: "no resources match filter".
- **Pod columns:** NAME, NAMESPACE, READY, RESTARTS, CPU, MEM, AGE,
  STATUS. Other kinds follow the per-kind column sets in
  `lib/kinds.ts`.

### 4. Pod detail panel — 48% width (min 540px)

Opens when a row is clicked. `×` button is a 28×28 icon button in
the title row (hover: bg `#1A1A22`, color `#F2F2F8`, border `#2A2A35`).
Other kinds get a simpler header; only pods get the full tab strip.

- **Outer chrome:** `border-left: 1px #23232C; background: #0C0C11;
  box-shadow: -16px 0 32px rgba(0,0,0,.45)` so the panel reads as
  lifted above the table.
- **Header** (`padding: 16px 20px 0`):
  - Title row: 10px status dot + 14px mono semibold pod name
    (`#F2F2F8`, ellipsized) + actions menu (`⋯`) + close button.
  - Status dot is tone-classed: `#4EC9B0` with a 3px halo +
    `0 0 16px rgba(78,201,176,.35)` for ok; `#F76E8E` with a halo
    + `0 0 16px rgba(247,118,142,.4)` + a 1.4s pulse for err;
    `#E0AF68` with `0 0 14px rgba(224,175,104,.35)` for warn.
  - Meta row mono 11px: `ns:`, `node:`, `age:` (values `#A6A6B8`)
    + status word in its tone. Padded `9px 0 12px`, `padding-left: 22px`
    to clear the dot.
  - **Header bottom edge:** a soft gradient hairline from
    `transparent → #23232C 30% → #23232C 70% → transparent` — the
    panel's title shelf, instead of a hard 1px line.
- **Tabs** (`padding: 0 14px; border-bottom: 1px #23232C`):
  - 12.5px medium, `padding: 10px 14px`, `border-bottom: 2px solid
    transparent` (active: `#7B85F5` with a `::after` that puts a
    12px glow centered on the underline).
  - Inactive `#6E6E80`, hover `#A6A6B8`.
  - Tab count badge (`<span>`): mono 10px, `padding: 1px 6px;
    border-radius: 4px; background: #16161C`; active flips to
    `--accent-soft` + `#7B85F5`.

#### Logs tab

- **Toolbar** (`padding: 10px 18px; border-bottom: 1px #1B1B23`):
  - Log search field flex-1: same chrome as the table search; mono
    12px placeholder "filter logs…".
  - Container cycler button (`#A6A6B8` mono 11.5px), ts toggle
    (active: `--accent-soft` + border + text accent), follow/pause
    (following: border `#3A8A6F`, text `#4EC9B0`, bg `rgba(31,139,112,0.10)`;
    paused: border `#8A6A2A`, text `#E0AF68`, bg `rgba(180,122,14,0.10)`).
- **Log area** (`background: #08080C; padding: 8px 0; font-size: 12px;
  line-height: 1.7`):
  - Each line: timestamp `HH:MM:SS.mmm` `#56566A` (hidden when ts off)
    · 48px level column (semibold) — INFO `#7B85F5`, WARN `#E0AF68`,
    ERROR `#F76E8E`, DEBUG `#6E6E80` · message default `#A6A6B8`,
    ERROR lines `#F2A5B3`, WARN lines `#D8C39A`. Row hover
    `#13131A`.
- **Behavior** (unchanged from v1): auto-scroll to bottom while
  following; pause halts both the stream and the auto-scroll; search
  filters client-side; ring buffer caps lines (default 200).
- **Footer strip** (`padding: 7px 18px; border-top: 1px #1B1B23;
  background: #0C0C11`): mono 10.5px `#56566A` — line count, container
  name, `streaming` (green, with a 1.6s pulse) or `paused` (amber).

#### Properties tab

Vertical list of object metadata — labels, annotations, owner refs,
tolerations. Same card chrome as the Events tab.

#### YAML tab

- **Toolbar:** resource path mono 10.5px `#6E6E80`
  (`pods/<ns>/<name>.yaml`); right side flips between read and edit
  mode.
- **Read mode:** `background: #08080C; mono 12px; line-height: 1.6`;
  line numbers right-aligned 30px `#34343C`; keys `#A6A6B8`, colon
  `#6E6E80`, values `#D6D6E0`, quoted strings `#4EC9B0`, numbers
  `#E0AF68`. In production use CodeMirror with a dark theme matched
  to these tokens.
- **Edit mode:** full-height CodeMirror with the same chrome; a
  3px `#7B85F5` left border marks the active edit frame. Apply →
  PUT to the cluster; surface API errors inline.

#### Events tab

- Vertical list, 8px gap. Card: `background: #0F0F14;
  border: 1px #23232C; border-radius: 6px; padding: 9px 12px`.
- Left: type mono 10px semibold, 52px column — Normal `#4EC9B0`,
  Warning `#F76E8E`.
- Right: reason 12px semibold `#F2F2F8` + age/count mono 10px
  `#56566A` (`2m · ×14`), message 11.5px `#A6A6B8`.

### 5. Status bar — 30px, `background: #0F0F14`, top border `1px #23232C`

Mono 10.5px `#6E6E80`. The "facts about the cluster" pattern — every
stat is a labeled "key **value**" pair, separated by a faint middle dot:

- `● murphy-yi` — 7px dot (`#4EC9B0` + 2px halo) + cluster name in
  `#A6A6B8` weight 500.
- `api 42ms` — label in `#6E6E80`, value in `#A6A6B8` tabular-nums.
- `nodes 6/6 ready` — value in semibold `#A6A6B8`.
- `cpu 41%`, `mem 63%` — same shape.
- Right-aligned: `kubectl ctx: arn:aws:eks:us-east-1:...` (clipped with
  ellipsis; tabular-nums).

### 6. Forwards bar — optional strip above the status bar

Active port-forwards chips. `padding: 8px 18px; background: #0F0F14;
border-top: 1px #23232C`. Each chip: `padding: 3px 10px; border:
1px #2A2A35; border-radius: 999px; background: #16161C`. Local port
`#7B85F5` weight 600, arrow `#56566A`, target `#A6A6B8`. A failing
forward flips to `border: #F76E8E; background: rgba(247,118,142,.20)`
with a red `!` mark.

## Interactions & Behavior

- Nav click switches the active kind and clears selection. Row click
  selects; only pods (and the kinds with the full tab strip) open
  the detail panel.
- Dropdowns close on selection; only one open at a time. The cluster
  dropdown and the namespace dropdown are siblings — opening one
  closes the other.
- ⌘K / ⌃K opens the command palette; `:` does the same outside text
  fields. Esc cascades: palette → menu → multi-selection → filter →
  detail panel.
- The new `Search anything…` button in the top bar is a shortcut
  for the same palette (click = `setPaletteOpen(true)`).
- No animations besides the 2s opacity + scale pulse on live
  indicators and the 1.4s halo pulse on the failing-row status
  dot. All hovers are 0.12s ease background / border transitions.

## State Management

`selectedCluster, nav (resource kind), namespace filter, selectedPod,
activeTab (logs|properties|metrics|shell|yaml|events), logSearch,
containerIndex, showTimestamps, following, logBuffer[], yamlEditing,
yamlDraft, menusOpen`. Data: per-kind watched resource lists, pod
events, YAML text.

## Design Tokens

The full token table lives in `src/styles/tokens.css`. The two
palettes share the same role names; the values are tuned for the
intended background.

### Dark palette (default, and `[data-surface="panel"]` in light)

- **Surfaces** (cool near-black, layered for depth):
  app `#0A0A0F` · panel `#0F0F14` · chrome `#0C0C11` ·
  elevated `#14141A` · control `#16161C` · terminal `#08080C` ·
  hover `#1A1A22` · hover-strong `#20202A` · selected-row `#1B2742` ·
  active-nav `#1A2440` · log-hover `#13131A`
- **Borders:** default `#23232C` · strong `#2E2E3A` ·
  control `#2A2A35` · menu `#363645` · hover `#5C5C7A` ·
  row `#1B1B23` · ring `rgba(123,133,245,.20)` ·
  blue-action `#2A4A75`
- **Text:** primary `#F2F2F8` · body `#D6D6E0` ·
  secondary `#A6A6B8` · muted `#6E6E80` ·
  faint `#56566A` · line-num `#34343C` ·
  log-ts `#4C4C55` · nav-inactive `#9595A6`
- **Accent** (Linear-style indigo, with gradient): `#7B85F5` ·
  hover `#9AA3FF` · soft `rgba(123,133,245,.18)` ·
  softer `rgba(123,133,245,.08)` ·
  gradient `linear-gradient(135deg, #7B85F5 0%, #5E6AD2 100%)` ·
  glow `0 0 24px rgba(123,133,245,.35)`
- **Semantic:** ok `#4EC9B0` (teal-green) · warn `#E0AF68` ·
  err `#F76E8E` · warn-msg-tint `#D8C39A` ·
  err-msg-tint `#F2A5B3` · ok-soft `rgba(78,201,176,.18)` ·
  warn-soft `rgba(224,175,104,.18)` ·
  err-soft `rgba(247,118,142,.20)`
- **Type:** `IBM Plex Sans` (UI) + `JetBrains Mono` (data/code);
  sizes 10–14px. `font-variant-numeric: tabular-nums` is set globally
  on `<body>` so all mono text aligns.
- **Radius:** 6 / 8 / 10 / 14 (sm / md / lg / xl)
- **Shadow:** sm `0 1px 2px rgba(0,0,0,.5)` ·
  md `0 4px 16px rgba(0,0,0,.4)` ·
  lg `0 12px 36px rgba(0,0,0,.5)` ·
  panel `-16px 0 32px rgba(0,0,0,.45)` ·
  menu `0 8px 24px rgba(0,0,0,.5)` ·
  glow `0 0 0 3px var(--accent-soft)`

### Light palette

- **Surfaces:** app `#FAFAFB` · panel `#FFFFFF` · chrome `#FFFFFF` ·
  elevated `#FFFFFF` · control `#FFFFFF` · terminal `#F6F6F9` ·
  hover `#F0F0F4` · hover-strong `#E6E6EC` · selected-row `#EAF0FF` ·
  active-nav `#EEF1FF` · log-hover `#F2F2F6`
- **Borders:** default `#E5E5EC` · strong `#D5D5E0` ·
  control `#DDDDD4` · menu `#D0D0DA` · hover `#A8A8B6` ·
  row `#ECECF1` · ring `rgba(94,106,210,.18)`
- **Text:** primary `#0E0E1A` · body `#2A2A38` ·
  secondary `#58586C` · muted `#77778A` · faint `#A0A0B0` ·
  line-num `#B4B4BD` · log-ts `#9696A0`
- **Accent:** `#5E6AD2` · hover `#4A55C0` ·
  soft `rgba(94,106,210,.10)` ·
  gradient `linear-gradient(135deg, #5E6AD2 0%, #4A55C0 100%)`
- **Semantic:** ok `#1F8B70` · warn `#B47A0E` ·
  err `#C42E4E` · soft halos at 10–12% alpha
- **Shadow:** sm `0 1px 2px rgba(20,20,50,.04)` ·
  md `0 4px 16px rgba(20,20,50,.06)` ·
  lg `0 12px 36px rgba(20,20,50,.10)`

In light mode the sidebar and detail panel deliberately keep the
dark palette via `data-surface="panel"`. The white work area
(table, top bar, status bar) stays the brightest thing in the
window, while the inspector is a deliberate island of dark chrome —
the contrast is the affordance, not a bug.

## Assets

No images. Icons are unicode glyphs (`◉ ▲ ≡ ⦿ ▸ ↻ ⇄ ⇥ ☰ ⚿ ▢ ◫ ⌕ ▼ ✓ ✎ ⏸ ▶ ●`) — swap for an icon set (e.g. Lucide) if preferred, keeping 11–16px sizes. Fonts must be bundled locally for offline desktop use.

## Files

- `K8s Monitor.dc.html` — the full interactive prototype (open in a
  browser). The token set here mirrors `src/styles/tokens.css`; if
  the prototype looks different from the live app, the token table
  is the place to reconcile.
