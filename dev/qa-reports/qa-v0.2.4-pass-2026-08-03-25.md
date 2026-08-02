# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #25

## Area tested

**Settings theme picker mid-session resolution** (pass-22/23/24 follow-up, round 11).
The follow-up queue explicitly listed this as untested: *"switching from
'dark' to 'system' while the OS is light should immediately flip to light.
This is a behavioural test on `useTheme`'s `startThemeSync` subscription."*

The same subscription also drives the in-flight OS-flip case (a user on
"system" sees the palette change the moment the OS does, without ever
touching Settings), so the pass covers both. The implementation is
small — `startThemeSync` at `src/hooks/useTheme.ts:31-42` is 12 lines
— but the interesting part is the *wiring* (subscribe + apply +
cacheTheme), and a refactor that broke the wiring (subscribed to the
wrong slice, applied to the wrong attribute) would still leave
`resolveTheme` and `applyTheme` correct in isolation.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **16th** consecutive pass (same symptom as
> pass-10 through pass-24). Verification was by code review, by the 8
> new behavioural tests in `useTheme.test.ts` (which all pass on the
> unpatched code — there was nothing to patch), and by tsc / vitest /
> cargo check.

## Findings

### 1. [none] The mid-session resolution path is correct on every scenario the follow-up mentioned

Traced `startThemeSync` end-to-end:

- `useTheme.ts:31-42` — `startThemeSync` registers `useStore.subscribe(apply)`.
  Zustand v5's `subscribe(listener)` is the "subscribe to all" form
  (confirmed in `node_modules/zustand/esm/vanilla.mjs` and the
  `vanilla.d.mts` type signature), so any `setState` call — including
  `setSettings` from the Settings dropdown and `setSystemDark` from
  the `onSystemThemeChange` listener — fires the listener.
- `apply()` reads `useStore.getState()` fresh on every call, re-runs
  `resolveTheme(theme, systemDark)`, and writes the result to
  `<html data-theme>` and `<html style.colorScheme>` if (and only if)
  the resolved value changed since the last call. The `last` closure
  guards redundant DOM writes.
- The `useTheme` hook (called from `App.tsx:43`) has three effects
  beyond the apply: `onSystemThemeChange(setSystemDark)` (the OS
  listener), `getProvider().setWindowTheme(resolved)` (native window
  chrome, no-op in the browser), and `cacheTheme(theme)` (persists
  the *choice* — pinned by pass-23's `cacheTheme` tests). The
  resolution itself is owned by `startThemeSync` and is the same
  code path for both the Settings change and the OS flip.

Verified each scenario the follow-up mentioned, plus a few
symmetric cases:

| Scenario                                              | Result |
|-------------------------------------------------------|--------|
| Settings: `dark` → `system` while OS is light         | flips to `light` ✓ |
| Settings: `light` → `system` while OS is dark         | flips to `dark` ✓ |
| Settings: `system` → `light` while OS is dark         | flips to `light` ✓ |
| OS flip: `system` user, OS goes dark → light          | flips to `light` ✓ |
| OS flip: `system` user, OS goes light → dark          | flips to `dark` ✓ |
| OS flip while user has explicit `dark`                | **stays** `dark` ✓ |
| Unsubscribe returned by `startThemeSync()` is honoured | state changes are no-ops ✓ |

The "explicit choice ignores the OS" case is worth singling out: the
`last` closure's `if (resolved === last) return;` check depends on
`resolveTheme` being called with the user's *choice*, not a
short-circuited OS value. A refactor that special-cased "if theme
is explicit, don't re-resolve on `setSystemDark`" would still pass
the headline test (because it would still flip correctly on Settings
changes) but would miss the OS-flip case, where the user has dark
locked and the OS flips to light. The "ignores an OS flip when
the user has picked an explicit theme" test pins that.

## Fixes applied

All in commit `12ee92b`. **No production code was changed** — the
implementation was correct on the first audit. The commit is test-
only.

### `src/hooks/useTheme.test.ts` (new file)

- **New `describe` block `startThemeSync — initial paint`** with 1
  test:
  - **`applies the resolved theme to <html> on first subscribe`** —
    sets `settings.theme: "system"`, `systemDark: false` (jsdom has
    no `matchMedia`, so `prefersDark()` returns `false` in the
    store's boot path), starts `startThemeSync()`, and asserts both
    `data-theme` and `colorScheme` are `light`. Pins the
    "first paint agrees with what index.html painted" contract.
- **New `describe` block `startThemeSync — Settings panel changes`**
  with 3 tests:
  - **`flips the palette the moment Settings changes theme from 'dark'
    to 'system' on a light OS`** — the headline behavioural claim
    from the follow-up. The test name reads as a sentence so a
    future reader can grep for the claim and find the test that
    pins it.
  - **`flips the palette the moment Settings changes theme from
    'light' to 'system' on a dark OS`** — the symmetric case.
  - **`flips the palette when Settings changes from 'system' to an
    explicit choice`** — the other direction (OS is dark, user
    locks to "light").
- **New `describe` block `startThemeSync — OS flip while on
  'system'`** with 3 tests:
  - **`re-resolves to light the moment the OS flips to light`** —
    the in-flight OS-flip case (this is the one the doc comment in
    `useTheme.ts:60-64` alludes to: "the moment you switch back
    to 'system' you're stale until the OS next flips — which, on
    a machine that flips at sunset, could be hours"). The
    `onSystemThemeChange` effect dispatches `setSystemDark` and
    the subscription must re-resolve before React notices.
  - **`re-resolves to dark the moment the OS flips to dark`** —
    the symmetric OS-flip case.
  - **`ignores an OS flip when the user has picked an explicit
    theme`** — pins the "explicit choice wins" guarantee with a
    doc comment explaining *why* this case is its own test
    (a short-circuit-on-`systemDark` refactor would pass the
    Settings tests but fail this one).
- **New `describe` block `startThemeSync — unsubscribed, state
  changes are no-ops`** with 1 test:
  - **`stops applying once unsubscribed`** — pins the unsubscribe
    contract. The "first paint" test above would still pass if
    `startThemeSync` had no subscription at all (because the
    initial `apply()` call writes the document directly), so this
    test is the proof that *future* state changes go through the
    subscription, not just the constructor.
- **Shared setup** — `beforeEach` deletes `documentElement.dataset.theme`
  and clears `style.colorScheme` (jsdom's `<html>` is shared across
  tests in the same file); `afterEach` calls every stored unsubscribe
  so a stale subscription can't apply to the next test's state. The
  `unsubs` array pattern mirrors the one in `useGlobalKeys.test.ts`,
  adapted to `startThemeSync` (which returns its own unsubscribe)
  rather than a hook that has to be `cleanup()`'d.
- The test file mounts no React tree. `startThemeSync` is the
  production function called from `main.tsx:15` *before* the first
  render — running it directly exercises the same code path the
  app uses at boot. Driving the real subscription (not a copy of
  its logic) is the only way to catch a regression in the wiring
  (e.g. `useStore.subscribe` replaced with a no-op, or `apply`
  swapped for a stale `last` guard).

Total: **408 tests passed (400 → 408, +8 new)** in 19 files. The
new file is `src/hooks/useTheme.test.ts` (0 → 8).

## Verification

- `npx tsc --noEmit` — **clean**. The new test file uses only the
  public exports of `useStore` and `startThemeSync`; no type
  changes were needed.
- `npx vitest run` — **408 passed (400 → 408, +8 new)** across 19
  test files. The 8 new tests live in `src/hooks/useTheme.test.ts`
  (a new file).
- `cargo check --manifest-path src-tauri/Cargo.toml` — **clean**
  (4 pre-existing dead-code warnings in `metrics_config.rs`,
  unchanged from pass-24).

Commit `12ee92b` pushed to `origin/main`.

## Notes for next pass

The v0.2.4 rotation is exhausted and 11 rounds of post-rotation
follow-up are done (passes 15–25). The mid-session theme resolution
is now pinned by tests. Still on the queue from prior reports:

- pass-15: MCP panel card polish (observation rather than a
  live-health fix — `McpPanel.tsx`'s three cards still show the
  same URL-shaped JSON three times)
- pass-16: resource table column resize / reorder UX (no
  resize/reorder exists; a `localStorage`-backed user column order
  + a drag handle on the header would be a 60-line feature — out
  of scope for these targeted passes)
- pass-14/17: `title="Grafana"` brand string (by-design, the
  iframe's accessible name — not a bug, just an i18n observation)
- pass-23: multi-namespace / cross-namespace bulk actions (pass-18
  fixed scale/forward for one namespace; the only bulk action that
  could span namespaces is delete, and the `applyBulk` plumbing
  already does per-row ref resolution, but the test surface is
  unproven)

**Self-cleanup heuristic (per the cron instructions):** "If the
prior reports cover MOST of the rotation and last 3 passes found
no new issues → the cron is done." Last 3 passes:

- **pass-23** — found 3 real issues (McpPanel `claudeCode`
  `configPath` hardcoded EN, zh theme labels `黑色/白色` instead of
  `深色/浅色`, `cacheTheme` test gap) and fixed all 3.
- **pass-24** — found 1 real issue (`yamlDraft` dead state across
  3 actions) and fixed it.
- **pass-25 (this pass)** — found 0 issues; the resolution path
  was already correct. Added 8 tests as defensive coverage.

Two of the last three passes found real defects and the third
found that the follow-up claim was already pinned — the
follow-up queue is *still* productive (multi-namespace bulk
actions is the only behaviourally untested surface remaining
from the prior pass-23 list). The cron should keep running;
the residual queue is small but not empty.
