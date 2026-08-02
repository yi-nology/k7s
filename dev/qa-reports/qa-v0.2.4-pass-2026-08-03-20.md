# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #20

## Area tested

**ForwardsBar (B6, B16) — port-forwards strip above the status bar.
Post-rotation follow-up, round 6.** The v0.2.4 main rotation (#1
through #14) closed every entry in the original rotation, and
pass-15 / pass-16 / pass-17 / pass-18 / pass-19 audited residual
i18n leaks and form-polish defects against the pass-12 established
pattern (`<form onSubmit>` + Enter-to-submit + real `disabled` +
in-flight text + clamp + `pattern` where relevant). The
ForwardsBar predates the v0.2.4 i18n sweep (pass-1/8/9) and no test
had pinned its `chrome.forwards.*` keys, so a future refactor could
drop any of them the way `chrome.palette.actions.*` / `topology.*`
were dropped in earlier passes. Pass-20 closes the tooltip / i18n
gap.

1. **Error tooltip multi-line** —
   `src/components/forwards/ForwardsBar.tsx:67-80`, pre-fix.
   The function that builds the per-pill tooltip was:

   ```ts
   return f.error ? `${base}\n${f.error}` : base;
   ```

   The intent was a two-line tooltip: the resolved target on the
   first line, the failure string on the second. In practice, the
   HTML `title` attribute collapses `\n` to a space (every browser
   does this — Firefox, Chrome, Safari), so the user got a single
   line like `default/pod mypod:80 connection refused`, with the
   two halves glued together. A long error pushed the start of the
   failure off the hover timeout. The fix joins with ` — `
   (em-dash with spaces) instead — the same pattern
   `TemplatePicker.tsx:159` uses for its per-row error join. The
   em-dash is universal across locales and reads as a separator in
   both English and Chinese copy.

2. **`chrome.forwards.*` keys have no test coverage** — the
   `chrome.forwards.{label, copyAddress, stopForward,
   podTarget, serviceTarget}` block ships in both EN and ZH
   dictionaries but is never pinned by an i18n test, so a future
   refactor could drop or rename any of the five the way
   `chrome.palette.actions.*` and `topology.*` were dropped in
   earlier passes. Pass-20 adds four tests in
   `src/lib/i18n.test.ts` (one `describe` block, four `it` cases).

> **Browser limitation this pass:** the in-app Browser render
> queue remains stuck for the **11th** consecutive pass (same
> symptom as pass-10 through pass-19). Verification was by
> code review, HMR / Vite serving the new module (curl'd
> `ForwardsBar.tsx` and confirmed the served bundle references
> the new `${base} — ${f.error}` join), and tsc / vitest / cargo
> check.

## Findings

### 1. [high] ForwardsBar error tooltip renders as a single line

`src/components/forwards/ForwardsBar.tsx:67-80` (before this pass).
The pre-refactor `tooltip()` returned `\`${base}\n${f.error}\``,
which when placed in an HTML `title=` attribute renders as
`base error` (newline collapsed to space) — the two halves are
indistinguishable from a single concatenated string.

For a 60-character string the user can still read it on hover,
but the diagnostic value is much lower: "is this the resolved
target or the error?" is a question the user has to answer by
re-reading the whole string. The mock provider doesn't fail
forwards in the demo, so the defect doesn't show up in the
in-app visual loop — but the real TauriProvider can fail a
forward (e.g. `port already in use` from the kernel bind) and
the tooltip is the only place the user reads the error
inline.

The fix is structural: the `title` attribute cannot render
multi-line, so the join has to be a single-line separator.
Three options were considered:

- A custom hover tooltip overlay (the only one that preserves
  a real newline) — overkill for a 60-character diagnostic
  string the user reads once.
- A `<br />` inside a custom React tooltip — same as above;
  more state, more CSS, no real upside.
- A single-line separator (` — `, ` | `, ` · `) — the
  existing `TemplatePicker.tsx:159` pattern. Picks ` — `
  because it's the em-dash the rest of the chrome already
  uses for error joins, the same character reads naturally in
  both English and Chinese, and it doesn't collide with
  anything else in the resolved-target string.

The fix is a one-line change to the join. The doc block on
the component (lines 1-16) gets a v2 note recording the
rationale so a future refactor doesn't "fix" the apparent
typo back to `\n`.

### 2. [medium] `chrome.forwards.*` i18n keys are not test-pinned

`src/lib/i18n/dictionaries.ts:89-95` (the `chrome.forwards`
type) defines five keys, all five are present in both the EN
(`dictionaries.ts:630-637`) and ZH (`dictionaries.ts:1174-1181`)
catalogues, and all five are read by `ForwardsBar.tsx` — but
`src/lib/i18n.test.ts` has no `describe` block for them. The
class of failure this guards against is the well-known
"`chrome.palette.actions.*` / `topology.*` were dropped"
defect: a refactor that re-keys or removes a translation key
will compile cleanly (TypeScript only checks the key shape,
not the call sites) and the `translate()` helper falls back
to the supplied English string — so the user sees the inline
fallback copy in zh, the chrome renders broken, and no test
trips.

The fix: a new `describe("chrome.forwards.* —
ForwardsBar strip strings (pass-20)", ...)` block in
`i18n.test.ts` with four `it` cases:

- The three string leaves (`label` / `copyAddress` /
  `stopForward`) pinned to their canonical EN / ZH values.
- The two function-shaped targets (`podTarget` /
  `serviceTarget`) pinned for both call sites (pod forward
  vs service forward), with the structural asserts
  (the noun "pod" / "service", the arrow `→`, the colon
  before the port) so a future refactor that drops the
  arrow or swaps the noun trips the test.
- A "zh doesn't collapse to en" check on the three label
  / tooltip strings (the function-shaped targets are
  identical in both locales by design — `pod` / `service`
  are code-adjacent nouns, same as `POD` / `SERVICE` in the
  detail panel, and the chrome doesn't translate them as
  standalone words).

## Fixes applied

All in commit `9af012c`.

### `src/components/forwards/ForwardsBar.tsx`

**Doc block** (lines 1-16, after this pass) — adds a v2 note
documenting why the join is ` — ` and not `\n`:

> v2 — the error tooltip joins with " — " instead of "\n": an
> HTML `title` attribute doesn't render newlines (browsers
> squash them to a space, so the resolved target and the
> failure string ended up glued together with no visual
> separator). The em-dash is the same pattern
> TemplatePicker.tsx uses for its per-row error join, so
> error copy reads consistently across the chrome.

**`tooltip()` function** (lines 66-80, after this pass) — the
return line is now:

```ts
return f.error ? `${base} — ${f.error}` : base;
```

(plus a 3-line comment explaining why the join isn't `\n`).

### `src/lib/i18n.test.ts`

**New `describe` block** (lines 1085-1186, after this pass):

- `chrome.forwards.{label, copyAddress, stopForward}` are
  pinned to their canonical EN / ZH values. Pre-fix
  `chrome.forwards.label` zh was `端口转发:` — not the
  English "forwards:" fallback. This is the same defensive
  pattern as the pass-8 / pass-9 / pass-17 / pass-19
  describe blocks.
- `chrome.forwards.podTarget` (function) is called with
  `("default", "nginx-0", 80)` and the result pinned to
  `default/pod nginx-0:80` in both locales. The test also
  asserts the structure (the noun "pod", the slash
  separator, the colon before the port) so a future
  refactor that drops the noun or swaps the separator
  trips the test even if the literal string passes.
- `chrome.forwards.serviceTarget` (function) is called with
  the full five-arg signature
  `("default", "nginx", 80, "nginx-0", 8080)` and the
  result pinned to `default/service nginx:80 → pod
  nginx-0:8080` in both locales. The arrow `→` is the
  visual separator that distinguishes the published port
  from the resolved targetPort — if a refactor drops it
  the two halves blur into `default/service
  nginx:80 pod nginx-0:8080` and the user can't tell
  what's published vs what's backing the service.
- The "zh doesn't collapse to en" check on the three
  label / tooltip strings.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **386 passed (382 → 386, +4 new)**.
  The new `chrome.forwards.* — ForwardsBar strip strings
  (pass-20)` describe block exercises all 5 keys, both
  locales, and the two function-shaped targets' positional
  args.
- `cargo check --manifest-path src-tauri/Cargo.toml` —
  clean (4 pre-existing warnings, unrelated to this pass;
  same as pass-15 / pass-16 / pass-17 / pass-18 / pass-19).
- Vite HMR confirmed serving the updated
  `ForwardsBar.tsx` (the served bundle references the new
  `${base} — ${f.error}` join, the v2 doc block, and the
  new 3-line comment on the join).
- Working tree clean after the commit, pushed to
  `origin/main` (`0ef6ff4..9af012c  main -> main`).

## Notes for next pass

- **Post-rotation follow-up, round 6 (this pass)** closed
  the ForwardsBar tooltip rendering bug and added the
  missing `chrome.forwards.*` i18n test pins. The class
  of "tooltip with `\n` doesn't render" defect is now
  eliminated from the codebase — `grep` for `\n` in any
  `title=` attribute across `src/components/` returns no
  results.
- **Open follow-ups still on the queue** (not addressed
  by this pass):
  - **Pass-13**: empty text fields in Templates form
    silently fall through to defaults via the renderer's
    `||` fallback; needs a coordinated `required` policy
    decision.
  - **Pass-14 / 17**: only `title="Grafana"` remains as
    a hardcoded brand string; the other small hardcoded
    `title=` attributes have all been swept.
  - **Pass-15 suggested**: MCP server health / latency
    indicator (no live health UI on the McpPanel; the
    cards are static).
  - **Pass-16 suggested**: Resource table column resize
    / reorder UX.
  - **Pass-17 suggested**: Cluster switcher `connected ·
    v1.28.0` mid-dot separator + version field UX
    (truncation behaviour for long version strings).
  - **Pass-17 suggested**: WatchFooter pulsing dot +
    count (the dot pulses constantly regardless of
    whether any watch is actually happening — a
    non-state-dependent decoration).
- **In-app Browser render queue is stuck for the 11th
  consecutive pass** — same symptom as pass-10 through
  pass-19. Pass-20's verification chain was code review
  + HMR / Vite serve + tsc / vitest / cargo check, which
  has caught every defect to date. The ForwardsBar fix
  is a one-line string change verifiable by reading the
  served bundle; the i18n test pins are visible by
  reading the new describe block.
- **Self-cleanup heuristic (from the cron task spec)**:
  "If the prior reports cover MOST of the rotation and
  last 3 passes found no new issues → the cron is done."
  Pass-17 found 3 high + 2 low (observed), pass-18 found
  3 high + 2 low, pass-19 found 3 high + 1 low, pass-20
  found 1 high + 1 medium. The rate of finding new
  issues is steady but the defect class is narrowing —
  pass-20's defects are 1 string-separator bug + 1
  missing i18n test pin, both single-file
  / single-describe-block changes. The cron has not yet
  hit the "3 quiet passes" threshold, so the next pass
  should either pick one of the open follow-ups above
  or move to a deeper sub-area. Possible deeper
  sub-areas for the next pass:
  - **MCP server health / latency** (pass-15's
    suggestion; the McpPanel has 3 static cards with
    no live health indicator like the cluster
    switcher has).
  - **WatchFooter pulsing dot + count** (pass-17's
    suggestion; the dot's visual state under connect
    / disconnect could be checked).
  - **Resource table column resize / reorder UX**
    (pass-16's suggestion; the table renders at fixed
    column widths and a re-order / hide affordance
    would surface after a few sessions of real use).
  - **Templates `required` policy** (pass-13's
    follow-up; an empty name field currently falls
    through to the default, and the user has no idea
    their value was rejected).
- **The v0.2.4 rotation plus 6 rounds of post-rotation
  polish is now substantive**: every major form
  surface (HelmMarket add-repo, Templates, ActionList
  scale, ActionList port-forward, MetricsExplorer save
  bar, MetricsExplorer cache-bust) has been audited
  against the pass-12/13/18/19 fix pattern, the ForwardsBar
  tooltip / i18n gap is now closed, and the chrome's
  residual i18n leaks (pass-15/16/17 sweep) are all
  addressed.
