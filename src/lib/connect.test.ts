/**
 * Tests for the cluster connect flow. The state machine lives in `connectTo` and
 * is hit both by the initial bootstrap and by every click on the cluster
 * switcher.
 *
 * The race that matters: a user clicks A then B before A's provider round-trip
 * finishes. Without the request-token guard, A's success would commit *after*
 * B's, briefly flipping the chrome to the wrong cluster name (and, for a real
 * backend that re-emits on connect, to the wrong data). The guard makes a
 * stale resolution a no-op.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { connectTo } from "./connect";
import { useStore } from "../store";
import { MockProvider } from "../providers/mock/MockProvider";
import type { ClusterInfo } from "../providers/types";

const CLUSTER_INFO = (ctx: string): ClusterInfo => ({
  context: ctx,
  clusterName: `${ctx}-cluster`,
  server: "https://mock.local:6443",
  version: "v1.31",
});

/** Wire a `connect` override onto a fresh MockProvider. */
function providerWith(connect: (ctx: string) => Promise<ClusterInfo>): MockProvider {
  const p = new MockProvider();
  // The connect method is the only one `connectTo` touches; the rest of the
  // MockProvider surface stays defaulted (no-op for these tests).
  (p as { connect: MockProvider["connect"] }).connect = connect;
  return p;
}

beforeEach(() => {
  useStore.setState({
    connection: { phase: "idle", context: null, clusterName: null },
  });
});

describe("connectTo — single call", () => {
  it("commits the connected state on success", async () => {
    const provider = providerWith(async (ctx) => CLUSTER_INFO(ctx));
    await connectTo("A", provider);
    const c = useStore.getState().connection;
    expect(c.phase).toBe("connected");
    expect(c.context).toBe("A");
    expect(c.clusterName).toBe("A-cluster");
    expect(c.error).toBeUndefined();
  });

  it("commits the error state on failure", async () => {
    const provider = providerWith(async () => {
      throw new Error("kaboom");
    });
    await connectTo("A", provider);
    const c = useStore.getState().connection;
    expect(c.phase).toBe("error");
    expect(c.error).toBe("kaboom");
  });

  it("passes a non-Error throw through `String(e)`", async () => {
    const provider = providerWith(async () => {
       
      throw "raw string";
    });
    await connectTo("A", provider);
    expect(useStore.getState().connection.error).toBe("raw string");
  });
});

describe("connectTo — race protection", () => {
  it("ignores a stale success when a newer call is in flight", async () => {
    // A is held back; B resolves immediately.
    let resolveA!: (info: ClusterInfo) => void;
    const provider = providerWith(async (ctx) => {
      if (ctx === "A") return new Promise<ClusterInfo>((r) => (resolveA = r));
      return CLUSTER_INFO(ctx);
    });

    // Record every clusterName the store ever commits.
    const seen: string[] = [];
    const unsub = useStore.subscribe((s) => {
      if (s.connection.phase === "connected" && s.connection.clusterName) {
        seen.push(s.connection.clusterName);
      }
    });

    const pA = connectTo("A", provider);
    const pB = connectTo("B", provider);
    await pB;
    expect(useStore.getState().connection.clusterName).toBe("B-cluster");

    // A resolves *after* B — the fix must drop this on the floor.
    resolveA(CLUSTER_INFO("A"));
    await pA;

    // Final state is B, and the chrome never showed A.
    const c = useStore.getState().connection;
    expect(c.phase).toBe("connected");
    expect(c.context).toBe("B");
    expect(c.clusterName).toBe("B-cluster");
    expect(seen).toEqual(["B-cluster"]);

    unsub();
  });

  it("ignores a stale failure when a newer call is in flight", async () => {
    // A will fail; B succeeds. Without the guard, A's rejection would
    // overwrite B's "connected" state with an "error".
    let rejectA!: (e: Error) => void;
    const provider = providerWith(async (ctx) => {
      if (ctx === "A") return new Promise<ClusterInfo>((_r, rej) => (rejectA = rej));
      return CLUSTER_INFO(ctx);
    });

    const pA = connectTo("A", provider);
    const pB = connectTo("B", provider);
    await pB;
    expect(useStore.getState().connection.phase).toBe("connected");

    rejectA(new Error("A failed"));
    await pA;

    // B's "connected" state is preserved.
    const c = useStore.getState().connection;
    expect(c.phase).toBe("connected");
    expect(c.context).toBe("B");
    expect(c.clusterName).toBe("B-cluster");
  });

  it("lets the latest call commit when three are in flight", async () => {
    // A → B → C in quick succession; only C should commit.
    let resolveA!: (info: ClusterInfo) => void;
    let resolveB!: (info: ClusterInfo) => void;
    const provider = providerWith(async (ctx) => {
      if (ctx === "A") return new Promise<ClusterInfo>((r) => (resolveA = r));
      if (ctx === "B") return new Promise<ClusterInfo>((r) => (resolveB = r));
      return CLUSTER_INFO(ctx);
    });

    const pA = connectTo("A", provider);
    const pB = connectTo("B", provider);
    const pC = connectTo("C", provider);
    await pC;
    expect(useStore.getState().connection.context).toBe("C");

    // B resolves — stale, dropped.
    resolveB(CLUSTER_INFO("B"));
    await pB;
    // A resolves — also stale, dropped.
    resolveA(CLUSTER_INFO("A"));
    await pA;

    const c = useStore.getState().connection;
    expect(c.phase).toBe("connected");
    expect(c.context).toBe("C");
    expect(c.clusterName).toBe("C-cluster");
  });
});

describe("connectTo — initial connecting state", () => {
  it("flips to the new context as soon as the new call starts", async () => {
    // The chrome must say "connecting to B" *before* B's await resolves,
    // because that's how the user knows the click landed.
    let resolveB!: (info: ClusterInfo) => void;
    const provider = providerWith(async (ctx) => {
      if (ctx === "B") return new Promise<ClusterInfo>((r) => (resolveB = r));
      return CLUSTER_INFO(ctx);
    });

    void connectTo("A", provider);
    expect(useStore.getState().connection.phase).toBe("connecting");
    expect(useStore.getState().connection.context).toBe("A");

    void connectTo("B", provider);
    expect(useStore.getState().connection.phase).toBe("connecting");
    expect(useStore.getState().connection.context).toBe("B");

    // Let B resolve so the test exits cleanly.
    resolveB(CLUSTER_INFO("B"));
  });
});
