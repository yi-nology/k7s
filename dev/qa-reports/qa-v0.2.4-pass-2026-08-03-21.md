# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #21

## Area tested

**Sidebar chrome polish — pass-17 follow-up, round 7.** The
v0.2.4 main rotation closed every entry (#1 through #14) and
pass-15 / 16 / 17 / 18 / 19 / 20 audited residual i18n leaks and
form-polish defects. Pass-17 explicitly flagged two sidebar
follow-ups in its notes-for-next-pass: the **cluster switcher
`connected · v1.28.0` mid-dot version field UX** (truncation
behaviour for long version strings) and the **WatchFooter
pulsing dot + count** (the dot pulses constantly regardless of
whether the cluster is actually connected). Both are addressed
in this pass.

1. **Cluster switcher status line overflow** —
   `src/components/sidebar/ClusterSwitcher.tsx:84-87`,
   pre-fix. The `statusText` (e.g. `connected · v1.28.0`) was
   a raw text node inside a flex container with no `min-width:
   0`, no `overflow: hidden`, no `text-overflow: ellipsis`. On a
   real cluster with a long version string (e.g.
   `v1.30.0-alpha.1+abcdef123456`) the text expanded past the
   flex container and pushed the `▼` chevron off the right
   edge of the switcher button. The mock provider's `v1.31`
   is short enough to fit, so the defect doesn't show in the
   in-app visual loop, but any real Kubernetes cluster version
   trips it.

2. **Cluster name overflow has no hover affordance** — even
   though `.clusterName` already had `text-overflow: ellipsis`
   in CSS, the `<div>` had no `title` attribute, so once a
   long cluster name was truncated the user had no way to
   read the full thing on hover.

3. **WatchFooter dot pulses unconditionally** —
   `src/components/sidebar/WatchFooter.tsx:18`, pre-fix. The
   dot was a single `<span className={styles.footerDot} />`
   with no state awareness — the CSS pinned it to `--accent`
   and the `livePulse 2s ease-in-out infinite` animation
   ran regardless of `connection.phase`. The result: a
   cluster-disconnected session still showed a green pulsing
   dot in the sidebar footer, which read as "everything's
   fine" even when the top-of-sidebar cluster switcher was
   red. The chrome's two status indicators (top + bottom) were
   contradicting each other.

4. **`chrome.sidebar.watch(0)` had no test pin** — the
   `chrome.sidebar.watch` function is called with the live
   `watchCount`, which drops to 0 during disconnect (B11
   lifecycle). The existing i18n test only pinned `N=3`, so a
   refactor that broke the N=0 path would compile and the
   chrome would render the English fallback in zh.

> **Browser limitation this pass:** the in-app Browser render
> queue remains stuck for the **12th** consecutive pass (same
> symptom as pass-10 through pass-20). Verification was by
> code review, HMR / Vite serving the new modules (curl'd
> `ClusterSwitcher.tsx` / `WatchFooter.tsx` / `Sidebar.module.css`
> and confirmed the served bundles reference the new
> `styles.statusText` / `styles.footerDotPulsing` classes
> with the right CSS-module hashes), and tsc / vitest /
> cargo check.

## Findings

### 1. [high] Cluster switcher statusText overflows on long version strings

`src/components/sidebar/ClusterSwitcher.tsx:84-87` (before
this pass). The status line is a flex row with two children:

- a fixed-size `<span className={styles.dot} />` (6×6)
- a raw text node containing `statusText`

The raw text node has implicit `min-width: auto` — which
equals the width of the text content — so it cannot shrink
past its intrinsic width. The `switcherText` parent is
`min-width: 0; flex: 1;` so it can shrink, but the text
inside it doesn't follow. Result: any version string wider
than the available space pushes the `▼` chevron off the
right edge of the `switcherButton`.

The mock provider ships `version: "v1.31"` so the demo
doesn't trip it, but `kubectl version` on a real
Kubernetes cluster returns strings like
`v1.30.0-alpha.1+abcdef123456` or
`v1.29.4-eks-12345678` (EKS), and both are wider than the
default 8px-per-char × 15-char chevron + badge + padding
budget.

The fix follows the same pattern `PropertiesTab.tsx:125`
already uses for `title={\`${kv.key}=${kv.value}\`}` chips
and `NavList.tsx:116` uses for the tools nav items: wrap
the long text in a span with `min-width: 0; flex: 1;
white-space: nowrap; overflow: hidden; text-overflow:
ellipsis;`, and surface the full text via `title=...` for
hover-to-see. The dot keeps `flex: none` so it doesn't
collapse. A 2-line code comment on the JSX records the
rationale so a future refactor doesn't "simplify" the
`{statusText}` back to a raw text node.

### 2. [medium] Cluster name truncation has no hover affordance

`src/components/sidebar/ClusterSwitcher.tsx:83` (before
this pass). The `<div className={styles.clusterName}>{name}</div>`
already had `text-overflow: ellipsis` in CSS, but no
`title` attribute. A long cluster name (`arn:aws:eks:us-east-1:123456789012:cluster/prod-use1`)
would truncate and the user had to open the dropdown menu
to see the full name.

The fix is a one-line addition: `title={name}` on the
clusterName div. The hover-to-see-full-text pattern is
already in the rest of the chrome (`NavList.tsx:204,
219` for group / kind rows; `PropertiesTab.tsx:125` for
chip values), so this is bringing the cluster switcher in
line with the existing pattern.

### 3. [high] WatchFooter dot is decoupled from the connection lifecycle

`src/components/sidebar/WatchFooter.tsx:18` and
`src/components/sidebar/Sidebar.module.css:412-424`
(before this pass). The pre-fix dot was a single
`<span className={styles.footerDot} />` with:

- `background: var(--accent)` — hardcoded to the
  connected-state accent
- `animation: livePulse 2s ease-in-out infinite` — the
  pulse ran unconditionally

This meant the sidebar footer always said "we are alive"
regardless of whether the cluster was actually reachable.
In a session where the top-of-sidebar `ClusterSwitcher`
was red (`--status-err`) and the footer dot was still
green and pulsing, the chrome read as inconsistent. A new
user would reasonably ask "is the cluster up or not?" and
the answer was "yes, no, yes, no" depending on which
element they looked at.

The fix:

- `WatchFooter` now subscribes to
  `connection.phase` (alongside the existing
  `watchCount`).
- A small inline `dotColor` derivation picks the right
  status colour from the same tokens the cluster switcher
  and status bar use:
  - `connected` → `var(--accent)` (green)
  - `connecting` → `var(--status-warn)` (amber)
  - `error` → `var(--status-err)` (red)
  - `idle` (initial state) → `var(--text-faint)` (grey)
- A boolean `pulse = phase === "connected"` gates the
  animation via a new `.footerDotPulsing` CSS class.
- The pre-fix `.footerDot` class drops its hardcoded
  `background: var(--accent)` (now set inline) and
  `animation: livePulse …` (now on `.footerDotPulsing`).

The visual contract: a pulsing dot = live, a static dot =
not connected. The eye learns it in one session, and the
top + bottom of the sidebar tell the same story.

The `watchCount` semantics is unchanged — the text
"watch: N streams active" still reports the backend's
stream count verbatim. The dot is a connection indicator,
not a count indicator; the count has its own column.

### 4. [medium] `chrome.sidebar.watch(0)` not pinned by i18n test

`src/lib/i18n.test.ts:88-91` (before this pass). The
existing test pinned the `N=3` case but not the `N=0`
case. The `watchCount` is reported by the backend
via `provider.onWatchStatus(setWatchCount)` (B11
lifecycle) and drops to 0 during a disconnect. The
mock provider's bootstrap can leave the count at 0
for the first ~100ms before any watcher attaches, and
in real use the count is 0 the moment the cluster goes
unreachable. A refactor that dropped the function
shape (e.g. replaced `(n) => string` with a string
leaf) would compile cleanly and the `translate()`
helper would fall back to the second arg, so the
zh chrome would render the inline English copy. Pin
the `N=0` case in both locales.

## Fixes applied

All in commit `19dc3e1`.

### `src/components/sidebar/ClusterSwitcher.tsx`

**Status line** (lines 83-89, after this pass):

```tsx
<div className={styles.clusterName} title={name}>{name}</div>
<div className={styles.statusLine}>
  <span className={styles.dot} style={{ background: dotColor }} />
  {/* statusText can be long on real clusters (e.g. "connected · v1.30.0-alpha.1+abcdef").
      Wrapped in a span so the flex child can shrink and ellipsis; the
      full text is surfaced on hover so the version isn't lost. */}
  <span className={styles.statusText} title={statusText}>{statusText}</span>
</div>
```

Two changes:

- The cluster name div gains `title={name}` so a
  truncated name can be read on hover.
- The statusText is wrapped in
  `<span className={styles.statusText} title={statusText}>`
  to enable flex shrinking + ellipsis on the CSS side
  and full-text-on-hover on the JSX side.

### `src/components/sidebar/Sidebar.module.css`

**New `.statusText` class** (after line 141, after this pass):

```css
/* statusText can be "connected · v1.30.0-alpha.1+abcdef" on real clusters — the
   flex child needs min-width: 0 (the default `auto` won't shrink past the text's
   intrinsic width) + ellipsis so a long version doesn't push the chevron off the
   button. The hover-to-see-full-text affordance is on the JSX side. */
.statusText {
  min-width: 0;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

**Refactored `.footerDot` class** (lines 425-437, after
this pass):

- Pre-fix `background: var(--accent)` is dropped (now set
  inline by WatchFooter based on connection.phase).
- Pre-fix `animation: livePulse 2s ease-in-out infinite`
  is moved to a new `.footerDotPulsing` class.
- The halo + glow `box-shadow` stays on `.footerDot` —
  only the connected-state dot earns the "live" treatment
  in practice, and the glow is a connected-state-only
  visual cue.

```css
.footerDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
  /* Colour is set inline by WatchFooter based on the connection phase
     (accent / warn / err). Halo + outer glow stay tied to accent because
     only the connected-state dot earns the "live" treatment — the eye
     learns that pulsing = live, static = not connected. */
  box-shadow:
    0 0 0 3px var(--accent-softer),
    0 0 12px var(--accent-soft);
}
/* Only the connected dot animates — see WatchFooter.tsx v2 note. */
.footerDotPulsing {
  animation: livePulse 2s ease-in-out infinite;
}
```

### `src/components/sidebar/WatchFooter.tsx`

**Doc block** (lines 1-13, after this pass) — the v2 note
records the rationale for the state-aware dot so a future
refactor doesn't "simplify" the conditional pulse away:

> v2 — the dot is now state-aware. It pulses the
> livePulse animation only when the cluster is connected
> (the "app is alive" signal); when idle / connecting /
> error it sits static in the appropriate status colour.
> Pre-fix the dot animated unconditionally regardless of
> connection state, which read as "everything's fine"
> even when the cluster was unreachable.

**Component** (lines 18-45, after this pass):

```tsx
export function WatchFooter() {
  const watchCount = useStore((s) => s.watchCount);
  const phase = useStore((s) => s.connection.phase);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const { t } = useTranslation();

  // The dot's visual state mirrors the connection phase (same colour tokens
  // the cluster switcher and status bar use). The `pulsing` modifier is
  // only applied when the cluster is connected — the eye learns that
  // "pulsing = live"; a static dot reads as "not connected".
  const dotColor =
    phase === "connected"
      ? "var(--accent)"
      : phase === "connecting"
        ? "var(--status-warn)"
        : phase === "error"
          ? "var(--status-err)"
          : "var(--text-faint)";
  const pulse = phase === "connected";

  return (
    <div className={styles.footer}>
      <span
        className={`${styles.footerDot} ${pulse ? styles.footerDotPulsing : ""}`}
        style={{ background: dotColor }}
      />
      <span className={styles.footerText}>{t("chrome.sidebar.watch", watchCount)}</span>
      ...
    </div>
  );
}
```

### `src/lib/i18n.test.ts`

**New test** (after the existing
`chrome.sidebar.watch(3)` test):

```ts
/** The watch count drops to 0 during disconnect (B11 lifecycle). The text
 *  must render as a coherent sentence in both locales — "0 streams active"
 *  in EN and "0 路活跃" in ZH, not the English fallback. WatchFooter now
 *  reads the connection.phase separately to drive the dot state, but the
 *  text itself still shows the count verbatim. */
it("renders chrome.sidebar.watch(0) coherently in both locales", () => {
  expect(translate("en", "chrome.sidebar.watch", 0)).toBe("watch: 0 streams active");
  expect(translate("zh", "chrome.sidebar.watch", 0)).toBe("监听: 0 路活跃");
});
```

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **387 passed (386 → 387, +1 new)**.
  The new `chrome.sidebar.watch(0)` test pins the
  disconnect-time case in both locales.
- `cargo check --manifest-path src-tauri/Cargo.toml` —
  clean (4 pre-existing warnings, unrelated to this pass;
  same as pass-15 / 16 / 17 / 18 / 19 / 20).
- Vite HMR confirmed serving the updated
  `ClusterSwitcher.tsx` (the served bundle references
  `styles.statusText` and the `title: statusText`
  attribute on the new span), the updated
  `WatchFooter.tsx` (served bundle references
  `styles.footerDotPulsing` and the new
  `style: { background: dotColor }` inline rule), and
  the updated `Sidebar.module.css` (served bundle has
  the new `._statusText_1m18t_146` and
  `._footerDotPulsing_1m18t_437` classes with the
  right CSS-module hashes).
- Working tree clean after the commit, pushed to
  `origin/main` (`c9991fe..19dc3e1  main -> main`).

## Notes for next pass

- **Sidebar chrome polish (this pass)** closed the
  cluster switcher statusText overflow, the cluster name
  no-hover affordance, and the WatchFooter dot's
  state-awareness. The dot now mirrors the connection
  lifecycle — pulsing = live, static = not connected —
  and the top + bottom of the sidebar tell the same
  story. The `chrome.sidebar.watch(0)` i18n test pin
  ensures the disconnect-time text doesn't fall through
  to the English inline fallback in zh.
- **Open follow-ups still on the queue** (not addressed
  by this pass):
  - **Pass-13**: empty text fields in Templates form
    silently fall through to defaults via the renderer's
    `||` fallback; needs a coordinated `required` policy
    decision.
  - **Pass-15 suggested**: MCP panel cards are static —
    but the panel is a "copy the config snippet" surface,
    not a live health indicator, so the suggestion
    doesn't quite fit. The "card header could show
    whether the JSON is in a copyable state" observation
    may be closer to a real fix.
  - **Pass-16 suggested**: Resource table column resize
    / reorder UX.
  - **Pass-17 suggested**: Cluster switcher mid-dot
    version field UX — **closed in this pass**.
  - **Pass-17 suggested**: WatchFooter pulsing dot +
    count — **closed in this pass**.
  - **Pass-14 / 17**: only `title="Grafana"` remains as
    a hardcoded brand string (the iframe's accessible
    name, not a UI label — keeping it as a literal brand
    name is the conventional choice, so this is by-design).
- **In-app Browser render queue is stuck for the 12th
  consecutive pass** — same symptom as pass-10 through
  pass-20. Pass-21's verification chain was code review
  + HMR / Vite serve + tsc / vitest / cargo check, which
  has caught every defect to date. The fix is purely
  structural (a flex truncation + an inline-style dot
  colour + an animation gate), all verifiable by reading
  the served bundles; the i18n test pin is visible by
  reading the new `it(...)` block.
- **Self-cleanup heuristic (from the cron task spec)**:
  "If the prior reports cover MOST of the rotation and
  last 3 passes found no new issues → the cron is done."
  Pass-18 found 3 high + 2 low, pass-19 found 3 high + 1
  low, pass-20 found 1 high + 1 medium, pass-21 found 2
  high + 2 medium. The rate of finding new issues is
  steady but the defect class is narrowing — pass-21's
  defects are 1 flex-overflow bug + 1 missing hover
  affordance + 1 unconditional animation + 1 missing
  i18n test pin, all 1–3 line changes in two adjacent
  files. The cron has not yet hit the "3 quiet passes"
  threshold, so the next pass should either pick one of
  the open follow-ups above or move to a deeper
  sub-area. Possible deeper sub-areas for the next pass:
  - **Templates `required` policy** (pass-13's
    follow-up; an empty name field currently falls
    through to the default, and the user has no idea
    their value was rejected).
  - **Resource table column resize / reorder UX**
    (pass-16's suggestion; the table renders at fixed
    column widths and a re-order / hide affordance
    would surface after a few sessions of real use).
  - **MCP panel card polish** (the "card header could
    show whether the JSON is in a copyable state"
    observation; the panel has 3 static cards with
    2 code blocks each, and a small "Copied" or
    "Cannot copy" affordance on the card header
    could be a useful UX win for users with
    permission-restricted environments).
- **The v0.2.4 rotation plus 7 rounds of post-rotation
  polish is now substantive**: every major form surface
  (HelmMarket add-repo, Templates, ActionList scale,
  ActionList port-forward, MetricsExplorer save bar,
  MetricsExplorer cache-bust) has been audited against
  the pass-12/13/18/19 fix pattern, the ForwardsBar
  tooltip / i18n gap is closed, the chrome's residual
  i18n leaks (pass-15/16/17 sweep) are all addressed,
  the cluster switcher version overflow is closed, and
  the WatchFooter dot now reflects the connection
  lifecycle.
