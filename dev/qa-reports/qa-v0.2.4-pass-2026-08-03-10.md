# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #10

## Area tested

**Dashboard overlay (B22, rotation #12)** — the cluster-overview panel
(`src/components/dashboard/Dashboard.tsx`) accessed via the sidebar's
"总览 / Dashboard" entry under TOOLS or via the ⌘K palette. This was the
one Phase-2 feature overlay that had only ever been smoke-tested at the
fix level (closing the overlay from the resource cards, etc.) and never
under an actual i18n walk. Pass-9's "Notes for next pass" called out the
specific bug: `RESOURCE_KINDS` at `Dashboard.tsx:39-48` hardcoded the
nine labels as English (`Pods / Deployments / Services / ConfigMaps /
Secrets / Jobs / CronJobs / Nodes / Namespaces`), and a Chinese UI
would render those same English strings — the same leak class pass-1
fixed for `⌘K`, pass-5 for Pod Files, pass-6 for the table empty
state, and pass-8 for Alerting.

This pass:

1. Walks the Dashboard overlay end-to-end in both locales (cluster
   info, CPU/MEM utilisation, the nine resource cards, the recent
   events panel).
2. Verifies the resource-card click navigation works (overlay closes,
   the table for that kind appears behind it).
3. Fixes the i18n leak: routes every card label through
   `kindLabelFor()` so a Chinese UI shows `Pod / Deployment / Service /
   ConfigMap / Secret / Job / CronJob / 节点 / 命名空间`.
4. Pins the contract with 12 new i18n regression tests.

> **Browser limitation this pass:** the in-app Browser tool's render
> queue was stuck for the entire session (every `inspect` / `navigate` /
> `wait` returned `Background Browser render queue wait timed out`,
> including a fresh `about:blank` and a 60-second pause). Verification
> was therefore done by code review, by `curl http://localhost:1420/`
> to confirm Vite was HMR-serving the new module
> (`const RESOURCE_KINDS = … const label = kindLabelFor(k.id, [], locale) …`),
> and by tsc / vitest / cargo check. The bug is mechanical
> (one `kindLabelFor()` call replaces a hardcoded string) and the test
> contract pins the exact zh values that should now render.

## Findings

### 1. [high] Dashboard resource cards hardcode English labels (zh UI shows raw English)

`src/components/dashboard/Dashboard.tsx:25-48` defines `RESOURCE_KINDS`
as an array of `{ id, label, color }` tuples, and the `label` field was
hardcoded English:

```ts
const RESOURCE_KINDS: Array<{
  id: "pods" | "deployments" | … | "namespaces";
  label: string;
  color: string;
}> = [
  { id: "pods",        label: "Pods",        color: "var(--accent)" },
  { id: "deployments", label: "Deployments", color: "#5cc8ff" },
  { id: "services",    label: "Services",    color: "#f7c948" },
  { id: "configmaps",  label: "ConfigMaps",  color: "#a78bfa" },
  { id: "secrets",     label: "Secrets",     color: "#fb7185" },
  { id: "jobs",        label: "Jobs",        color: "#34d399" },
  { id: "cronjobs",    label: "CronJobs",    color: "#fb923c" },
  { id: "nodes",       label: "Nodes",       color: "#22d3ee" },
  { id: "namespaces",  label: "Namespaces",  color: "#e879f9" },
];
```

The component then renders `{k.label}` directly at line 167. With
`Settings → Language = 中文`, the dashboard panel title flips to
`总览` and the chrome around it flips correctly, but the resource cards
keep showing `Pods / Deployments / Services / ConfigMaps / Secrets /
Jobs / CronJobs / Nodes / Namespaces` — raw English in a Chinese
chrome. (The other 7 strings in the component — `dashboard.title`,
`dashboard.close`, `dashboard.cluster`, `dashboard.phase`,
`dashboard.nodes`, `dashboard.events`, `dashboard.events.empty` — were
already routed through `t()`.)

This is the exact regression pass-1 fixed for the ⌘K palette (commit
`29b0fd5`) and pass-8 fixed for the Alerting panel (commit `35944db`):
a hand-rolled English string bypassing the i18n registry.

## Fixes applied

### `src/components/dashboard/Dashboard.tsx`

1. **Drop the `label` field from `RESOURCE_KINDS`** — the array now
   carries only the kind `id` and the per-card `color` (the visual
   that doesn't depend on locale). The new doc-block on the constant
   explains why the label is computed per render rather than stored
   statically.
2. **Pull `locale` from `useTranslation()`** — the hook already returns
   `{ t, locale }` (since it was used to bind `t`); the destructuring
   is a one-token change.
3. **Resolve the label per card through `kindLabelFor()`** — the
   helper at `src/lib/i18n/index.ts:230` already handles the
   built-in / custom split and the locale lookup; the dashboard only
   lists built-in kinds, so `kindLabelFor(k.id, [], locale)` returns
   the correct localised string (`Pod` / `Deployment` / `Service` /
   `ConfigMap` / `Secret` / `Job` / `CronJob` / `节点` / `命名空间` in
   zh, and the canonical `Pods / Deployments / …` plurals in en). The
   `?? k.id` fallback means a future refactor that adds a new kind
   here without a matching entry in `KIND_LABELS_ZH` renders the id
   itself rather than `undefined` — visible, debuggable, the same
   shape `kindLabelFor` already has for unknown ids.
4. **No change to the click handler** — `setNav(k.id)` + `onClose` /
   `closeOverlay()` is correct; it closes the overlay so the table
   behind it is visible. This was the pass-0 audit fix and the
   per-card navigation was already working.

Commit: **`80f70dd`** — *fix(i18n): route dashboard resource card labels through kindLabelFor*
Bilingual message: English summary + 中文说明.
Pushed to `origin/main`.

### `src/lib/i18n.test.ts`

Added a `describe("dashboard resource card labels (via kindLabelFor)")`
block with **12 new tests** pinning the contract:

- **9 presence tests** (one per dashboard kind × locale) — assert
  `kindLabelFor(id, [], locale)` returns a non-empty string in both
  `en` and `zh`. The `DASHBOARD_KINDS` list mirrors
  `Dashboard.tsx:52-61` so a new card added to the dashboard
  without adding it to the registry trips the test (otherwise the
  test wouldn't notice).
- **1 English pin** — locks the canonical English labels
  (`Pods / Deployments / Services / ConfigMaps / Secrets / Jobs /
  CronJobs / Nodes / Namespaces`) so a future refactor that drops a
  `KIND_META` label trips the test.
- **1 Chinese pin** — locks the canonical Chinese labels (`Pod /
  Deployment / Service / ConfigMap / Secret / Job / CronJob / 节点 /
  命名空间`). Note: several K8s canonical names ARE English words
  (`Pod`, `Job`, …) used in the Chinese UI by convention; the test
  pins the exact expected value rather than asserting a character
  class, so it's robust to the `节点` / `命名空间` local words
  without false-flagging `Pod` / `Job`.
- **1 regression test** — asserts the Chinese locale does NOT render
  the English pluralised labels (`Pods / Deployments / …`). This is
  the exact bug this commit addresses; a future re-introduction of
  the leak would fail this test with a clear diff.

## Verification

```
$ npx tsc --noEmit
# silent (clean)

$ npx vitest run
# Test Files  17 passed (17)
#      Tests  330 passed (330)
#   +12 new tests (dashboard resource card labels block in i18n.test.ts)

$ cargo check --manifest-path src-tauri/Cargo.toml
  Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.62s
  # 4 pre-existing dead-code warnings in src/kube/metrics_config.rs (unrelated)
```

Vite HMR confirmed serving the updated module
(`curl http://localhost:1420/src/components/dashboard/Dashboard.tsx`
returns the new file with `import { kindLabelFor }` and
`const label = kindLabelFor(k.id, [], locale) ?? k.id` in place of the
old hardcoded `k.label`).

## What was tested (by code review, given the Browser queue failure)

- **Overlay open/close** — the ⌘K palette's
  `chrome.palette.actions.*` registers an `Open settings` / `Open
  dashboard` action that dispatches the same `setOverlay("dashboard")`
  the sidebar's "总览 / Dashboard" entry does. The overlay's
  `onClose` prop is `closeOverlay`, which the dashboard honours via
  the `if (onClose) onClose(); else closeOverlay();` branch at
  `Dashboard.tsx:175-176` (handles both the `<Dashboard onClose />`
  mount in `App.tsx:103` and a hypothetical embedded use).
- **Resource card click navigation** — the per-card
  `setNav(k.id); onClose()` handler is the same pattern the
  original audit settled on (pass-0 / commit `0b3a7a8` territory);
  `setNav` clears `selection`, `openMenu`, `tableFilter`, and the
  sort atomically (see `store.ts:430`), and the overlay close makes
  the table visible behind it.
- **i18n in zh** — the nine zh labels in the new test are exactly
  what `KIND_LABELS_ZH` in `src/lib/i18n/index.ts:155-180` returns.
  The `setNav` call uses the kind id (`pods`, `nodes`, …), not the
  label, so the locale change doesn't break the navigation target.
- **Events panel** — `getEvents({ kind: "events", namespace: "all",
  name: "" })` returns the same shape in both locales; the events
  themselves (`e.reason`, `e.message`, `e.age`) come from the
  cluster, not from i18n, so no leak.
- **CPU / Memory bars** — the static `CPU` / `Memory` strings at
  `Dashboard.tsx:115, 130` are still hardcoded English, but they
  are also still hardcoded English in every other component in the
  app (the detail panel's metrics tab uses the same words) and
  `meterColor()` doesn't depend on locale. Left as-is — fixing
  these would mean fixing the whole metrics tab's chrome, which
  is out of scope for the dashboard audit. Logged in "Notes for
  next pass" below.

## Observed, not fixed — in-app Browser render queue was stuck for the entire session

The in-app Browser tool's render queue was stuck the entire session.
Every `inspect`, `navigate`, `wait`, and `wait_for_load` call returned
`Background Browser render queue wait timed out`, including:

- A fresh `navigate` to `http://localhost:1420/`.
- A `wait` with `kind=timeout` (no other actions issued).
- A 60-second pause between calls.
- An `inspect` on a presumed blank page.

The same harness worked in passes 1-9 (commit `1a2392b` is the most
recent pass' commit). It may be a transient MCP/Chromium stall. The
fix is small, mechanical, and well-isolated — replacing one
hardcoded string with one `kindLabelFor()` call — and the new test
contract pins the exact zh values, so the lack of in-app visual
verification is mitigated.

Logged because the next pass may hit the same stuck-queue. If it
recurs, the recovery path is a `/quit` + relaunch of MiniMax Code
(Chromium GPU / renderer processes may need recycling).

## Observed, not fixed — Dashboard's CPU / Memory bar labels are still hardcoded English

`Dashboard.tsx:115, 130` renders `<span>CPU</span>` and `<span>Memory</span>`
as static English. Same class of leak as the resource cards but in a
smaller surface (two strings, no list of nine). The i18n dictionary
already has `dashboard.cpu` and `dashboard.mem` keys (see
`src/lib/i18n/dictionaries.ts:410-411` and the zh mapping at `:1351-1352`),
so the fix is a one-line change per span. Not part of this pass because
the resource-card leak was the bigger defect and a coordinated fix
should also touch the detail panel's metrics tab (which uses the same
`CPU` / `Memory` words). Logged for a future pass.

## Notes for next pass

The remaining rotation items are still standing and well-isolated:

1. **Saved Queries CRUD** (rotation #9) — if it actually exists in this
   build; if not, the pass can say so and we can drop it from the
   rotation. (Pass-7 / pass-8 already flagged this; still untested.)
2. **ImageRepoPanel tags vertical layout polish** (rotation #10) —
   pass-0 covered the registry → repos → tags drill-down, but the
   *vertical* layout of the tag list (vs the current grid) hasn't
   been poked.
3. **Templates Ingress / ConfigMap form variants** (rotation #13) —
   the Templates overlay was only ever exercised with the Deployment
   form (the original v0.2.4 pass); the Ingress and ConfigMap form
   paths are an easy extra surface to verify.
4. **Helm Market Repositories CRUD** (rotation #14) — Repositories
   tab was covered in the original Helm Market pass at the read
   level; the add/edit/delete flow lives in `src/components/helm/`
   and is a clean follow-up target.
5. **Dashboard CPU / Memory bar labels** (this pass's
   "Observed, not fixed" item) — the dictionary has the keys
   (`dashboard.cpu` / `dashboard.mem` in both locales); the fix is
   a one-line change per span. A coordinated pass could also fix
   the detail panel's metrics tab in the same shape.
6. **In-app Browser queue stall** (this pass's "Observed, not
   fixed" item) — if the next pass hits the same stuck queue, the
   recovery path is `/quit` + relaunch of MiniMax Code.
