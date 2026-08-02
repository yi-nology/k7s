# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #26

## Area tested

**Multi-namespace bulk action confirmations** (pass-23 follow-up, round 12).

The pass-23 follow-up called this out specifically: *"the only bulk action
that could span namespaces is delete, and the `applyBulk` plumbing already
does per-row ref resolution, but the test surface is unproven."*

The plumbing is correct — `refOf(row)` at `ActionList.tsx:104` builds a
`ResourceRef` with `namespace: row.namespace` for every row, and `runBulk`
fires the action per row, so the *execution* is per-namespace as the user
expects. The defect is one level up: the **confirmation dialog** (the
"Delete 3 pods? (a, b, c)" string) only enumerates names, with no namespace
context. A user with the namespace picker on `all` who selects 2 pods
named `api` in `default` and `kube-system` sees `Delete 2 pods? (api, api)`
— a dialog that gives them no way to tell they're acting across
namespaces, with the matching RBAC and ownership implications.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **17th** consecutive pass (same symptom as
> pass-10 through pass-25). Verification was by code review, by the 6
> new behavioural tests in `actions.test.ts`, and by tsc / vitest /
> cargo check.

## Findings

### 1. [high] Cross-namespace bulk confirmations had no namespace context

Traced end-to-end:

- `actions.ts:174-179` — `listNames` joined `r.name` with no namespace
  awareness. The function is the single source of truth for the names
  shown in a confirmation (`confirmText` is its only caller in the
  production tree), so a fix here lands in every confirm path at once.
- `actions.ts:189-216` — `confirmText` builds `names = " (" + listNames(rows) + ")"`,
  passed to the dict's `actions.confirm.*` functions. The dicts (EN + ZH)
  both template the names string verbatim, so changing the names format
  is the only edit needed to make the cross-namespace case unambiguous
  in both locales.
- `actions.ts:80-89` — the META table for the actions. `delete` is the
  only bulk-capable action on a namespaced kind that could plausibly
  span namespaces at scale; `restart` is also bulk-capable on pods and
  the same defect applies; `cordon`/`uncordon`/`drain` are nodes-only
  (cluster-scoped, no namespace) so they're not affected.
- `ActionList.tsx:104` — `refOf(row)` uses `row.namespace` per row, so
  execution is correctly per-namespace. The defect was presentation
  only.
- `selection.test.ts` — no cross-namespace test. The selection helper
  itself doesn't care about namespaces (uids are global, and the
  namespace filter is the table's, not the selection's), so the test
  gap was in `actions.test.ts`.

### 2. [none] The cross-namespace case is reachable from the UI

- The namespace picker at the top of the table can be set to `all`
  (`cluster` namespace id, per `connect.ts`). When set, the table filter
  at `ResourceTable.tsx:131-133` doesn't drop rows by namespace, so the
  user sees pods from every namespace the cluster has.
- A ⌘-click on a pod in `default` then a ⌘-click on a pod in
  `kube-system` (same name, different context) is the canonical
  failure mode — and it's the one the user would never see coming
  from the dialog.
- The mock provider's data is all in `default` namespace
  (`MockProvider.ts:569, 668, 778, 792, 801`), so the in-app visual
  loop can't reproduce this — but the real TauriProvider has whatever
  namespaces the cluster has, and the in-app filter is a no-op for
  `all`. The cross-namespace case is a real session the user can hit.

## Fixes applied

All in commit `58245d8`.

### `src/lib/actions.ts` (production)

- `listNames` now checks `sameNamespace(rows)`:
  - When every row has the same namespace (or all are cluster-scoped
    with `namespace: undefined`), the bare names are returned — the
    existing common-case UX doesn't shift.
  - When the rows' namespaces differ, each name is prefixed with
    `namespace/name` so the dialog reads
    `Delete 3 pods? (default/api, kube-system/api, monitoring/worker)`
    instead of `Delete 3 pods? (api, api, worker)`.
- The truncation path (`MAX_LISTED = 8`) operates on the row count, not
  the rendered string length, so the cross-namespace format
  "first 8 + `and N more`" is preserved — a long cross-namespace list
  is still bounded and still disambiguated.
- New private helper `formatName(r: Row)` — returns
  `r.namespace ? "${r.namespace}/${r.name}" : r.name` so cluster-scoped
  rows (nodes, namespaces) stay unprefixed even when mixed in.
- New private helper `sameNamespace(rows)` — uses `r.namespace ?? ""`
  for the comparison so `undefined` and `""` are treated as the same
  cluster-scoped value, and a degenerate empty input doesn't blow up.
- The doc comment on `confirmText` now explicitly calls out the
  cross-namespace behavior so a future reader sees the link between
  the two functions.

### `src/lib/actions.test.ts` (tests, +6)

- **`confirmText` — `prefixes each name with its namespace when the
  selection spans namespaces`** — the headline behavioural claim. Three
  pods in three different namespaces, the test asserts the names list
  contains `default/api, kube-system/api, monitoring/worker` *and* the
  count is still `3 pods` (so the namespace prefix doesn't change the
  shape of the dialog, only the disambiguation).
- **`confirmText` — `keeps the bare names when every row is in the same
  namespace`** — the non-regression test. Three pods in `prod`, the
  test asserts `a, b, c` is in the text and `prod/` is *not* — a
  refactor that accidentally introduced a prefix in the common case
  would fail this.
- **`listNames` — `prefixes each name with its namespace when the rows
  span namespaces`** — the direct unit test of the new behaviour with
  two same-named pods in different namespaces (the exact failure mode
  the user would hit).
- **`listNames` — `truncates a long cross-namespace list and preserves
  the prefixes`** — 12 rows alternating between `default` and
  `kube-system`. Two of the first 8 share a name (`p-0`); the test
  asserts both are disambiguated by the namespace prefix and the
  `and 4 more` tail is correct.
- **`listNames` — `leaves cluster-scoped names unprefixed`** — two
  rows with `namespace: undefined`; the bare names are returned (the
  nodes case).
- **`listNames` — `mixes prefixed and unprefixed names when the rows'
  namespaces differ`** — degenerate case (a table only shows one
  kind, but the helper stays consistent): one cluster-scoped row and
  one namespaced row → `node-1, default/api`. Pins that a
  refactor that always prefixed would fail this, and a refactor that
  always *omitted* the prefix for cluster-scoped rows (treating
  `undefined` as a no-op) would also fail this.

## Verification

- `npx tsc --noEmit` — **clean**. The new helpers are private and
  type-check against the existing `Row` interface.
- `npx vitest run` — **414 passed (408 → 414, +6 new)** across 19
  test files. The 6 new tests live in `src/lib/actions.test.ts`
  (27 → 33).
- `cargo check --manifest-path src-tauri/Cargo.toml` — **clean**
  (4 pre-existing dead-code warnings in `metrics_config.rs`,
  unchanged from pass-25).

Commit `58245d8` pushed to `origin/main`.

## Notes for next pass

The pass-23 follow-up queue is now closed (multi-namespace bulk
actions). The remaining follow-ups from the prior pass notes:

- pass-15: MCP panel card JSON visual distinctness (observation only —
  the three cards display similar-looking URL-shaped JSON, but each
  card is a different config so the visual is technically correct).
- pass-16: resource table column resize / reorder UX (feature-sized —
  60+ lines of header drag + localStorage column order; out of scope
  for these targeted passes).
- pass-14/17: `title="Grafana"` brand string (by-design, the iframe's
  accessible name; not a defect).

**Self-cleanup heuristic (per the cron instructions):** "If the
prior reports cover MOST of the rotation and last 3 passes found no
new issues → the cron is done." Last 3 passes:

- **pass-24** — found 1 real issue (`yamlDraft` dead state across
  3 actions) and fixed it.
- **pass-25** — found 0 issues; the resolution path was already
  correct. Added 8 tests as defensive coverage.
- **pass-26 (this pass)** — found 1 real issue (cross-namespace bulk
  confirmations had no namespace context) and fixed it.

Two of the last three passes found real defects and the third
strengthened existing coverage — the follow-up queue is still
productive. The residual queue is now genuinely small:

- MCP panel card visual distinctness (observation, not a defect)
- Resource table column resize/reorder (feature-sized, out of scope)
- `title="Grafana"` brand string (by-design)

The cron should keep running; a future pass that finds nothing new
*and* the residual queue shrinks further would be the signal to
delete the cron. For now: another targeted pass is the right call.
