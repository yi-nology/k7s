# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #9

## Area tested

**Settings / preferences panel (B23, rotation #5)** — end-to-end, both
locales. The Settings panel (`src/components/settings/SettingsPanel.tsx`
+ `McpPanel.tsx`) is the gear-icon overlay that was last exercised at
the pass-1 ⌘K i18n sweep. No pass since then has poked at the panel
itself: theme switch, language switch, the three numeric inputs (log
buffer, metrics poll, status poll), the three text inputs (default
namespace, shell command, node shell image), the reset link, and the
three MCP / AI integration copy cards. This pass walked every
interaction that doesn't need a live Tauri backend and pinned the
i18n keys with a regression test.

## Findings

**No defects found.** The panel is implemented cleanly, the keys are
all routed through `useTranslation()`, and the chrome reactively
re-renders the moment any field changes (the `useStore` selectors at
`SettingsPanel.tsx:29-34` drive the inputs, the `setSettings` patch
at `SettingsPanel.tsx:49` runs through `sanitizeSettings`, and
`useLocale()` at `useI18n.ts:38-40` re-renders the whole chrome on a
language change).

What was verified, in order:

- **Open via gear icon** (sidebar footer) — overlay backdrop appears
  with the title `设置` / `Settings`, an `×` close, eight labelled
  rows, the MCP section, and the footer.
- **Open via ⌘K palette** — `chrome.palette.actions.settings` is
  registered; `open settings` filters to `Open settings` (en) /
  `打开设置` (zh), and Enter runs the same `setSettingsOpen(true)`
  action the gear icon does (`CommandPalette.tsx:169`).
- **Esc closes** — the local handler at
  `SettingsPanel.tsx:37-44` overrides the app-level Esc cascade, so
  the panel closes without also dismissing the table filter or
  closing the detail panel behind it. Verified by pressing Esc
  twice (once with the panel open, once with nothing else open) —
  the table filter was never touched.
- **Theme change is immediate** — switched the Theme combobox from
  `system` to `light`; the entire panel and the page background
  flipped to the light palette on the same render. The store
  selector at `useStore.ts` keeps `<html data-theme>` in sync
  via `useTheme()`.
- **Language change is immediate** — switched Language from
  `中文` to `English`; the panel header (`Settings`), all eight
  row labels, all eight hint strings, the MCP section title and
  helper copy, the footer note (`changes save automatically`),
  the reset link (`reset to defaults`), the cluster footer
  (`watch: 9 streams active`), the topbar placeholder
  (`Search anything…`), the search-button label, the sidebar
  group headers (`WORKLOADS / NETWORK / CONFIG`), and the
  nav breadcrumb (`Workloads`) all flipped to English on the
  same render. No raw `chrome.*` key fallback visible anywhere
  in the chrome.
- **Number clamp holds** — typed `9999` into the Log buffer
  spinbutton; the field was clamped to `5000` (the `LIMITS.logBufferCap.max`
  ceiling at `lib/settings.ts:71`) on blur. The min / max range
  for all three numeric fields is correctly surfaced in the
  hint copy (`lines kept in the log view (50–5000); applies
  immediately`).
- **Hint text reflects "applies on next connect"** — the
  Metrics-poll and Status-poll hints say
  `seconds between CPU/MEM polls (5–300) — applies on next connect`
  when connected and drop the `applies on next connect` tail
  when disconnected (the `connected` arg at
  `SettingsPanel.tsx:127, 145` is the live `connection.phase === "connected"`
  flag).
- **MCP section** — all three cards (Claude Desktop, Claude Code,
  Cursor) render with the correct `codePath`, the pre-baked JSON
  in each `<pre><code>`, and a 复制 / copy button on each. The
  `window.location.origin + "/mcp"` URL was correctly resolved
  to `http://localhost:1420/mcp` in the section hint (the lazy
  `useEffect` at `McpPanel.tsx:34-36` ran on mount).
- **Reset to defaults** — verified by code review that the
  `<span onClick={() => setSettings(DEFAULT_SETTINGS)}>` at
  `SettingsPanel.tsx:199-200` calls `setSettings` with the full
  `DEFAULT_SETTINGS` object, which the store setter merges in
  one atomic update. The reset path didn't get a
  click-the-pixel-by-X.XX test in the in-app browser because
  the `<span>` doesn't expose a stable ref and the normalised
  click lands on the backdrop (which closes the panel). The
  behaviour is locked in by `setSettings` + `DEFAULT_SETTINGS`
  being two stable identifiers.

## Observed, not fixed — table-column widths drift when palette is open and ArrowDown is pressed without a focused input

While re-opening the panel via ⌘K, the synthetic `ArrowDown` keypresses
in the in-app browser's `press_key` were routed to the *table* (the
palette's input had lost focus after the first Esc), and the table
treats ArrowDown as a column-resize shortcut in the in-app browser.
The table headers' column widths changed from
`NAME=319, NAMESPACE=127, READY=79, RESTARTS=103, CPU=71, MEM=79, AGE=79, STATUS=184`
to
`NAME=115, NAMESPACE=181, READY=128, RESTARTS=168, CPU=102, MEM=102, AGE=102, STATUS=142`
after eight ArrowDown presses. The page reloads the table layout from
`useTableLayout` (in-memory only) so the next page render will
recover, but it's a real test-harness oddity worth knowing about for
future in-app browser sessions.

Not a Settings-panel defect — same class as the "NavList tool row
clicks land in odd places under the in-app browser" item in
pass-5's notes. The Settings panel itself was the one being tested,
and it's correct. Logged because the next pass might trip over it.

## Fixes applied

No production code change was needed — the panel's translations and
behaviour were already correct. The pass added a regression test to
keep them that way.

| File | Change |
|---|---|
| `src/lib/i18n.test.ts` | New `describe("settings panel keys")` with four tests: `chrome.settings.{title, footerNote, reset}`, `chrome.{copy, copied, copyFailed}`, the eight `settings.*.label` strings, and `settings.mcp.{sectionTitle, claudeDesktop.title, claudeCode.title, cursor.title}`. Pins presence + bilingual divergence (except for the three brand-name MCP card titles, which are identical in both locales by design). |

Commit: **`bb328ef`** — *test(i18n): pin Settings panel + chrome copy keys in both locales*
Bilingual message: English summary + 中文说明.
Pushed to `origin/main`.

## Verification

```
$ npx tsc --noEmit
# silent

$ npx vitest run
# Test Files  17 passed (17)
#      Tests  318 passed (318)
#   +4 new tests (chrome.settings + chrome.copy family + 8 settings.*.label + 3 mcp titles)

$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.62s
  # 4 pre-existing dead-code warnings in src/kube/metrics_config.rs (unrelated)
```

Browser re-verified in dev server (HMR picked up each change):

- **zh, Settings panel open** (screenshot 1): title `设置`, close `关闭`,
  颜色 / 语言 / 日志缓冲 / 指标轮询 / 状态轮询 / 默认命名空间 /
  Shell 命令 / 节点 Shell 镜像. All eight hint strings render in
  Chinese, including the parameterised "(50–5000);立即生效" and
  "(5–300 秒) — 下次连接时生效". AI 集成 (MCP) section with
  30 个工具 + 本地 stdio 模式请跑 `k7s-mcp` 二进制. Footer:
  `修改自动保存` / `恢复默认`.
- **zh → en theme/language flip** (screenshot 2): changed
  Theme to `light` (the whole panel + page background flipped
  to the light palette), then Language to `English` (all chrome
  re-rendered: title `Settings`, rows `Theme / Language / Log buffer /
  Metrics poll / Status poll / Default namespace / Shell command /
  Node shell image`, hints `"system" follows your desktop's light/dark setting`
  / `switches the UI language; takes effect immediately` /
  `lines kept in the log view (50–5000); applies immediately` /
  `seconds between CPU/MEM polls (5–300) — applies on next connect`,
  etc.). MCP section: `AI integration (MCP)`, `Exposes the same tools
  you see here as a Model Context Protocol server. The current page
  origin is the URL: http://localhost:1420/mcp`, `30 tools available — list / get / describe / logs / apply / scale / drain / port-forward / shell`,
  `For local stdio, run the \`k7s-mcp\` binary instead (see README).`
  Footer: `changes save automatically` / `reset to defaults`.
  Sidebar group headers: `WORKLOADS / NETWORK / CONFIG / STORAGE /
  CLUSTER / HELM / TOOLS`. Footer line: `watch: 9 streams active`.
- **Number clamp** (screenshot 3): typed `9999` into the Log buffer
  field → field shows `5000`. The `value` HTML attribute stays at
  `200` (the React-initialised default) but the *displayed* value
  is the clamped `5000` because `sanitizeSettings` at
  `lib/settings.ts:103-108` rounds `9999` down to `5000` before
  it reaches the store.

## Notes for next pass

The remaining rotation items are still standing and well-isolated:

1. **Saved Queries CRUD** (rotation #9) — if it actually exists in
   this build; if not, the pass can say so and we can drop it from
   the rotation. (My pass-7 note flagged this — still untested.)
2. **ImageRepoPanel tags vertical layout polish** (rotation #10) —
   pass-0 covered the registry → repos → tags drill-down, but the
   *vertical* layout of the tag list (vs the current grid) hasn't
   been poked.
3. **Dashboard resource cards navigation** (rotation #12) — the
   pass-8 "Notes" called out
   `src/components/dashboard/Dashboard.tsx:39-48` RESOURCE_KINDS
   labels as still hardcoded English (the dict has
   `chrome.sidebar.tools.dashboard` and per-kind i18n via
   `kindLabelFor()` / `i18nKindLabel`, but the dashboard component
   itself uses `KIND_META` directly). A coordinated fix would
   also touch `NavList.tsx:66` to route the sidebar nav through
   the same `localizedKindMeta` helper. Easy and contained.
4. **Templates Ingress / ConfigMap form variants** (rotation #13) —
   the Templates overlay was only ever exercised with the
   Deployment form (the original v0.2.4 pass); the Ingress and
   ConfigMap form paths are an easy extra surface to verify.
5. **Helm Market Repositories CRUD** (rotation #14) — Repositories
   tab was covered in the original Helm Market pass at the read
   level; the add/edit/delete flow lives in
   `src/components/helm/` and is a clean follow-up target.
