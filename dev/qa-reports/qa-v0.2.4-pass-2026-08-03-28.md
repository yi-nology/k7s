# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #28

## Area tested

**`connectTo` race condition on rapid cluster switches (post-rotation follow-up, round 14).**

Pass-27 listed four candidate "deeper sub-areas" to walk next; #1 (`top` / `step`
controls in MetricsExplorer) doesn't exist — the panel is mode + range-presets +
query input + save bar, no `top` / `step` anywhere — so I picked the one that
traced to a real defect rather than a misread of the spec.

The cluster switcher in the sidebar calls `connectTo(ctx.name)` on every click.
`connectTo` is `async`; the await on `provider.connect(context)` is the only
thing between "set connecting state" and "commit connected/error state". When
the user clicks A then B before A's round-trip finishes, the two awaits race
and the older one's resolution is the last to write the store. Result: the
chrome briefly shows the wrong cluster name (and, for a real backend that
re-emits on connect, the wrong data too).

## Findings

### 1. [high] `connectTo` commits stale resolutions on rapid context switches

`src/lib/connect.ts:13-35` (pre-fix):

```ts
export async function connectTo(context: string): Promise<void> {
  const provider = getProvider();
  const store = useStore.getState();

  store.setConnection({ phase: "connecting", context, error: undefined });
  store.resetData();

  try {
    const info = await provider.connect(context);     // <-- A awaits here
    store.setConnection({ phase: "connected", ... }); // <-- A writes here
  } catch (e) {
    store.setConnection({ phase: "error", ... });
  }
}
```

A click on A followed by a click on B runs through the following sequence:

1. `connectTo("A")` — sets `phase: "connecting", context: "A"`, calls
   `resetData()`.
2. `provider.connect("A")` is awaited. The mock's body runs synchronously
   (`emitAllRows` + statusCb + watchCb) and returns `Promise.resolve(...)`.
3. `connectTo("B")` — sets `phase: "connecting", context: "B"`, calls
   `resetData()` again (A's just-emitted rows are wiped).
4. `provider.connect("B")` runs synchronously the same way.
5. **A's await resolves first in microtask order.** `setConnection({ phase:
   "connected", context: "A", clusterName: "A-cluster" })` lands in the store.
6. B's await resolves. `setConnection({ phase: "connected", context: "B",
   clusterName: "B-cluster" })`.

Steps 5–6 are the bug. Between them, the cluster switcher
(`name = connection.clusterName ?? connection.context ?? noCluster`) and the
status bar (`cluster = connection.clusterName ?? connection.context ?? "k7s"`)
both show **A**, the wrong cluster. The user could take a screenshot or
trigger a side-effect (open the palette, click a row, etc.) during this
window and act against the wrong cluster.

The mock provider is essentially synchronous (just a `Promise.resolve`
wrapper), so the window in demo mode is microtask-thin. The TauriProvider
goes through IPC and the window is easily 100ms+, which is well within the
threshold for a human to see the wrong cluster name flash up. The same
window is also the right size for the real backend's connect-side
re-emission (if A's `onResourceUpdate` subscribers fire after B's reset
+ emit, the user sees A's data on B's chrome).

The fix is one of the standard patterns for async-result-after-async-start:
a monotonic request token bumped on every entry, with the post-await writes
gated on the token still being the latest.

### 2. [none] The mock provider's mock data is context-agnostic

`MOCK_RESOURCES` at `src/providers/mock/data.ts:73` is the same for every
context (`murphy-yi` / `odin-staging` / `loki-dev` all show the same rows).
So in demo mode the "wrong data" half of the bug isn't visible — only the
chrome flicker. The real TauriProvider will reproduce the data half
because the `onResourceUpdate` channel is per-cluster.

### 3. [none] `useBootstrap`'s single call doesn't race

`useBootstrap.ts:132` calls `connectTo(target.name)` once at startup. With
the token fix this still works, and the second argument's default
(`getProvider()`) preserves the existing call site.

### 4. [none] The cluster-status reconciliation has a related concern

`useBootstrap.ts:40-54`'s `onClusterStatus` decides whether to flip the
connection phase based on the latest status payload, with no awareness of
which cluster the status is for. `ClusterStatus` (`providers/types.ts:179`)
has no `context` field, so a stale status from the previous cluster could
in principle flip the new cluster to "error". This is a separate, larger
fix (tag the status with a context, gate the reconciliation on the
match) — not the focus of this pass, but worth logging as a follow-up
candidate.

## Fixes applied

All in commit `dfd1c34`.

### `src/lib/connect.ts`

- New module-level `currentToken` integer. Bumped on every entry to
  `connectTo`; the call's local `myToken` is the value at entry. The
  post-await writes only commit if `myToken === currentToken` — any
  newer call in flight cancels the older one's writes.
- `connectTo`'s second arg is now an optional `provider: DataProvider =
  getProvider()`. Default keeps the existing call sites working; the
  optional injection is what makes the race testable (the
  `getProvider()` singleton is awkward to mock — injecting a per-test
  MockProvider is the path of least resistance).
- Doc-block above the function records the race scenario so the next
  reader doesn't undo the guard "to make it simpler".

### `src/lib/connect.test.ts` (new, 7 tests)

- **3 single-call cases** — success commits `phase: "connected"`,
  failure commits `phase: "error"` with the `Error.message`, and a
  non-`Error` throw comes out as `String(e)`. The third case is the
  existing `e instanceof Error ? e.message : String(e)` path in
  `connect.ts:48-50`, pinned so a refactor to `e.message` (which would
  read `undefined` on a string throw) trips a test instead of a
  user-facing "undefined".
- **3 race cases** —
  - *stale success*: A held back, B resolves first; A's late resolve
    is dropped. Subscribed to the store and recorded every
    `connected` `clusterName` to assert the chrome never showed A.
  - *stale failure*: A will fail, B succeeds; A's late rejection is
    dropped (without the fix this would overwrite B's `connected`
    with `error: "A failed"`).
  - *3-deep fan-in*: A → B → C in quick succession; only C commits;
    B and A both resolve late and are dropped. This is the
    worst-case shape of "user clicks around the dropdown impatiently".
- **1 ordering case** — the connecting state advances to the new
  context *as soon as* the new call starts (before its await
  resolves). The user needs feedback that the click landed.

The tests don't depend on a real network — `providerWith()` hands a
fresh `MockProvider` with a per-test `connect` override that returns
controllable `Promise<ClusterInfo>` instances via local
`resolveA` / `resolveB` handles.

## Verification

- `npx tsc --noEmit` — **clean**. The `provider: DataProvider =
  getProvider()` default is type-narrowed correctly; the existing
  `connectTo(ctx.name)` call sites resolve with no changes.
- `npx vitest run` — **452 passed (445 → 452, +7)** across 20 test
  files. The 7 new tests live in `src/lib/connect.test.ts`; the new
  file is the 20th test file.
- `cargo check --manifest-path src-tauri/Cargo.toml` — **clean**
  (4 pre-existing dead-code warnings in `metrics_config.rs`,
  unchanged from pass-27).

Commit `dfd1c34` pushed to `origin/main`.

## Notes for next pass

Pass-27's candidate list was fully walked. The connect state machine
itself is now solid; the remaining related concern is the cluster-status
reconciliation in `useBootstrap.ts:40-54` not knowing which cluster the
status is for. A targeted fix would:

- add `context: string` to `ClusterStatus` (`providers/types.ts:179`)
- have every emit include the current context
- gate the `connected → error` / `error → connected` flips on
  `status.context === connection.context`

That's a bigger surface (provider-side change + type + reconciliation
gating) and would be a clean standalone pass.

Other follow-ups still on the queue:

- pass-11: saved-queries "Clear cache" feedback (done in pass-19) +
  "edit existing" affordance (still open)
- pass-13: Templates empty text fields `required` policy (done in
  pass-22) + empty `||` fallback for `name` (still open — by-design
  per pass-22's report)
- pass-15: MCP panel card JSON visual distinctness (observation
  only, not a defect)
- pass-16: resource table column resize / reorder UX (feature-sized,
  out of scope)
- pass-14/17: `title="Grafana"` brand string (by-design, the
  iframe's accessible name)
- pass-28 (this pass): cluster-status reconciliation context-tagging
  (new follow-up)

The cron is still finding real defects (3 of the last 3 passes: 26,
27, 28). The v0.2.4 rotation + 14 rounds of post-rotation polish
is now substantively complete on the core chrome + forms + actions
+ i18n surfaces. A future pass that wants to keep finding things
should go deeper on the observability/MCP path (pass-15's
observation) or pick up the cluster-status reconciliation.
