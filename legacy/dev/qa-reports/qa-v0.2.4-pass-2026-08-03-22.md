# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #22

## Area tested

**Template picker form `required` policy (post-rotation follow-up, round 8).**
Pass-13's report explicitly listed this as a follow-up:

> *observed (not fixed): empty text fields silently fall through to
> defaults (a `required` policy needs to be coordinated with the
> renderer's `||` fallback).*

That follow-up has been on the queue through passes 14–21. This pass
addresses it. The Templates → Create-from-template picker renders 18
text/number inputs across 3 templates (deployment / ingress /
configmap); every one of them silently falls back to its `default` via
the renderer's `v.name || "my-app"`-style substitution. A user who
clears the "Name" field and clicks Apply would see a successful
`my-app` apply with no error — exactly the failure mode the
follow-up describes.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **13th** consecutive pass (same symptom as
> pass-10 through pass-21). Verification was by code review, by HMR
> / Vite serving the new modules (curl'd the updated bundles and
> confirmed the new `required` attribute is on the form input), and
> by tsc / vitest / cargo check.

## Findings

### 1. [high] Templates form inputs silently fall back to defaults on empty

`src/components/templates/TemplatePicker.tsx:114-125` (before this
pass) rendered every text/number input without the native `required`
HTML5 attribute:

```tsx
<input
  type={p.kind === "number" ? "number" : "text"}
  value={values[p.key] ?? p.default}
  pattern={p.pattern}
  min={p.min}
  max={p.max}
  placeholder={p.default}
  onChange={(e) =>
    setValues({ ...values, [p.key]: e.target.value })
  }
/>
```

And the renderer at `src/lib/templates.ts:104-109, 188-194, 240-246`
silently substitutes the default for an empty value:

```ts
const name = v.name || "my-app";
const image = v.image || "nginx:1.25";
const ns = v.namespace || "default";
```

Effect: a user who clears any text field (e.g. types a name and then
backspaces it) and clicks Apply sees a successful apply with the
default value — a quietly-defaulted resource instead of a validation
error. The form's preview also still shows the default name in the
YAML preview, so the user has no way to know the renderer used the
fallback.

The `??` vs `||` distinction doesn't help here: `value={values[p.key]
?? p.default}` keeps showing the default in the input even when the
user has cleared the field, because `??` only narrows on
`null`/`undefined` (an empty string `""` is neither, so the input
correctly shows empty). The problem is on submit, not display.

This is exactly the follow-up pass-13 flagged. The form should block
submission with an empty value — let the user see the native "Please
fill out this field" tooltip, and the renderer's `||` fallback
remains a safety net for programmatic callers (tests, future
programmatic apply APIs).

### 2. [low] The form's `required` decision is hardcoded in the JSX, not the schema

The Templates registry (`src/lib/templates.ts`) carries no
`required` flag on `TemplateParam`, so the form's "always required"
decision is buried in a JSX expression. A future refactor that adds
a new param kind (or an optional field) would have no place in the
schema to flip the policy — it would have to remember to update the
JSX. Same problem class as the pre-pass-13 `min`/`max`: the schema
should be the single source of truth, the form should mirror it
mechanically.

## Fixes applied

All in commit `d9c72e4`.

### `src/lib/templates.ts`

- **Schema** — `TemplateParam` gains a new optional field
  `required?: boolean` with a doc block. The block documents the
  default the form applies (`true` for `kind: "text" | "number"`,
  `false` for `kind: "boolean"`) and *why* — a checkbox's "empty"
  state is `false`, which is still a value, so `required` on a
  checkbox is meaningless. The block also references the pass-13
  follow-up and explains that the form mirrors `required` as the
  native HTML5 attribute, while the renderer's `||` fallback remains
  a safety net for programmatic callers.

### `src/components/templates/TemplatePicker.tsx`

- **Form input** — the text/number `<input>` at `TemplatePicker.tsx:114-125`
  gains `required={p.required ?? true}`. The boolean branch above
  already handles the `kind: "boolean"` case, so by the time we
  reach the else branch `p.kind` is `"text" | "number"` and the
  default is `true`. A param that explicitly opts out (e.g. an
  optional label key) can set `required: false` on the
  `TemplateParam`. A 6-line comment on the JSX explains the
  narrowing and the opt-out, so a future refactor doesn't "simplify"
  it back to no attribute.

### `src/lib/templates.test.ts`

- **New describe block** `TemplateParam.required policy` with 2 new
  tests:
  - **`every text/number param is required (no opt-out yet)`** —
    iterates every `Template` × `TemplateParam`, skips `boolean`,
    and asserts the effective `required` (`p.required ?? true`) is
    `true`. The error message identifies the specific param
    (`${t.id}.${p.key} (${p.kind})`) so a future template that
    ships an unmarked optional field fails loudly.
  - **`the form's default for \`required\` is \`true\` for text/number and \`false\` for boolean`** —
    documents the `required ?? kind !== "boolean"` default the
    form applies. The test re-implements the defaulting function
    locally so a refactor that flips the default in the form
    trips this test (the form and the test would then disagree).
    A pre-emptive note in the test says the registry currently
    has no `boolean` params; the assertion is future-proof.

Total: 19 tests in `templates.test.ts` (17 → 19, +2 new).

## Verification

- `npx tsc --noEmit` — **clean** (one initial `p.kind !== "boolean"`
  error in the JSX because TypeScript narrowed `p.kind` in the
  `else` branch; fixed by changing the form's default to `p.required
  ?? true` since the boolean case is already handled above)
- `npx vitest run` — **389 passed (387 → 389, +2 new)** across 18
  test files
- `cargo check --manifest-path src-tauri/Cargo.toml` — **clean**
  (4 pre-existing dead-code warnings, unchanged from pass-21)

Commit `d9c72e4` pushed to `origin/main`.

## Notes for next pass

The v0.2.4 rotation is exhausted (every entry #1 through #14 walked
and pinned) and 8 rounds of post-rotation follow-up are done (passes
15–22). Still on the queue from prior reports:

- pass-15: MCP panel card polish (observation rather than a
  live-health fix — `McpPanel.tsx`'s three cards still show the
  same URL-shaped JSON three times; a future pass could collapse
  the duplicates or visually distinguish them)
- pass-16: resource table column resize / reorder UX (no
  resize/reorder exists; a `localStorage`-backed user column order
  + a drag handle on the header would be a 60-line feature — out
  of scope for these targeted passes)
- pass-14/17: `title="Grafana"` brand string (by-design, the
  iframe's accessible name — not a bug, just an i18n observation)

The next pass should pick a new untested feature, not another
follow-up — the queue is now well-worn and the residual items are
either by-design or feature-sized (column resize). Suggestions:

- **CronJob detail panel tabs** — the CronJob detail has a
  schedule preview + last-run history; if any kind has a custom
  tab strip it should be CronJob
- **Resource Yaml tab edit-mode toggle** — every detail panel has
  a Yaml tab; check whether edit-mode round-trips cleanly
- **Multi-namespace / cross-namespace bulk actions** — pass-18
  fixed scale/forward for one namespace; check what happens when
  the selection spans namespaces
- **Settings theme picker** — the theme switcher in Settings
  persists; verify localStorage round-trips through a reload

The cron should keep running; the rotation is not yet complete.
