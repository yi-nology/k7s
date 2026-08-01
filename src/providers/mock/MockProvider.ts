/**
 * MockProvider — minimal stub for demo mode (P0).
 *
 * P0 deliverable: the type signature and a no-op implementation that
 * lets the UI mount in a plain browser (`VITE_DEMO=1`) without a
 * cluster. Real fixture data lands with the design tokens in P5.
 */

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

export class MockProvider implements DataProvider {
  listContexts(): Promise<ContextInfo[]> {
    return Promise.resolve([
      { name: "demo", cluster: "demo-cluster", user: "demo", isCurrent: true },
    ]);
  }

  connect(_context: string): Promise<ClusterInfo> {
    return Promise.resolve({
      context: "demo",
      clusterName: "demo-cluster",
      server: "https://demo.example:6443",
      version: "v1.30.0 (mock)",
    });
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  getYaml(_ref: ResourceRef): Promise<string> {
    return Promise.resolve(
      "apiVersion: v1\nkind: Pod\nmetadata:\n  name: example\n",
    );
  }

  applyYaml(_ref: ResourceRef, _text: string): Promise<void> {
    return Promise.resolve();
  }

  dryRunYaml(_ref: ResourceRef, text: string) {
    return Promise.resolve({ current: text, proposed: text });
  }

  getEvents(_ref: ResourceRef): Promise<Row[]> {
    return Promise.resolve([]);
  }

  deleteResource(_ref: ResourceRef): Promise<void> {
    return Promise.resolve();
  }

  scaleResource(_ref: ResourceRef, _replicas: number): Promise<void> {
    return Promise.resolve();
  }

  restartPod(_ref: ResourceRef): Promise<void> {
    return Promise.resolve();
  }

  restartRollout(_ref: ResourceRef): Promise<void> {
    return Promise.resolve();
  }

  setCordon(_node: string, _unschedulable: boolean): Promise<void> {
    return Promise.resolve();
  }

  drainNode(_node: string): Promise<void> {
    return Promise.resolve();
  }

  execPod(
    _name: string,
    _namespace: string,
    _container: string | null,
    _command: string[],
  ) {
    return Promise.resolve({
      stdout: "(mock) command would run here",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
    });
  }

  startLogStream(
    _ref: ResourceRef,
    _container: string | null,
    _opts: LogOptions,
    _onLine: (line: LogLine) => void,
    _onClosed?: (reason: string) => void,
  ): Promise<LogHandle> {
    return Promise.resolve({ stop() {} });
  }

  startPortForward(
    _kind: string,
    _name: string,
    _namespace: string,
    _localPort: number,
    _remotePort: number,
  ): Promise<ForwardInfo> {
    return Promise.resolve({
      id: "mock-1",
      namespace: _namespace,
      pod: _name,
      remotePort: _remotePort,
      localPort: _localPort,
    });
  }

  stopPortForward(_id: string): Promise<void> {
    return Promise.resolve();
  }

  listPortForwards(): Promise<ForwardInfo[]> {
    return Promise.resolve([]);
  }

  onResourceUpdate(_cb: (snap: ResourceSnapshot) => void): Unsub {
    return () => {};
  }

  onClusterStatus(cb: (status: ClusterStatus) => void): Unsub {
    cb({
      connected: true,
      version: "v1.30.0 (mock)",
      apiLatencyMs: 12,
      nodesReady: 1,
      nodesTotal: 1,
      cpuPercent: 35,
      memPercent: 42,
    });
    return () => {};
  }

  onWatchStatus(cb: (active: number) => void): Unsub {
    cb(0);
    return () => {};
  }
}
