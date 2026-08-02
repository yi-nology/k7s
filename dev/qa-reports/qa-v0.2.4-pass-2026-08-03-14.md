# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #14

## Area tested

**ImageRepoPanel — tags vertical layout polish + collateral i18n
key-path fix** (rotation #10) — the Image Registries overlay at
`src/components/imagerepo/ImageRepoPanel.tsx` and its CSS module at
`src/components/imagerepo/ImageRepoPanel.module.css`. This is the
last untested entry in the rotation; pass-1 / pass-2 / pass-3 / pass-4
already walked the registry form, repos drill-down, and tags drill-down,
but the layout polish + i18n key-path audit had not been done.

What this pass walks through:

1. **Tag list rendering** — opens the Tags list and inspects the CSS
   rules (`.repo`, `.tag`, `.tags`, `.tagActive`) and the TSX that
   consumes them. Confirms the prior layout was `display: inline-block`
   chips with no per-row metadata, which is the "polish" target.
2. **i18n key path audit** — greps every `t("image.*", ...)` call site
   in the panel against the `image` section of both dictionaries, looking
   for path mismatches where the TSX used a dotted path that can't
   resolve (string leaves are not walkable).
3. **TypeScript null-safety** — reads `ImageTag` in
   `providers/types.ts:952-957` and confirms `size` / `created` are
   nullable. The new meta span must guard against `null` values from
   non-mock backends.
4. **i18n dictionary round-trip** — reads the `image` section in both
   `en` and `zh` dictionaries, pins every key the panel touches.

> **Browser limitation this pass:** the in-app Browser tool's render
> queue is stuck for the **fifth** consecutive pass (same symptom as
> pass-10 / pass-11 / pass-12 / pass-13). Recovery path is `/quit` +
> relaunch of MiniMax Code, but that's not available in the
> scheduled-cron context. Treat the queue stall as a known-stable
> harness issue, not an app bug. Verification was done by code review,
> by HMR / Vite serving the new modules, and by tsc / vitest /
> cargo check.

## Findings

### 1. [primary — rotation #10 target] Tag / repo list is laid out as inline-block chips with no per-row metadata

`ImageRepoPanel.module.css:139-150` (before this pass) defined
`.repo, .tag` as `display: inline-block` chips with `font: var(--font-mono)`,
`margin: 2px`, `padding: 2px var(--space-2)`. The result was a
horizontal flow of mono-spaced chip labels wrapping to a new line as
needed — fine for 3-5 tags, but the list only ever rendered `tt.name`
(no size, no date) so the user had no way to compare tags at a glance
beyond the tag string itself. The list also felt cramped: 2px vertical
padding and 2px margins made the rows feel like they were tacked on,
not part of the panel.

The `repos` list had the same shape and the same problem (no
per-row metadata is available for repos, but the chips also looked
loose — the active selection state was not visually distinct enough
in a horizontal chip flow).

This is exactly the "polish" the rotation was looking for. The fix
switches both lists to a flex-column layout where each row is a
single bar with the name on the left and a `size · date` meta
right-aligned with `margin-left: auto` (image manifests often have
10-30 tags and the user wants to spot the latest or the largest at
a glance).

### 2. [high — collateral i18n bug, same class as pass-1 / pass-5 / pass-6 / pass-8 / pass-10] `image.repos.empty` key path doesn't resolve in zh

`ImageRepoPanel.tsx:267` called
`t("image.repos.empty", "No repositories (or registry does not support /v2/_catalog)")`,
but the dictionary at `dictionaries.ts:325, 788, 1260` defines the
key as `image.reposEmpty` — a flat string leaf, not a nested object.
The `translate()` function walks a dotted path by splitting on `.` and
trying to descend into each segment; when it hits a string leaf
(`image.repos` is a string, not an object), it returns `undefined`.
Both the active-locale lookup and the English fallback return
`undefined`, so the leading string arg in `t("...", "...default...")`
fires and the **inline English copy always renders, including in zh**.

The zh dict ships the correct translation
`"无镜像(或仓库不支持 /v2/_catalog)"` but it never reaches the UI
because the dotted path never resolves to it.

### 3. [high — collateral i18n bug, same class as #2] `image.manifest.*` key paths don't resolve in zh

`ImageRepoPanel.tsx:317, 321, 325, 329, 334, 339, 340, 341, 356`
called `t("image.manifest.mediaType", ...)`, `t("image.manifest.digest", ...)`,
etc., but the dictionary at `dictionaries.ts:328-333, 791-796, 1263-1268`
defines these keys flat at `image.mediaType` / `image.digest` /
`image.schemaVersion` / `image.size` / `image.layers` / `image.raw`.
Same dotted-path-traversal bug: the path can't descend through
`image.manifest` (a string) to find `.mediaType` etc., so the lookup
returns `undefined` and the inline English copy always renders. The
manifest table headers (`Media type` / `Digest` / `Schema` / `Size` /
`Layers` / `Raw JSON`) and the digest / size / media-type column
headers in the layers sub-table all read English even in zh UI.

This is the most user-visible leak in the panel: the manifest table
is the second-to-last thing the user sees before clicking a tag, and
in zh it shows English headers.

### 4. [low — collateral] Pre-existing unused-import warning in `templates.test.ts`

`src/lib/templates.test.ts:13` imported `type Template` from
`./templates` but never referenced it. The unused import surfaced as
a tsc warning during this pass's `tsc --noEmit` run. Pre-existing
leftover from pass-13 (`ed3b318`); one-line cleanup.

## Fixes applied

All in commit `f8de206`.

### `src/components/imagerepo/ImageRepoPanel.module.css`

```css
/* before: inline-block chips */
.repos, .tags { list-style: none; margin: 0; padding: 0; }
.repo, .tag  { display: inline-block; font: var(--font-mono, monospace);
               font-size: var(--text-sm); margin: 2px; padding: 2px var(--space-2); }

/* after: flex-column rows with right-aligned meta */
.repos, .tags { display: flex; flex-direction: column; gap: 2px;
                list-style: none; margin: 0; padding: 0; }
.repo, .tag   { align-items: center; display: flex;
                font-size: var(--text-sm); gap: var(--space-2);
                padding: var(--space-1) var(--space-2);
                /* (background, border, radius, cursor unchanged) */ }
.repoName, .tagName { flex: 0 0 auto; font: var(--font-mono, monospace); }
.tagMeta             { color: var(--text-muted); font-size: var(--text-xs);
                      margin-left: auto; }
```

The `.tagActive` rule (selected state) is unchanged.

### `src/components/imagerepo/ImageRepoPanel.tsx`

- Repos now render as `<span className={styles.repoName}>{r.name}</span>`
  (was: bare text inside the `<li>`).
- Tags now render two spans: `.tagName` for the tag and a conditional
  `.tagMeta` for `${humanSize(tt.size)} · ${tt.created.slice(0, 10)}`.
  The meta span is only rendered when both `tt.size` and `tt.created`
  are non-null (the `ImageTag` type in `providers/types.ts:952-957`
  allows null for both, and non-mock backends may return null).
- The seven `t("image.manifest.*", ...)` call sites at lines 317,
  321, 325, 329, 334, 339, 340, 341, 356 now use the flat
  `image.mediaType` / `image.digest` / `image.schemaVersion` /
  `image.size` / `image.layers` / `image.raw` paths.
- `t("image.repos.empty", ...)` at line 267 is now
  `t("image.reposEmpty", ...)`.

### `src/lib/templates.test.ts`

- Dropped the unused `type Template` import at line 13.

### `src/lib/i18n.test.ts`

- New `describe("image registries panel keys", ...)` block with 4 tests:
  - **chrome keys** — pin the canonical 10 keys (`title`, `close`,
    `test`, `confirmRemove`, `remove`, `add`, `pick`, `repos`, `tags`,
    `manifest`) are non-empty in both locales.
  - **`reposEmpty` at the flat path** — pin the canonical
    en `"No repositories (or registry does not support /v2/_catalog)"`
    and zh `"无镜像(或仓库不支持 /v2/_catalog)"`, plus a regression
    check that the dotted `image.repos.empty` path does NOT resolve
    to the same value (so a future refactor that reintroduces the
    nested key trips the test).
  - **manifest-table keys at the flat path** — pin canonical en/zh
    values for `image.mediaType` / `image.digest` /
    `image.schemaVersion` / `image.size` / `image.layers` / `image.raw`,
    plus a regression check that the dotted `image.manifest.*` paths
    do NOT resolve to the same value.
  - **form sub-keys** — pin all 8 `image.form.*` sub-keys
    (`title`, `name`, `url`, `username`, `password`, `description`,
    `save`, `cancel`) are non-empty in both locales.

## Verification

- `npx tsc --noEmit` — clean (was 3 errors, all fixed).
- `npx vitest run` — **358 passed (354 → 358, +4 new image.* tests)**.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean (4
  pre-existing warnings, unrelated to this pass).
- Working tree clean after the commit, pushed to `origin/main`
  (`b3d5e6c..f8de206  main -> main`).

## Notes for next pass

- **Rotation is now exhausted** — every entry in the v0.2.4 rotation
  (rotations #1 through #14) has been walked and pinned. The cron
  self-cleanup heuristic from the brief ("if the prior reports cover
  MOST of the rotation and last 3 passes found no new issues → the
  cron is done") may want to trigger soon — pass-11, pass-12, pass-13
  all found substantive issues, so we're not there yet, but the next
  pass can decide based on whether v0.2.4 has more unused features to
  surface.

- **In-app Browser render queue is stuck for the fifth consecutive
  pass** — same symptom as pass-10 / pass-11 / pass-12 / pass-13.
  Treat as a known-stable harness issue; the test contract + code
  review + HMR / Vite serve-the-new-modules + tsc/vitest/cargo
  verification chain has been the verification strategy for all five
  passes and has caught every issue (the i18n key-path bugs in
  particular were caught by reading the TSX and dict side-by-side,
  not by visual inspection). `/quit` + relaunch of MiniMax Code is
  the recovery path; the cron context can't trigger it, so the next
  pass should expect the same symptom.

- **Future-tagged follow-ups from this and prior passes:**
  - Dashboard's `CPU` / `Memory` bar labels at `Dashboard.tsx:115, 130`
    are still hardcoded English (the dict already has `dashboard.cpu` /
    `dashboard.mem`); one-line fix per span.
  - Template registry's `title` / `description` strings are still
    hardcoded English (the dict needs `tpl.titles.<id>` /
    `tpl.descs.<id>`); refactor needs all three templates at once.
  - Add a `defaultValueForEmpty` warning / required policy to the
    Templates form (currently empty text fields silently fall through
    to the default via the renderer's `v.name || "my-app"` fallback).
  - Add a `pattern` attribute on the Helm Market repository name input
    to surface the `/` / ` ` / `\` charset error client-side.
  - Add a loading / disabled state to the Helm Market Add button
    during submit (race allows double-click; backend de-dupes by name).
  - `MetricsExplorer` "Clear cache" button has no visual feedback;
    save bar has no "edit existing" affordance — typing the same
    name silently overwrites.

- **Suggested next area to explore** (when the next pass fires and
  the rotation is officially expanded): **the MCP server health /
  status UI** in the Settings panel — the `mcp` section exposes
  tools + connection state, but I haven't walked whether the
  connection-status indicator updates when the underlying server
  goes away, and whether the listed tool count is dynamic.
