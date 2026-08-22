# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #18

## Area tested

**Form polish — ActionList scale + port-forward + HelmMarket
add-repo (post-rotation follow-up, round 4).** Pass-12 fixed the
HelmMarket Repositories form (`30bc5e5`) and pass-13 fixed the
Templates form (`ed3b318`); both established a small set of
form-quality patterns that the rest of the app's action surfaces
should match. Pass-18 audits three more forms against that bar:

1. **ActionList scale form** (`src/components/actions/ActionList.tsx`,
   `mode.kind === "form" && mode.id === "scale"`) — the row context
   menu's `Scale…` and the detail panel's `…` menu both open this
   form for a Deployment / StatefulSet row. Pre-fix, the form was
   the original pre-pass-12 HelmMarket shape: a `<div>` with two
   +/− buttons and a click-only Apply, no way to type a value, no
   Enter-to-submit, and an Apply with `aria-disabled={busy}` only
   (the kind of bug pass-1 found for the overlay's `aria-disabled`).
2. **ActionList port-forward form** (`ActionList.tsx`,
   `mode.id === "forward"`) — the row context menu's `Forward…` on a
   Pod / Service row. Same pre-pass-12 shape: `<div>` + number input
   + click-only Apply, no Enter, `aria-disabled` only. Worse, the
   port input's `setPort(Number(e.target.value))` accepted `NaN` (the
   user clearing the input) and out-of-range values.
3. **HelmMarket add-repo form** (`src/components/helm/HelmMarket.tsx`,
   `adding ? <form> : <button>`) — pass-12 fixed the form's structure
   (`<form onSubmit>` + `required` + `type="submit"` on Apply) but
   explicitly left two follow-ups: "Add button has no loading /
   disabled state during submit" and "name input could gain a
   `pattern` attribute to surface the `/` / ` ` / `\` charset error
   client-side". Pass-18 closes both.

All three share the same defect class. Pass-18 applies the pass-12/13
fix pattern uniformly.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **ninth** consecutive pass (same symptom as
> pass-10 through pass-17). Verification was by code review, HMR /
> Vite serving the new modules (curl'd the served `ActionList.tsx`
> / `HelmMarket.tsx` / `dictionaries.ts` and confirmed the new
> `t()` calls + new zh leaves), and tsc / vitest / cargo check.

## Findings

### 1. [high] Scale form has no `<form onSubmit>`, no typing path, no real disabled

`src/components/actions/ActionList.tsx:197-228` (before this pass).
The pre-refactor form was:

- Wrapped in a plain `<div className={styles.menu}>` (not `<form>`),
  so pressing Enter inside the panel did nothing.
- The value was a `<span>` — the user could only `+` / `−` 1 at a
  time. For a StatefulSet going from 3 → 30 replicas (a real use
  case during a load test), that is 27 clicks.
- The Apply was a `<div>` with `onClick` and `aria-disabled={busy}`.
  `aria-disabled` is an a11y hint, not a click guard; the second
  click still fires, so a double-click would queue two
  `scaleResource` calls (idempotent on the wire, but the user
  sees two error banners if one fails).
- The Apply's busy state was the same as the non-busy state — no
  visual feedback during the in-flight request, no "Applying…"
  text, so a slow k8s API made the menu look frozen.
- The `−` button didn't cap at 0 (a click at 0 went to `-1`); the
  `+` button had no upper bound (cosmetic only, k8s accepts any
  int, but `Number.MAX_SAFE_INTEGER` is an unhappy default for a
  `replicas` field).

### 2. [high] Port-forward form has no `<form onSubmit>`, no clamp, no real disabled

`src/components/actions/ActionList.tsx:231-277` (before this pass).
The pre-refactor form was:

- Wrapped in a `<div>`, not a `<form>`. Same Enter-doesn't-submit
  defect as the scale form.
- `<input type="number" min={1} max={65535}>` with
  `setPort(Number(e.target.value))`. Clearing the input sets `port`
  to `NaN`; the next Apply sends `NaN` to the backend. `min` /
  `max` were HTML hints only, not enforced in the React state — a
  type of 99999 ships as 99999 to `startPortForward`.
- Apply was a `<div>` with `aria-disabled={busy}` only. Same
  double-fire defect as the scale form.

### 3. [high] HelmMarket add-repo's name input has no `pattern`; Add button has no loading state

`src/components/helm/HelmMarket.tsx:285-308` (before this pass).
Pass-12's follow-up notes (verbatim, from `qa-v0.2.4-pass-2026-08-03-12.md`):

> - **Low** (observed, not fixed): Add button has no loading /
>   disabled state during submit (race allows double-click — Rust
>   backend de-dupes by name so worst case is a confusing error).
> - **Low** (observed, not fixed): name input could gain a
>   `pattern` attribute to surface the `/` / ` ` / `\` charset
>   error client-side.

The fix is mechanical and pass-18 picks it up.

### 4. [low] Confirm dialog's `busy ? "…"` was a hardcoded literal

`src/components/actions/ActionList.tsx:188` (before this pass) —
the in-flight indicator on Delete / Restart / Drain's confirm
button was a literal Unicode ellipsis. Low-leverage (the ellipsis
is universal in both locales), but it's the same leak class
pass-1 / pass-5 / pass-6 / pass-8 / pass-10 / pass-13 / pass-14 /
pass-15 / pass-16 / pass-17 fixed — every other always-visible
chrome string routes through `t()`, this one didn't.

### 5. [low] Confirm dialog's click handlers used `aria-disabled` only

Same defect class as the scale / forward forms. `aria-disabled`
is an a11y hint; the click still fires, so a fast double-click
on `Delete` would queue two deletions. The pre-refactor
`if (busy)` early-return was not present in the handlers, so
the second click always reached `confirmed(mode.id)`.

## Fixes applied

All in commit `c901b8b`.

### `src/components/actions/ActionList.tsx`

**Scale form** (lines 206-293, after this pass):

- The whole panel is now wrapped in `<form onSubmit>`; pressing
  Enter inside the numeric input submits the form. The handler
  early-returns on `busy` so a programmatic `.submit()` (or a
  browser that ignores `disabled` on submit) can't double-fire.
- The `<span>` is replaced with a `<input type="number" min={0}>`
  that lets the user type a value directly. The `onChange` clamps
  the state: `Number.parseInt` of the string, `Number.isNaN`
  falls back to `0` (so a clear doesn't leave `replicas` as
  `NaN`), and `Math.max(0, n)` keeps it non-negative. The
  `+` / `−` buttons stay as a quick affordance but the
  `−` button is now gated on `replicas > 0` (the
  `aria-disabled={busy || replicas <= 0}` early-return prevents
  underflow).
- Apply is now a real `<button type="submit" disabled={busy}>`
  with the `applying` text during the in-flight request. The
  CSS's `aria-disabled` rule was already there; pass-18 adds a
  `[disabled]` selector next to it so the real attribute gets
  the same `opacity: 0.6; pointer-events: none;` treatment.
- A `replicas` / `副本数` label sits next to the input so the
  number doesn't read as a bare count. The label is
  i18n'd as `actions.scaleForm.replicasLabel`.

**Port-forward form** (lines 295-369, after this pass):

- Same `<form onSubmit>` wrap + Enter-to-submit + early-return on
  `busy`. Apply is a real `<button type="submit" disabled={busy}>`
  with the `applying` text.
- Port input clamps to `[1, 65535]` on every keystroke:
  `Number.parseInt` of the string, `Number.isNaN` falls back to
  `1`, otherwise `Math.max(1, Math.min(65535, n))`. The
  `min={1} max={65535}` HTML hints stay as the browser's
  spinner bounds.
- A `port` / `端口` label sits next to the input (same pattern
  as the scale form). The label is i18n'd as
  `actions.forwardForm.portLabel`.

**Confirm dialog** (lines 170-204, after this pass):

- The two click handlers (`cancelBtn` and `applyBtn` /
  `dangerBtn`) gain an `if (busy) return;` early-return so a
  double-fire on Delete can't queue two deletions. `aria-disabled`
  is still there for the screen reader; `disabled` is not added
  because the CSS depends on `[aria-disabled='true']` to keep
  the visual rule consistent with the form Apply buttons (the
  new `[disabled]` selector handles those).
- The literal `"…"` in-flight indicator routes through
  `t("actions.confirming", "…")`. Both locales are `"…"`; the
  structural change matters more than the value (any future
  locale can pick a different ellipsis style if it wants).

### `src/components/helm/HelmMarket.tsx`

- `useState` for a new `submitting` flag (line 195).
- The form's `onSubmit` sets `submitting = true` before the
  await and `submitting = false` in `finally`. The early-return
  on `if (submitting) return;` is added at the top of the
  handler so a programmatic `.submit()` can't bypass the
  `disabled` button.
- The name input gains `pattern="[a-z0-9][a-z0-9-]*"` (Helm
  repo names follow the DNS-label charset) and a
  `title="lowercase letters, digits, and '-'"` tooltip. The
  browser surfaces a native `patternMismatch` validation
  message before the submit handler fires, so the user can't
  send `my repo /` to the backend.
- All 3 inputs and both buttons (Add, Cancel) are
  `disabled={submitting}` during the in-flight request. Add's
  text switches between "Add" / "添加" and "Adding…" /
  "正在添加…".

### `src/components/actions/ActionList.module.css`

The shared `.cancelBtn` / `.applyBtn` / `.dangerBtn` classes
gain the small resets that make a real `<button>` render the
same as the `<div>` the action menu used to use:

```css
.cancelBtn {
  /* ... existing ... */
  background: transparent;
  font: inherit;
  line-height: 1.4;
}

.applyBtn {
  /* ... existing ... */
  font-family: inherit;
  line-height: 1.4;
}

.dangerBtn {
  /* ... existing ... */
  font-family: inherit;
  line-height: 1.4;
}
```

`font: inherit` is the important one: a `<button>` has its own
user-agent font that the class above doesn't cover, so a real
button would render in the system default and look visually
off against the surrounding 11px UI.

The in-flight visual rule gains a `[disabled]` selector next
to the existing `[aria-disabled='true']`:

```css
.applyBtn[aria-disabled="true"],
.dangerBtn[aria-disabled="true"],
.applyBtn[disabled],
.dangerBtn[disabled] {
  opacity: 0.6;
  pointer-events: none;
}
```

`.cancelBtn` doesn't need the rule because it's a `<div>` in
the confirm path (no `disabled` attribute, the early-return on
`busy` is enough) and is not a submit button in the form path
(so `disabled` is never set on it from the form).

### `src/lib/i18n/dictionaries.ts`

**Type** — 7 new leaves:

```ts
actions: {
  // ... existing ...
  scaleForm: {
    title: (name: string) => string;
    applying: string;     // NEW
    replicasLabel: string; // NEW
  };
  forwardForm: {
    // ... existing ...
    applying: string;     // NEW
    portLabel: string;    // NEW
  };
  confirming: string;     // NEW
  // ... existing ...
};

helm: {
  // ... existing ...
  repos: {
    // ... existing ...
    form: {
      // ... existing ...
      adding: string;     // NEW
      nameTitle: string;  // NEW
    };
  };
};
```

**EN** — all 7 leaves filled. `actions.scaleForm.applying =
"Applying…"`, `actions.scaleForm.replicasLabel = "replicas"`,
`actions.forwardForm.applying = "Forwarding…"`,
`actions.forwardForm.portLabel = "port"`, `actions.confirming =
"…"`, `helm.repos.form.adding = "Adding…"`,
`helm.repos.form.nameTitle = "lowercase letters, digits, and '-'"`.

**ZH** — all 7 leaves filled. `actions.scaleForm.applying =
"正在调整…"`, `actions.scaleForm.replicasLabel = "副本数"`,
`actions.forwardForm.applying = "正在转发…"`,
`actions.forwardForm.portLabel = "端口"`, `actions.confirming =
"…"`, `helm.repos.form.adding = "正在添加…"`,
`helm.repos.form.nameTitle = "小写字母、数字与 '-'"`.

### `src/lib/i18n.test.ts`

- The existing `helm market repositories panel keys` describe
  block's iteration over `helm.repos.form.*` adds `"adding"` and
  `"nameTitle"` to the array (lines 226-231).
- New `describe("action list scale + forward form keys (pass-18)", ...)`
  block with 4 tests:
  1. `actions.scaleForm.{applying, replicasLabel}` en + zh.
  2. `actions.forwardForm.{applying, portLabel}` en + zh.
  3. `actions.confirming` en + zh (the Unicode ellipsis).
  4. `helm.repos.form.nameTitle` en + zh + a regression check
     that `nameTitle` and `name` are distinct keys (a future
     refactor that collapses them would lose the tooltip that
     explains the `pattern` attribute).

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **380 passed (376 → 380, +4 new)**.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean
  (4 pre-existing warnings, unrelated to this pass; same as
  pass-15 / pass-16 / pass-17).
- Vite HMR confirmed serving the updated `ActionList.tsx`
  (calls `t("actions.scaleForm.applying")` /
  `t("actions.scaleForm.replicasLabel")` /
  `t("actions.forwardForm.applying")` /
  `t("actions.forwardForm.portLabel")` /
  `t("actions.confirming")`), `HelmMarket.tsx` (calls
  `t("helm.repos.form.nameTitle")` /
  `t("helm.repos.form.adding")`), and `dictionaries.ts` (serves
  all 7 new zh leaves). curl'd
  `http://localhost:1420/src/lib/i18n/dictionaries.ts` and
  grep'd for the 7 new keys; all 7 en + all 7 zh present.
- Working tree clean after the commit, pushed to `origin/main`
  (`9fead60..c901b8b  main -> main`).

## Notes for next pass

- **Post-rotation follow-up, round 4 (this pass)** closed the
  pass-12 add-repo follow-ups (pattern + Add loading) and the
  scale / port-forward form polish (3 surfaces that had the
  same defect class as pass-12/13 fixed for the HelmMarket
  Repositories / Templates forms). The v0.2.4 rotation plus
  4 rounds of post-rotation polish is now substantive: every
  major form surface has been audited against the
  pass-12/13 fix pattern (`<form onSubmit>` + Enter-to-submit +
  real `disabled` + in-flight text + clamp + `pattern` where
  relevant).
- **Open follow-ups still on the queue** (not addressed by
  this pass):
  - **Pass-11**: "Clear cache" button has no visual feedback;
    save bar has no "edit existing" affordance (Metrics
    Explorer saved queries).
  - **Pass-13**: empty text fields in Templates form silently
    fall through to defaults via the renderer's `||` fallback;
    needs a coordinated `required` policy decision (and would
    touch the templates.test.ts `clampInt` tests if the policy
    is "block apply on empty" instead of "silently fall back").
  - **Pass-14 / 17**: only `title="Grafana"` remains as a
    hardcoded brand string; the other small hardcoded `title=`
    attributes have all been swept.
  - **Pass-15 suggested**: MCP server health / latency
    indicator (no live health UI on the McpPanel; the cards
    are static).
  - **Pass-16 suggested**: Resource table column resize /
    reorder UX.
  - **Pass-17 suggested**: Cluster switcher `connected ·
    v1.28.0` mid-dot separator + version field UX
    (truncation behaviour for long version strings).
- **In-app Browser render queue is stuck for the ninth
  consecutive pass** — same symptom as pass-10 through
  pass-17. Pass-18's verification chain was code review +
  HMR / Vite serve + tsc / vitest / cargo check, which has
  caught every defect to date (the form-polish class in
  particular is structural — visible by reading the TSX and
  seeing the missing `<form onSubmit>` wrapper, the
  `aria-disabled`-only Apply, the `setPort(Number(NaN))`
  pattern).
- **Self-cleanup heuristic (from the cron task spec)**:
  "If the prior reports cover MOST of the rotation and last
  3 passes found no new issues → the cron is done." Pass-16
  found 1 high + 1 low, pass-17 found 3 high + 2 low
  (observed), pass-18 found 3 high + 2 low. The rate of
  finding new issues is steady but the defect class is
  narrowing (all 3 of pass-18's highs are the same class
  pass-12/13 established). The cron has not yet hit the
  "3 quiet passes" threshold, so the next pass should
  either pick one of the open follow-ups above or move to
  a deeper sub-area. Possible deeper sub-areas for the
  next pass:
  - **MCP server health / latency** (pass-15's
    suggestion; the McpPanel has 3 static cards with no
    live health indicator like the cluster switcher has).
  - **WatchFooter pulsing dot + count** (pass-17's
    suggestion; the dot's visual state under connect /
    disconnect could be checked).
  - **Resource table column resize / reorder UX**
    (pass-16's suggestion; the table renders at fixed
    column widths and a re-order / hide affordance would
    surface after a few sessions of real use).
  - **Templates `required` policy** (pass-13's
    follow-up; an empty name field currently falls through
    to the default, and the user has no idea their value
    was rejected).
