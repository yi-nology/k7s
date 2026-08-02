/**
 * Shared connect flow used by both the initial bootstrap and the cluster
 * switcher. Sets the UI to "connecting", clears any previous cluster's data, then
 * connects and records the result (or a friendly error on failure).
 *
 * The real backend re-emits fresh resource snapshots when its watchers start; the
 * MockProvider re-emits on `connect()` — so clearing data here is safe for both.
 *
 * Race protection: `connectTo` is fired by every cluster-switcher click. A user
 * who clicks A then B before A's provider round-trip finishes would otherwise
 * commit A's success *after* B's, briefly flipping the chrome to the wrong
 * cluster. The `currentToken` monotonic counter is bumped on every entry; only
 * the most recent call writes to the store, so a stale resolution is a no-op.
 */

import type { DataProvider } from "../providers/types";
import { getProvider } from "../providers";
import { useStore } from "../store";

/** Monotonic request id. Bumped on every call; only the latest call writes. */
let currentToken = 0;

export async function connectTo(
  context: string,
  provider: DataProvider = getProvider(),
): Promise<void> {
  const myToken = ++currentToken;
  const store = useStore.getState();

  // Enter the connecting state and wipe the previous cluster's rows/metrics/etc.
  store.setConnection({ phase: "connecting", context, error: undefined });
  store.resetData();

  try {
    const info = await provider.connect(context);
    // A newer connectTo overtook us while we were awaiting — leave the chrome
    // to whatever the latest call is about to commit. Without this guard, the
    // user sees the wrong cluster name (and the wrong data, for a real backend
    // that re-emits on connect) for as long as it takes the older in-flight
    // call to resolve.
    if (myToken !== currentToken) return;
    store.setConnection({
      phase: "connected",
      context: info.context,
      clusterName: info.clusterName,
      error: undefined,
    });
  } catch (e) {
    if (myToken !== currentToken) return;
    store.setConnection({
      phase: "error",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
