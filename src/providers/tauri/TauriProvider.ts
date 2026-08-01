/**
 * TauriProvider — implements DataProvider by invoking Rust commands
 * and listening to Tauri events.
 *
 * This is the only file in `src/providers/tauri/` that knows about
 * `@tauri-apps/api`. Components never import this directly; they get
 * the provider via the `useProvider()` hook (see ../index.ts).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

import type {
  ClusterInfo,
  ContextInfo,
  ClusterStatus,
  DataProvider,
  ForwardInfo,
  LogHandle,
  LogLine,
  LogOptions,
  ResourceRef,
  ResourceSnapshot,
  Row,
  Unsub,
} from "../types";

/** Tauri event names — must match the names emitted from
 *  `src-tauri/src/kube/{watchers,manager,logs}.rs`. */
const EV = {
  RESOURCE_UPDATE: "resource-update",
  CLUSTER_STATUS: "cluster-status",
  WATCH_STATUS: "watch-status",
  logLine: (id: string) => `log-line:${id}`,
  logClosed: (id: string) => `log-closed:${id}`,
} as const;

/** Backend field naming: snake_case in Rust → camelCase in TS. */
type Camel<S extends string> = S extends `${infer A}_${infer B}`
  ? `${A}${Capitalize<B>}`
  : S;
type Camelize<T> = { [K in keyof T as Camel<K & string>]: T[K] };

/** Helper: convert a single Tauri command response. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export class TauriProvider implements DataProvider {
  // ---- context ----

  listContexts(): Promise<ContextInfo[]> {
    return call<ContextInfo[]>("list_contexts");
  }

  async connect(context: string): Promise<ClusterInfo> {
    return call<ClusterInfo>("connect", { context });
  }

  async disconnect(): Promise<void> {
    await call<void>("disconnect");
  }

  // ---- resource read / write ----

  async getYaml(ref: ResourceRef): Promise<string> {
    const detail = await call<Camelize<{ kind: string; name: string; namespace: string; yaml: string }>>(
      "get_yaml",
      { kind: ref.kind, namespace: ref.namespace ?? null, name: ref.name },
    );
    return detail.yaml;
  }

  async applyYaml(ref: ResourceRef, text: string): Promise<void> {
    await call<void>("apply_yaml", {
      kind: ref.kind,
      namespace: ref.namespace ?? null,
      name: ref.name,
      yaml: text,
    });
  }

  async dryRunYaml(
    ref: ResourceRef,
    text: string,
  ): Promise<{ current: string; proposed: string }> {
    return call("dry_run_yaml", {
      kind: ref.kind,
      namespace: ref.namespace ?? null,
      name: ref.name,
      yaml: text,
    });
  }

  async getEvents(ref: ResourceRef): Promise<Row[]> {
    return call<Row[]>("get_events", {
      namespace: ref.namespace ?? null,
      name: ref.name,
    });
  }

  // ---- mutations (P3) ----

  async deleteResource(ref: ResourceRef): Promise<void> {
    await call<void>("delete_resource", {
      kind: ref.kind,
      namespace: ref.namespace ?? null,
      name: ref.name,
    });
  }

  async scaleResource(ref: ResourceRef, replicas: number): Promise<void> {
    await call<void>("scale_resource", {
      kind: ref.kind,
      namespace: ref.namespace ?? null,
      name: ref.name,
      replicas,
    });
  }

  async restartPod(ref: ResourceRef): Promise<void> {
    await call<void>("restart_pod", {
      namespace: ref.namespace ?? null,
      name: ref.name,
    });
  }

  async restartRollout(ref: ResourceRef): Promise<void> {
    await call<void>("restart_rollout", {
      kind: ref.kind,
      namespace: ref.namespace ?? null,
      name: ref.name,
    });
  }

  async setCordon(node: string, unschedulable: boolean): Promise<void> {
    await call<void>("set_cordon", { node, unschedulable });
  }

  async drainNode(node: string): Promise<void> {
    await call<void>("drain_node", { node });
  }

  // ---- shell / exec (P4 stub) ----

  async execPod(
    name: string,
    namespace: string,
    container: string | null,
    command: string[],
  ) {
    const r = await call<{
      stdout: string;
      stderr: string;
      exit_code: number;
      duration_ms: number;
    }>("exec_pod", { name, namespace, container, command });
    return {
      stdout: r.stdout,
      stderr: r.stderr,
      exitCode: r.exit_code,
      durationMs: r.duration_ms,
    };
  }

  async startLogStream(
    ref: ResourceRef,
    container: string | null,
    opts: LogOptions,
    onLine: (line: LogLine) => void,
    onClosed?: (reason: string) => void,
  ): Promise<LogHandle> {
    const id = await invoke<string>("start_log_stream", {
      namespace: ref.namespace ?? "default",
      pod: ref.name,
      container: container ?? null,
      tail: opts.tail ?? 200,
      previous: opts.previous ?? false,
      timestamps: true,
    });

    // Subscribe to per-line events for this stream.
    const u1 = await listen<LogLine>(EV.logLine(id), (e) => onLine(e.payload));
    const u2 = await listen<{ reason: string }>(EV.logClosed(id), (e) => {
      onClosed?.(e.payload.reason);
    });
    const unsubs = [u1, u2];

    return {
      stop: () => {
        for (const u of unsubs) {
          try { u(); } catch { /* noop */ }
        }
        invoke("stop_log_stream", { streamId: id }).catch(() => {});
      },
    };
  }

  // ---- port-forward (P4 stub) ----

  async startPortForward(
    kind: string,
    name: string,
    namespace: string,
    localPort: number,
    remotePort: number,
  ): Promise<ForwardInfo> {
    return call<ForwardInfo>("start_port_forward", {
      kind,
      name,
      namespace,
      localPort,
      remotePort,
    });
  }

  async stopPortForward(id: string): Promise<void> {
    await call<void>("stop_port_forward", { id });
  }

  async listPortForwards(): Promise<ForwardInfo[]> {
    return call<ForwardInfo[]>("list_port_forwards");
  }

  // ---- event subscriptions ----

  onResourceUpdate(cb: (snap: ResourceSnapshot) => void): Unsub {
    const un: Promise<UnlistenFn> = listen<ResourceSnapshot>(EV.RESOURCE_UPDATE, (e) =>
      cb(e.payload),
    );
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }

  onClusterStatus(cb: (status: ClusterStatus) => void): Unsub {
    const un: Promise<UnlistenFn> = listen<ClusterStatus>(EV.CLUSTER_STATUS, (e) =>
      cb(e.payload),
    );
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }

  onWatchStatus(cb: (active: number) => void): Unsub {
    const un: Promise<UnlistenFn> = listen<number>(EV.WATCH_STATUS, (e) =>
      cb(e.payload),
    );
    return () => {
      un.then((fn) => fn()).catch(() => {});
    };
  }
}
