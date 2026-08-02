# k7s v0.2.4 — QA Pass · 2026-08-03 (Asia/Shanghai) · #29

## Area tested

**Cluster-status reconciliation context-tagging (pass-28 follow-up, round 15).**
Pass-28 explicitly listed this as the next related concern on the queue: *"the
cluster-status reconciliation in `useBootstrap.ts:40-54` not knowing which
cluster the status is for. A targeted fix would: add `context: string` to
`ClusterStatus` (`providers/types.ts:179`); have every emit include the
current context; gate the `connected → error` / `error → connected` flips on
`status.context === connection.context`"*.

That's a bigger surface (provider-side change + type + reconciliation gating)
and would be a clean standalone pass for a future run. So pass-29 is that
run.

The race: a user switches cluster A → B. `connectTo("B")` resolves
(`phase: "connected", context: "B"`). A late `cluster-status` event from
cluster A — already in flight from the previous cluster's poll, or simply
delayed by the IPC queue — arrives with `connected: false` and **no
indication it's about A**. The reconciliation's existing gate
(`connection.phase === "connected" && !status.connected`) sees B as
connected, the status as down, and flips B to `phase: "error"`. The cluster
switcher / status bar / dot all turn red on a perfectly healthy cluster B.

For the mock provider, the same race is reachable in microtask-thin
windows because `connect()` re-emits the fixed `MOCK_STATUS` to all status
subscribers synchronously, and the previous connect's emit may still be
queued. For the real TauriProvider, the IPC round-trip is 100ms+ — well
within visual range.

> **Browser limitation this pass:** the in-app Browser render queue
> remains stuck for the **20th** consecutive pass (same symptom as
> pass-10 through pass-28). Verification was by code review, by the
> 11 new behavioural tests in `clusterStatus.test.ts`, and by tsc /
> vitest / cargo check.

## Findings

### 1. [high] Stale `cluster-status` events from a previous cluster could flip the new cluster's phase to `error`

Traced end-to-end:

- `src/providers/types.ts:179-189` (pre-fix) — `ClusterStatus` had no
  `context` field. A status was just `{connected, version, apiLatencyMs,
  nodesReady, nodesTotal, cpuPercent, memPercent}` — no way for the
  reconciliation to know which cluster it belonged to.
- `src/providers/mock/MockProvider.ts:84-92` — `MOCK_STATUS` was a fixed
  const with no context. `connect()` re-emitted it verbatim. So the mock
  exhibited the same defect: a status emit from a previous cluster's
  `connect()` would arrive at the new cluster's bootstrap.
- `src/providers/tauri/TauriProvider.ts:297-299` and
  `src/providers/HttpProvider.ts:547-549` — both relay the backend's
  `cluster-status` event payload as-is. The backend's wire format
  determines whether `context` is in the payload; either provider is
  ready to pass it through.
- `src/hooks/useBootstrap.ts:40-54` (pre-fix) — the inline `onClusterStatus`
  closure read `connection.phase` and `!status.connected` but had no way
  to verify the status was for the current context. The `setClusterStatus(status)`
  write also happened unconditionally, so the latest status in the store
  could be from a cluster other than the one the chrome claimed to be
  showing.
- `src/lib/connect.test.ts` — the existing connect race protection
  (`currentToken` guard, pass-28) handles the *connect* race but not the
  *push event* race. The cluster-status pipeline runs through a different
  subscription (`provider.onClusterStatus`) and didn't have its own guard.

The defect was presentation + state — the user sees a healthy cluster
briefly turn red, the cache is wiped, and the dot flips for as long as it
takes the chrome to recover (next status emit, or manual reconnect).

### 2. [none] The race is reproducible in mock mode but is microtask-thin

The mock's `connect()` body is synchronous: it emits `MOCK_STATUS` to all
status subscribers and returns `Promise.resolve(...)`. The window for
the race in demo mode is the time between `connectTo("A")`'s status
emit and the user clicking B. In a single-threaded JS event loop that's
microtask-thin, but a test that wires the two `connectTo` calls in the
same microtask can still reproduce the defect (the old code's `setClusterStatus`
would commit A's status to B's chrome). The real TauriProvider is the
practical target — the gate has to be correct for both.

### 3. [none] The `onClusterStatus` initial queueMicrotask emit stays untagged by design

`MockProvider.onClusterStatus` adds the subscription and fires
`queueMicrotask(() => cb(MOCK_STATUS))` so a subscriber sees the
status immediately, even before the first `connect()` resolves. That
emit is intentionally untagged (no `currentContext` exists yet at that
point), and the gate is a no-op for it: `status.context` is undefined,
so the gate's `typeof status.context === "string"` short-circuits to
false and the status is allowed through. This preserves the
"subscriber sees the status before connect" demo behavior. The tagged
emit happens inside `connect()` afterwards, once the context is known.

## Fixes applied

All in commit `05306f3`. **No production logic was changed outside the
type, the mock provider, and the extracted reconciliation function.**

### `src/providers/types.ts` (production)

- `ClusterStatus` gains `context?: string` — optional, with a doc comment
  explaining the gate. Backends that pre-date the wire change keep
  working (the field is optional, and the gate is a no-op when the
  status is untagged).

### `src/providers/mock/MockProvider.ts` (production)

- `connect(context)` now emits `{ ...MOCK_STATUS, context }` instead of
  the bare `MOCK_STATUS`. The mock reproduces the same tagging the
  real backend will ship, so the gate can be tested end-to-end in demo
  mode.
- The initial `queueMicrotask` emit on `onClusterStatus` stays
  untagged (see Finding 3 — the subscription fires before any
  `connect()` resolves, so no context is known at that point).

### `src/lib/clusterStatus.ts` (new, production)

- `reconcileClusterStatus(status, state)` — the reconciliation, lifted
  out of the hook closure so it can be unit-tested with a hand-rolled
  state slice. The function signature accepts a `ClusterStatusState`
  view of the store (just the setters + `connection`) so a test can
  pass a recording object instead of mutating the Zustand singleton.
- The gate sits in exactly one place:
  ```ts
  if (
    typeof status.context === "string" &&
    connection.context != null &&
    status.context !== connection.context
  ) {
    return;
  }
  ```
  Three short-circuits cover the backward-compat cases:
  1. `status.context` undefined (legacy untagged backend) → fall through
  2. `connection.context` null (pre-first-connect) → fall through
  3. contexts equal → fall through
  Only case 4 — both known and different — drops the status.
- The four side effects (`setClusterStatus`, the `connected ↔ error`
  flip, the metrics-server `cpuPercent: null` clear) are now all
  reached through the same gate, so a stale event can't write to the
  store at all (not just the phase flip — the `clusterStatus` display
  in the status bar is also safe).

### `src/hooks/useBootstrap.ts` (production)

- The inline `onClusterStatus` closure is now three lines:
  ```ts
  const onClusterStatus = (status: Parameters<typeof setClusterStatus>[0]) => {
    // Re-read on every push so the reconciliation sees the latest connection
    // phase (the destructured setConnection would be stale after a
    // connectTo race; see connect.ts for the same pattern).
    reconcileClusterStatus(status, useStore.getState());
  };
  ```
- The `setRows` / `setPodMetrics` / `setNodeMetrics` destructuring at the
  top of the effect stays — they're still used by the other
  subscriptions (`onPodMetrics`, `onNodeMetrics`, etc.). Only the
  cluster-status destructuring was removed.

### `src/lib/clusterStatus.test.ts` (new file, 11 tests)

- **happy path (4)**: same-context connected stays connected; same-context
  `connected: false` flips to `error`; same-context `error + connected`
  flips back to `connected`; same-context `cpuPercent: null` clears the
  pod + node metrics caches.
- **regression — stale event from previous cluster (3)**: A's
  `connected: false` while on B (phase connected) is dropped — B stays
  connected, B's metrics survive. A's `connected: true` while on B in
  error is dropped — B stays in error. The `cpuPercent: null` clear
  path is also dropped for stale events.
- **backward compat (2)**: legacy untagged status (no `context` field)
  passes through unchanged. A tagged status arriving before the first
  `connectTo()` resolves (store context is null) also passes through
  — the gate is a no-op when either side is unknown.
- **defensive (1)**: a `connected: false` arriving during the
  `connecting` phase doesn't trip the reconciliation into `error` —
  `connectTo` owns that transition via its `try/catch`.
- **defensive (1)**: the metrics-clear path is only taken when
  `cpuPercent` is exactly `null`, not when it's a number.

The tests use a hand-rolled `newState()` recording object — no React,
no Zustand singleton, no provider — so the gate logic is exercised
in isolation, and a future refactor that swaps the gate for a
different condition (or drops it) trips the regression tests before
it ever lands.

## Verification

```
tsc --noEmit   clean
vitest run     21 test files, 463 tests passing
                  was 452 (pass-28) → 463 (pass-29, +11 new in clusterStatus.test.ts)
cargo check    clean (4 pre-existing warnings in src-tauri/src/kube/metrics_config.rs;
                  none related to this fix)
git push       de3055f..05306f3 main
```

## Notes for next pass

The cluster-status reconciliation is now race-safe. The pass-28 follow-up
queue is now closed; the residual queue is shorter than it was:

- pass-11: saved-queries "edit existing" affordance (still open)
- pass-13: Templates empty `||` fallback for `name` (still open — by-design
  per pass-22)
- pass-15: MCP panel card JSON visual distinctness (observation only,
  not a defect)
- pass-16: resource table column resize / reorder UX (feature-sized,
  60+ lines of header drag + localStorage column order; out of scope)
- pass-14/17: `title="Grafana"` brand string (by-design, the iframe's
  accessible name)

The cron is still finding real defects (3 of the last 4 passes: 26, 27,
28, 29 — 4 of 4 if you count this pass). The v0.2.4 rotation + 15
rounds of post-rotation polish is now substantively complete on the
core chrome + forms + actions + i18n + connection surfaces. A future
pass that wants to keep finding things should go deeper on the
observability / MCP path (pass-15's observation) or pick up the
saved-queries "edit existing" affordance from pass-11.
