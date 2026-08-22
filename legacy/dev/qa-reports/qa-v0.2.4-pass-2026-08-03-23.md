# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #23

## Area tested

**Settings panel — full sweep (rotation follow-up, round 9).** The v0.2.4
rotation is exhausted (pass-22's note); this pass picks up a fresh
follow-up area that pass-22 specifically listed as a suggestion:
*Settings theme picker — the theme switcher in Settings persists; verify
localStorage round-trips through a reload.* Extended scope to the full
panel: theme, language, three numeric inputs, three text inputs, reset,
MCP section.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **14th** consecutive pass (same symptom as
> pass-10 through pass-22). Verification was by code review, by HMR /
> Vite serving the updated modules (curl'd the updated McpPanel bundle
> and confirmed the new `t("settings.mcp.claudeCode.configPath")` is on
> the wire), and by tsc / vitest / cargo check.

## Findings

### 1. [medium] McpPanel Claude Code `configPath` is hardcoded English (zh leak)

`src/components/settings/McpPanel.tsx:113` rendered the Claude Code
card's `configPath` as a raw English string:

```tsx
configPath="~/.claude.json  (or .mcp.json in a project)"
```

The other two cards in the same panel (claudeDesktop at line 103,
cursor at line 125) routed theirs through
`t("settings.mcp.<card>.configPath")`. The zh user saw
`"~/.claude.json  (or .mcp.json in a project)"` rendered verbatim
while the other two cards showed their translated `configPath` values.
The `Dictionary` type at `dictionaries.ts:139-143` confirmed the gap:
`claudeCode` only had `title` / `hint` / `cliHint`, while
`claudeDesktop` and `cursor` had `configPath` too. A previous refactor
that added the two cards but forgot the third was the most likely
author.

This is the same i18n leak class the rotation has been closing since
pass-1 (`chrome.palette.actions.*`) — the dict has the right key for
two of the three cards, the third has a JSX literal that survives into
zh.

### 2. [low] zh theme option labels use raw colour names instead of theme names

`src/lib/i18n/dictionaries.ts:1204-1206` shipped:

```ts
theme: {
  label: "颜色",
  hint: "「跟随系统」会跟随你系统的明暗设置",
  system: "跟随系统",
  dark: "黑色",     // literal "black" — reads as a colour, not a theme
  light: "白色",    // literal "white" — same
},
```

The English dict has bare theme names: `"system" / "dark" / "light"`.
The Chinese dict translated the first and last correctly, but
translated `dark` → `黑色` ("black") and `light` → `白色` ("white") —
which are the *colour* words, not the *theme* words. The canonical
Chinese pair for dark/light UI modes is `深色` / `浅色` (used by
macOS, Windows, GNOME, and most native Chinese apps).

The en and zh theme hints are correct: en says `"\"system\" follows
your desktop's light/dark setting"`; zh says
`"「跟随系统」会跟随你系统的明暗设置"`. The hint is fine; the option
labels are the cosmetic regression.

### 3. [low / test gap] `cacheTheme` / `cachedTheme` had no round-trip test

`cacheLocale` / `cachedLocale` had a 5-test round-trip suite in
`src/lib/i18n.test.ts:1190-1219` (the `installStorageStub` /
`beforeEach` / `afterEach` pattern). The equivalent pair for theme
(`cacheTheme` / `cachedTheme` in `src/lib/theme.ts:171-186`) had *no*
test coverage. The pair is the persistence contract:

- The boot script in `index.html:23` reads
  `localStorage.getItem("k7s.theme")` synchronously *before* the
  bundle loads — the paint-time cache that prevents a flash of the
  wrong palette.
- The store's `cachedTheme()` in `store.ts:400` re-reads the same key
  on boot, so the first `useStore` read has the right value.
- `useTheme`'s effect at `useTheme.ts:81-83` calls
  `cacheTheme(theme)` whenever the Settings panel changes the theme.

A refactor that renames the storage key (e.g. `k7s.theme` →
`k7s.theme.v2`) or accidentally pushes to a different key would compile
cleanly and *only* break the inline boot script + the store's boot
read — i.e. the failure would be a flash of the wrong palette on
every reload, caught only by manual QA.

## Fixes applied

All in commit `700c9fd`.

### `src/components/settings/McpPanel.tsx`

- The Claude Code card's `configPath` prop at line 113 changes from
  `configPath="~/.claude.json  (or .mcp.json in a project)"` to
  `configPath={t("settings.mcp.claudeCode.configPath")}`, matching the
  shape of the other two cards at lines 103 and 125. A doc comment in
  the new i18n test (below) records the rationale and the leak class.

### `src/lib/i18n/dictionaries.ts`

- **Type** — `Dictionary.settings.mcp.claudeCode` (line 139) gains
  `configPath: string`, matching the shape of `claudeDesktop` and
  `cursor`.
- **en dict** — `claudeCode` (line 712) gains
  `configPath: "~/.claude.json  (or .mcp.json in a project)"` — the
  same string that was hardcoded in the JSX. Pinning the literal
  value in the dict (and pinning it again in the i18n test) means a
  future string edit happens in one place, not two.
- **zh dict** — `claudeCode` (line 1256) gains
  `configPath: "~/.claude.json(或项目里的 .mcp.json)"`. Same shape as
  the existing `cursor.configPath` zh
  (`"~/.cursor/mcp.json(或项目里的 .cursor/mcp.json)"`).
- **zh theme** — `theme.dark` `"黑色"` → `"深色"`,
  `theme.light` `"白色"` → `"浅色"`. `system` already correct.

### `src/lib/theme.test.ts`

- **New imports** — `afterEach, beforeEach` from `vitest`, and
  `cacheTheme, cachedTheme` from `./theme`.
- **New describe block** `cacheTheme / cachedTheme` with **5 new
  tests**:
  - **`round-trips a known theme`** — `cacheTheme("dark")` /
    `cachedTheme()` returns `"dark"`; same for `"light"`.
  - **`round-trips 'system' as 'system', not as the OS resolution`** —
    pins the "cache holds the *choice*, not the resolution" contract;
    on a dark desktop, the cache must say `"system"`, not `"dark"`,
    otherwise the OS flip at sunset is silently lost on the next
    launch.
  - **`returns 'system' when nothing has been cached`** — empty cache
    falls through to the default.
  - **`treats an unrecognised cached value as 'system'`** — same rule
    as `asTheme`'s "anything else → 'system'" fallback.
  - **`uses the same storage key the boot script in index.html
    reads`** — the literal string `"k7s.theme"` is the contract
    between the inline boot script and the bundle; the test pins it
    directly so a rename trips immediately.

The block uses the same in-memory `localStorage` stub pattern as
`i18n.test.ts`'s `installStorageStub`, with `beforeEach` / `afterEach`
hooks that install and remove the stub so a neighbouring test file
that depends on the absence of `localStorage` isn't tripped.

### `src/lib/i18n.test.ts`

- **New test** `ships all three MCP card configPath values in both
  locales` (pass-23 finding 1) — iterates the three card keys, pins
  presence in both locales, and pins the canonical en
  `"~/.claude.json  (or .mcp.json in a project)"` so a refactor that
  drifts the string is flagged.
- **New test** `uses 深色/浅色 for the theme option labels in zh, not
  黑色/白色` (pass-23 finding 2) — pins the canonical zh values
  `深色` / `浅色` and asserts they are *not* the previous raw-colour
  values, so a re-translation can't silently drift back.

Total: 396 tests passed (389 → 396, +7 new: 5 theme + 2 i18n).

## Verification

- `npx tsc --noEmit` — **clean** (the new `configPath: string` in the
  type was matched by the new en / zh dict entries; the McpPanel prop
  shape is unchanged because it already had a `configPath: string`
  prop type, so no follow-on type errors)
- `npx vitest run` — **396 passed (389 → 396, +7 new)** across 18
  test files. The 5 new theme tests live in
  `src/lib/theme.test.ts` (17 → 22), the 2 new i18n tests live in
  `src/lib/i18n.test.ts` (85 → 87).
- `cargo check --manifest-path src-tauri/Cargo.toml` — **clean** (4
  pre-existing dead-code warnings, unchanged from pass-22)

Commit `700c9fd` pushed to `origin/main`.

## Notes for next pass

The v0.2.4 rotation is exhausted and 9 rounds of post-rotation
follow-up are done (passes 15–23). Still on the queue from prior
reports:

- pass-15: MCP panel card polish (observation rather than a
  live-health fix — the three cards now show their localized
  `configPath`s correctly; the cosmetic concern was that
  `claudeDesktop` / `claudeCode` / `cursor` all produce the same
  `mcpServers: { "k7s-local": { url } }` JSON shape, just with a
  different wrapper name — a future pass could vary the wrapper name
  to make the three cards visually distinct at a glance)
- pass-16: resource table column resize / reorder UX (no
  resize/reorder exists; out of scope for these targeted passes)
- pass-14/17: `title="Grafana"` brand string (by-design, the iframe's
  accessible name — not a bug, just an i18n observation)

Untested but not yet picked up:

- **CronJob detail panel tabs** — the CronJob detail has a schedule
  preview + last-run history; if any kind has a custom tab strip it
  should be CronJob.
- **Resource Yaml tab edit-mode toggle** — every detail panel has a
  Yaml tab; check whether edit-mode round-trips cleanly.
- **Multi-namespace / cross-namespace bulk actions** — pass-18 fixed
  scale/forward for one namespace; check what happens when the
  selection spans namespaces.
- **Settings theme picker mid-session resolution** — switching from
  "dark" to "system" while the OS is light should immediately flip to
  light; this is a behavioural test on `useTheme`'s
  `startThemeSync` subscription.

The cron should keep running; the rotation is not yet complete and
the follow-up queue is still productive.
