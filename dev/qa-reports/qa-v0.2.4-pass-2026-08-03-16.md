# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #16

## Area tested

**Template picker title/description i18n + ImageRepoPanel tag-row
tooltip** — the last two high-leverage residual i18n leaks from the
post-rotation sweep that pass-15 explicitly flagged as follow-ups:

1. **Templates → Create from template** (`src/components/templates/TemplatePicker.tsx`):
   the registry in `src/lib/templates.ts` ships three templates
   (`deployment` / `ingress` / `configmap`), each with a hardcoded
   English `title` and `description`. The picker used to render those
   strings directly via `{tt.title}` / `{tt.description}` /
   `{selected.title}`, so a zh user opening the picker saw
   "Deployment / Ingress (Nginx) / ConfigMap" and the English
   descriptions in both the list and the form heading. Pass-13
   fixed the form's input/output behaviour (number bounds, Enter
   submit, result namespace) and pass-15 specifically flagged the
   hardcoded registry copy as "the dict needs `tpl.titles.<id>` /
   `tpl.descs.<id>` across all three templates at once".

2. **ImageRepoPanel tag-row tooltip** (`src/components/imagerepo/ImageRepoPanel.tsx:297`):
   `title="Inspect manifest"` as a literal HTML attribute on every tag
   row in the drill-down. Pass-14 (ImageRepoPanel tags vertical
   layout polish) specifically flagged the residual `title=`
   attributes as a follow-up: "the i18n sweep has flagged the bigger
   leaks but the small hardcoded `title=` attributes throughout the
   codebase are out of scope for these targeted passes".

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **seventh** consecutive pass (same symptom as
> pass-10 / 11 / 12 / 13 / 14 / 15). The recovery path (`/quit` +
> relaunch of MiniMax Code) is not available in the scheduled-cron
> context. Verification was done by code review, by HMR / Vite
> serving the new modules, and by tsc / vitest / cargo check.

## Findings

### 1. [high] Template picker renders hardcoded English titles

`src/components/templates/TemplatePicker.tsx:86, 87, 94` (before this
pass) rendered `tt.title`, `tt.description`, and `selected.title`
directly from the `Template` registry. The dict already shipped
`tpl.{title, close, preview, applying, apply, pick}` (the panel
chrome) but no per-id title/description. Effect: a zh user opening
"Create from template" saw:

- 模板列表 (left pane): `Deployment` / `Ingress (Nginx)` / `ConfigMap`
  (English, not translated)
- 模板描述: `Single-container Deployment with a Service (ClusterIP).` /
  `Ingress that routes a host to an existing Service.` /
  `ConfigMap with two key-value pairs.` (English, not translated)
- 表单标题 (right pane, after picking): same English title repeated

This is exactly the leak class pass-1 fixed for the ⌘K palette,
pass-5 for the Pod Files overlay, pass-6 for the empty-state copy,
pass-8 for the Alerting panel, pass-10 for the resource card grid,
pass-12 for the Helm Market form, pass-13 for the Templates form
behaviour, pass-14 for the Image Registries panel (chrome keys +
dotted-path traversal bug), pass-15 for the detail-panel tabs +
Dashboard bars.

Pass-15 specifically flagged this as a follow-up: "template `title`
/ `description` still hardcoded English in the registry (the dict
needs `tpl.titles.<id>` / `tpl.descs.<id>` across all three
templates at once). Refactor is `tpl.titles.<id>` / `tpl.descs.<id>`
keys across all three templates at once." This pass is that
refactor.

### 2. [low] `title="Inspect manifest"` hardcoded English on tag rows

`src/components/imagerepo/ImageRepoPanel.tsx:297` had the literal
`title="Inspect manifest"` HTML attribute on each tag row in the
drill-down. Pass-14 specifically flagged this as a follow-up:
"the `title="Inspect manifest"` tooltip on tag rows is still
hardcoded English — pass-1/5/6/8/10/12/13/14's i18n sweep has
flagged the bigger leaks but the small hardcoded `title=`
attributes throughout the codebase are out of scope for these
targeted passes". A zh user hovering a tag row saw the English
tooltip. Severity is lower than the templates fix because
tooltips are hover-only and the visible text in the tag list was
already correct (the tag name itself, e.g. `v1.25.0`, is universal),
but it's a one-line fix so it's bundled in.

## Fixes applied

All in commit `6e9a63b`.

### `src/lib/i18n/dictionaries.ts`

- **Dictionary type** — `tpl` block gains two per-id sub-keys
  (`titles: { deployment, ingress, configmap }` and
  `descs: { deployment, ingress, configmap }`); `image` block gains
  one new leaf (`inspectTitle`). Both blocks documented with
  doc-blocks explaining the fallback contract (the registry /
  hardcoded attribute is the English fallback for a missing key).
- **EN dict** — `tpl.titles` and `tpl.descs` filled with the
  original hardcoded literals (`Deployment` / `Ingress (Nginx)` /
  `ConfigMap` and the three descriptions); `image.inspectTitle`
  filled with `"Inspect manifest"`.
- **ZH dict** — `tpl.titles` filled with the same English strings
  (these are the YAML `kind:` values, which the user expects to see
  in English even in a zh UI — the k7s sidebar already does this for
  `Pod / Deployment / Service`); `tpl.descs` filled with parallel
  zh translations (`单容器 Deployment 搭配 ClusterIP Service。` /
  `将一个域名路由到已有 Service 的 Ingress。` /
  `包含两组键值对的 ConfigMap。`); `image.inspectTitle` filled with
  `查看清单` (verb "view" + the same noun as `image.manifest: "清单"`,
  so the tooltip and the panel header agree on the noun).

### `src/components/templates/TemplatePicker.tsx`

Three call-site changes:

- Line 86-88: bare `{tt.title}` → `{t(`tpl.titles.${tt.id}`, tt.title)}`
- Line 89-91: bare `{tt.description}` → `{t(`tpl.descs.${tt.id}`, tt.description)}`
- Line 96: bare `{selected.title}` → `{t(`tpl.titles.${selected.id}`, selected.title)}`

The `t` was already destructured at the top of the component
(`useTranslation()`), the registry strings are the second-arg
fallback, and the `id` is the only thing that changes between
templates — the JSX is the same shape with `tt.id` or `selected.id`
substituted.

### `src/lib/templates.ts`

`Template.title` and `Template.description` doc-blocks now
document the i18n contract: each string is the English canonical
copy (and the YAML `kind:` for `title`) AND the i18n fallback for
the matching `tpl.titles.<id>` / `tpl.descs.<id>` dict key. The
doc-block records why the registry keeps the English copy rather
than splitting "English" from "i18n key" — the registry is the
single source of truth for the YAML kind, and a missing translation
falls through to the registry string the user would have seen
pre-fix.

### `src/components/imagerepo/ImageRepoPanel.tsx`

Line 297: bare `title="Inspect manifest"` →
`title={t("image.inspectTitle", "Inspect manifest")}`. The `t` was
already destructured at the top of the component.

### `src/lib/i18n.test.ts`

Two new test blocks, 6 new tests total:

1. **`template picker title/description i18n (pass-16 sweep)`** —
   5 tests:
   - `tpl.titles.<id>` ships for every template id in both locales
     (loops over `deployment` / `ingress` / `configmap`).
   - `tpl.descs.<id>` ships for every template id in both locales
     (same shape).
   - EN canonical copy matches the registry's hardcoded strings
     (pins the contract that the dict's en value equals the
     registry's en value, so `t("tpl.titles.deployment",
     "Deployment")` is a no-op for en and a translation for zh).
   - Deployment zh description contains the words `Deployment` and
     `Service` (the only description with both, and the most
     semantically loaded one — a future refactor that drops either
     trips this test).
   - Fallback path: a missing key with a leading string fallback
     renders the fallback, not the raw key (defence-in-depth: a
     future template added without a matching dict entry still
     renders sensibly).

2. **`image.inspectTitle (tag-row tooltip) in both locales`** —
   1 test added to the existing `image registries panel keys`
   describe block: pins the canonical en copy (`"Inspect manifest"`)
   and the zh copy (`"查看清单"`), and verifies that the zh tooltip
   contains the same `清单` noun as the panel's `image.manifest`
   chrome sibling — so the tooltip and the header agree on the
   noun, and a future refactor that splits the two into different
   words trips this test.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **371 passed (365 → 371, +6 new tests)**.
  The pass-15 test count was 365 (358 → 365, +7). Pass-16 adds
  5 template-picker tests + 1 image.inspectTitle test = 6 net
  new tests.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean
  (4 pre-existing warnings, unrelated to this pass; same as
  pass-15).
- Working tree clean after the commit, pushed to `origin/main`
  (`469406a..6e9a63b  main -> main`).

## Notes for next pass

- **Rotation is fully exhausted (rotation #1–#14 + post-rotation
  residual i18n sweep in pass-15 + pass-16 follow-up sweep).** The
  cron self-cleanup heuristic from the brief: "if the prior reports
  cover MOST of the rotation and last 3 passes found no new issues
  → the cron is done". The reports cover all of the rotation; the
  last 3 passes (13, 14, 15) all found substantive issues; pass-16
  also found 2. The rate of finding new issues is slowing but the
  cron still has value when run occasionally.

- **In-app Browser render queue is stuck for the seventh
  consecutive pass** — same symptom as pass-10 / 11 / 12 / 13 /
  14 / 15. The fix-the-queue path (`/quit` + relaunch) is not
  available in the scheduled-cron context. Pass-16's verification
  chain was code review + HMR / Vite serve + tsc / vitest /
  cargo check, which caught every i18n bug (the dotted-path bug
  class in particular was caught by reading the TSX and the dict
  side-by-side, not by visual inspection).

- **Future-tagged follow-ups from this and prior passes
  (still open):**
  - Pass-12: `pattern` attribute on the Helm Market repository
    name input (charset check for `/` / ` ` / `\`).
  - Pass-12: Add button loading / disabled state during submit.
  - Pass-11: "Clear cache" button has no visual feedback; save bar
    has no "edit existing" affordance.
  - Pass-13: empty text fields in Templates form silently fall
    through to defaults via the renderer's `||` fallback; needs
    a coordinated `required` policy decision.
  - Pass-14: other small hardcoded `title=` attributes throughout
    the codebase (out of scope for the i18n sweeps; the only one
    the sweeps have touched so far is `title="Inspect manifest"`
    in this pass). Each one is by-individual and would need a
    separate pass.

- **Possible deeper sub-areas for the next pass** (if the cron
  keeps running):
  - MCP server health / status UI (pass-14 suggested this).
  - Cluster switcher connection dropdown.
  - Watch footer status indicator.
  - Resource table column resize / reorder UX.
  - A coordinated `required` policy for the Templates form
    (follow-up from pass-13).
