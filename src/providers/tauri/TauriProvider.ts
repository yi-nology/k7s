/**
 * TauriProvider — the real {@link DataProvider}, bridging to the Rust backend via
 * Tauri `invoke` (commands) and `listen` (events). Used in non-demo builds.
 *
 * Event names and payload shapes mirror src-tauri/src/kube/mod.rs (`events`) and
 * the DTOs there. The `on*` subscriptions return a synchronous unsubscribe that
 * detaches the underlying async Tauri listener once it's attached.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { exportFilename } from '../../lib/logview';
import { BaseRpcProvider } from '../BaseRpcProvider';
import type {
  ContextInfo,
  DataProvider,
  HelmOpResult,
  SavedQuery,
  NodeSample,
  ForwardInfo,
  PromQueryResult,
  ClusterStatus,
  CustomKind,
  DrainProgress,
  EventItem,
  ExportFromRegistryResult,
  HelmRevisionEntry,
  ImageSyncResult,
  ImportResult,
  KindId,
  LogHandle,
  LogLine,
  LogOptions,
  NodeMetricsMap,
  NodeShellHandle,
  NodeStatsError,
  PodFileEntry,
  PodMetricsMap,
  PodSample,
  ResourceRef,
  Row,
  SavedLog,
  ShellHandle,
  Unsub,
} from '../types';

/** Wire payload for the `resource-update` event. */
interface ResourceUpdatePayload {
  /** Built-in kind id, or a custom kind's "group/plural" id (B15). */
  kind: KindId;
  rows: Row[];
}

/**
 * Attach a Tauri event listener and return a synchronous unsubscribe. `listen` is
 * async, so we hold the unlisten fn once resolved and also guard against the
 * caller unsubscribing before attachment completes.
 */
function subscribe<T>(event: string, handler: (payload: T) => void): Unsub {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;

  void listen<T>(event, (e) => handler(e.payload)).then((fn) => {
    // If unsubscribed before the listener attached, detach immediately.
    if (cancelled) fn();
    else unlisten = fn;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export class TauriProvider extends BaseRpcProvider implements DataProvider {
  // ---- pod-stats fanout (see watchPodStats / onPodStats) ----
  //
  // A pod's Metrics tab is fed by filtering the cluster-wide `pod-metrics` event
  // down to the pods being watched, rather than a dedicated backend stream: the
  // poller is already running, so this is a pure client-side fanout.
  private watchedPods = new Set<string>();
  private podStatsCbs = new Set<(key: string, sample: PodSample) => void>();
  /** Lazily attached on the first onPodStats subscription; lives for the app. */
  private podMetricsFanout: Unsub | null = null;

  /** Bind the shared one-shot RPCs to Tauri's `invoke`. */
  protected rpc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return invoke<T>(cmd, args);
  }

  async importKubeconfig(): Promise<ImportResult | null> {
    // Lazy-import the dialog plugin so it isn't pulled into demo bundles.
    const { open } = await import('@tauri-apps/plugin-dialog');
    // Pre-point the dialog at kubectl's default kubeconfig for one-click import.
    const defaultPath = await invoke<string>('default_kubeconfig_path');
    const selected = await open({
      title: 'Import kubeconfig',
      multiple: false,
      directory: false,
      defaultPath: defaultPath || undefined,
    });
    // User cancelled, or (defensively) a multi-selection came back.
    if (!selected || Array.isArray(selected)) return null;
    const contexts = await invoke<ContextInfo[]>('import_kubeconfig', { path: selected });
    // The path goes back to the caller so it can be persisted (B17); only the
    // provider knows it, since the picker lives here.
    return { contexts, path: selected };
  }

  // getYaml, applyYaml, dryRunYaml, getProperties, deleteResource,
  // scaleResource, restartPod, restartRollout, listRevisions, undoRollout
  // are now inherited from BaseRpcProvider.

  getEvents(ref: ResourceRef): Promise<EventItem[]> {
    return invoke<EventItem[]>('get_events', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  // getProperties, deleteResource, scaleResource, restartPod,
  // restartRollout, listRevisions, undoRollout inherited from BaseRpcProvider.

  async setWindowTheme(theme: 'dark' | 'light'): Promise<void> {
    // Lazy-imported like the dialog plugin, so it isn't pulled into demo bundles.
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    // Cosmetic: a failure here leaves a mismatched titlebar, which is not worth
    // surfacing as an error over the app content.
    try {
      await getCurrentWindow().setTheme(theme);
    } catch {
      /* older webview / platform without theme control */
    }
  }

  // ---- node-exporter statistics (B27) ----

  // ---- per-pod statistics ----

  async watchPodStats(key: string): Promise<void> {
    // No backend call: the metrics poller already runs cluster-wide. This just
    // marks the pod so the fanout forwards its samples.
    this.watchedPods.add(key);
  }

  async unwatchPodStats(key: string): Promise<void> {
    this.watchedPods.delete(key);
  }

  // ---- push subscriptions ----

  // ---- custom (CRD-backed) kinds (B15) ----

  onCustomKinds(cb: (kinds: CustomKind[]) => void): Unsub {
    return subscribe<CustomKind[]>('custom-kinds', cb);
  }

  onResourceUpdate(cb: (kind: KindId, rows: Row[]) => void): Unsub {
    return subscribe<ResourceUpdatePayload>('resource-update', (p) => cb(p.kind, p.rows));
  }

  onPodMetrics(cb: (metrics: PodMetricsMap) => void): Unsub {
    return subscribe<PodMetricsMap>('pod-metrics', cb);
  }

  onNodeMetrics(cb: (metrics: NodeMetricsMap) => void): Unsub {
    return subscribe<NodeMetricsMap>('node-metrics', cb);
  }

  onClusterStatus(cb: (status: ClusterStatus) => void): Unsub {
    return subscribe<ClusterStatus>('cluster-status', cb);
  }

  onWatchStatus(cb: (activeStreams: number) => void): Unsub {
    return subscribe<number>('watch-status', cb);
  }

  onAiEvent(cb: (data: { runId: string; event: unknown }) => void): Unsub {
    return subscribe<{ runId: string; event: unknown }>('ai_event', cb);
  }

  onWatchKindStatus(cb: (kind: string, status: 'ok' | 'forbidden') => void): Unsub {
    return subscribe<{ kind: string; status: string }>('watch-kind-status', (payload) => {
      cb(payload.kind, payload.status as 'ok' | 'forbidden');
    });
  }

  onDrainProgress(cb: (progress: DrainProgress) => void): Unsub {
    return subscribe<DrainProgress>('drain-progress', cb);
  }

  onNodeStats(cb: (node: string, sample: NodeSample) => void): Unsub {
    return subscribe<{ node: string; sample: NodeSample }>('node-stats', (p) =>
      cb(p.node, p.sample)
    );
  }

  onNodeStatsError(cb: (err: NodeStatsError) => void): Unsub {
    return subscribe<NodeStatsError>('node-stats-error', cb);
  }

  onPodStats(cb: (key: string, sample: PodSample) => void): Unsub {
    this.podStatsCbs.add(cb);
    // Attach the shared `pod-metrics` fanout on first use. The backend doesn't
    // timestamp samples, so each poll is stamped with its arrival time here.
    this.podMetricsFanout ??= subscribe<PodMetricsMap>('pod-metrics', (map) => {
      if (this.watchedPods.size === 0) return;
      const ts = Date.now();
      for (const key of this.watchedPods) {
        const m = map[key];
        if (!m) continue;
        const sample: PodSample = { ts, cpuMillis: m.cpuMillis, memBytes: m.memBytes };
        for (const fn of this.podStatsCbs) fn(key, sample);
      }
    });
    return () => {
      this.podStatsCbs.delete(cb);
    };
  }

  // ---- log streaming ----

  async startLogs(
    ref: ResourceRef,
    container: string,
    opts: LogOptions,
    onLines: (lines: LogLine[]) => void,
    onClosed: (reason: string) => void
  ): Promise<LogHandle> {
    // Start the backend stream first so we know its id, then attach listeners to
    // the id-scoped events.
    const streamId = await invoke<string>('start_log_stream', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      tail: opts.tail ?? null,
      sinceTime: opts.sinceTime ?? null,
      sinceSeconds: opts.sinceSeconds ?? null,
      previous: opts.previous ?? false,
    });

    const offLine = subscribe<{ lines: LogLine[] }>(`log-line:${streamId}`, (p) =>
      onLines(p.lines)
    );
    const offClosed = subscribe<string>(`log-closed:${streamId}`, onClosed);

    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        offLine();
        offClosed();
        // Fire-and-forget: cancel the backend task.
        void invoke('stop_log_stream', { streamId });
      },
    };
  }

  async saveLogs(
    ref: ResourceRef,
    container: string,
    opts: { sinceSeconds?: number; previous?: boolean }
  ): Promise<SavedLog | null> {
    // Lazy-import the dialog plugin so it isn't pulled into demo bundles.
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      title: 'Save logs',
      defaultPath: exportFilename(ref.name, container, opts.previous ?? false),
      filters: [{ name: 'Log', extensions: ['log', 'txt'] }],
    });
    if (!path) return null; // cancelled

    // The backend writes the file itself: a container's whole log can be tens of
    // megabytes, and there's no reason to drag that through the IPC bridge and
    // the webview's heap just to write it back out to disk.
    const lines = await invoke<number>('export_logs', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      sinceSeconds: opts.sinceSeconds ?? null,
      previous: opts.previous ?? false,
      path,
    });
    return { path, lines };
  }

  // ---- shell / exec ----

  async startShell(
    ref: ResourceRef,
    container: string,
    onOutput: (data: string) => void,
    onClosed: (reason: string) => void
  ): Promise<ShellHandle> {
    const streamId = await invoke<string>('start_shell', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
    });
    const offOut = subscribe<{ data: string }>(`shell-out:${streamId}`, (p) => onOutput(p.data));
    const offClosed = subscribe<string>(`shell-closed:${streamId}`, onClosed);

    let stopped = false;
    return {
      input: (data: string) => void invoke('shell_input', { streamId, data }),
      resize: (cols: number, rows: number) => void invoke('shell_resize', { streamId, cols, rows }),
      stop: () => {
        if (stopped) return;
        stopped = true;
        offOut();
        offClosed();
        void invoke('stop_shell', { streamId });
      },
    };
  }

  async startNodeShell(
    node: string,
    onOutput: (data: string) => void,
    onClosed: (reason: string) => void
  ): Promise<NodeShellHandle> {
    // This call is slow by nature: it creates the pod and waits for the kubelet to
    // start it (image pull included). The backend surfaces *why* it's stuck rather
    // than a bare timeout, so a rejection here is worth showing verbatim.
    const info = await invoke<{ streamId: string; namespace: string; pod: string }>(
      'start_node_shell',
      { node }
    );

    const offOut = subscribe<{ data: string }>(`shell-out:${info.streamId}`, (p) =>
      onOutput(p.data)
    );
    const offClosed = subscribe<string>(`shell-closed:${info.streamId}`, onClosed);

    let stopped = false;
    return {
      namespace: info.namespace,
      pod: info.pod,
      input: (data: string) => void invoke('shell_input', { streamId: info.streamId, data }),
      resize: (cols: number, rows: number) =>
        void invoke('shell_resize', { streamId: info.streamId, cols, rows }),
      stop: () => {
        if (stopped) return;
        stopped = true;
        offOut();
        offClosed();
        // stop_node_shell, not stop_shell: this one also deletes the privileged
        // pod. Leaving that to the generic stop would strand it on the node.
        void invoke('stop_node_shell', { streamId: info.streamId, pod: info.pod });
      },
    };
  }

  // ---- port-forwarding ----

  startPortForward(ref: ResourceRef, remotePort: number): Promise<ForwardInfo> {
    // Services need a backing pod resolved first, so they take a different
    // command; `remotePort` is the service port there, not the pod's (B16).
    if (ref.kind === 'services') {
      return invoke<ForwardInfo>('start_service_port_forward', {
        namespace: ref.namespace ?? '',
        service: ref.name,
        remotePort,
      });
    }
    return invoke<ForwardInfo>('start_port_forward', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      remotePort,
    });
  }

  onForwards(cb: (forwards: ForwardInfo[]) => void): Unsub {
    return subscribe<ForwardInfo[]>('forwards-update', cb);
  }

  // ---- Helm marketplace (Phase 1 of KubePi parity) ----

  helmRenderDefaultValues(chart: string, version: string, kubeconfig?: string): Promise<string> {
    return invoke<string>('helm_render_default_values', {
      chart,
      version,
      kubeconfig: kubeconfig ?? null,
    });
  }
  helmReleaseHistory(
    release: string,
    namespace: string,
    kubeconfig?: string
  ): Promise<HelmRevisionEntry[]> {
    return invoke<HelmRevisionEntry[]>('helm_release_history', {
      release,
      namespace,
      kubeconfig: kubeconfig ?? null,
    });
  }
  helmManifestRevision(namespace: string, name: string, revision: number): Promise<string> {
    return invoke<string>('helm_manifest_revision', { namespace, name, revision });
  }
  helmValuesRevision(namespace: string, name: string, revision: number): Promise<unknown> {
    return invoke<unknown>('helm_values_revision', { namespace, name, revision });
  }
  onHelmOpLog(cb: (line: { stream: 'stdout' | 'stderr'; line: string }) => void): Unsub {
    return subscribe<{ stream: 'stdout' | 'stderr'; line: string }>('helm-op-log', cb);
  }
  onHelmOpDone(cb: (result: HelmOpResult) => void): Unsub {
    return subscribe<HelmOpResult>('helm-op-done', cb);
  }

  // ---- Pod file management (Phase 2 of KubePi parity) ----

  podFilesList(ref: ResourceRef, container: string | null, path: string): Promise<PodFileEntry[]> {
    return invoke<PodFileEntry[]>('pod_files_list', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      path,
    });
  }
  podFilesRead(ref: ResourceRef, container: string | null, path: string): Promise<string> {
    return invoke<string>('pod_files_read', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      path,
    });
  }
  podFilesWrite(
    ref: ResourceRef,
    container: string | null,
    path: string,
    content: string
  ): Promise<void> {
    return invoke<void>('pod_files_write', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      path,
      content,
    });
  }
  podFilesDownload(ref: ResourceRef, container: string | null, path: string): Promise<Uint8Array> {
    // Tauri serialises Vec<u8> as a number array; convert back to a typed
    // array on this side for the eventual `new Blob([bytes])` call.
    return invoke<number[]>('pod_files_download', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      path,
    }).then((arr) => Uint8Array.from(arr));
  }
  podFilesUpload(
    ref: ResourceRef,
    container: string | null,
    destDir: string,
    tarBytes: Uint8Array
  ): Promise<void> {
    return invoke<void>('pod_files_upload', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      destDir,
      // base64 in transit keeps the wire format text-only and survives
      // Tauri's JSON serialiser.
      tarB64: bytesToBase64(tarBytes),
    });
  }

  // ---- Image transfer (registry export / copy) ----

  async exportFromRegistry(
    registryName: string,
    repo: string,
    tag: string,
    savePath: string,
    insecureSrc: boolean,
    onLog: (line: string) => void
  ): Promise<ExportFromRegistryResult> {
    const off = subscribe<{ stream: string; line: string }>('image-sync-log', (p) => {
      onLog(p.line);
    });
    try {
      return await invoke<ExportFromRegistryResult>('export_from_registry', {
        registryName,
        repo,
        tag,
        savePath,
        insecureSrc,
      });
    } finally {
      off();
    }
  }

  async imageCopy(
    source: string,
    destRegistry: string,
    destRepo: string,
    destTag: string,
    srcCreds: string | null,
    insecureSrc: boolean,
    insecureDest: boolean,
    onLog: (line: string) => void
  ): Promise<ImageSyncResult> {
    // Subscribe to the shared `image-sync-log` event before invoking so we
    // don't miss the first lines. The Rust LogLine payload is {stream, line}.
    const off = subscribe<{ stream: string; line: string }>('image-sync-log', (p) => {
      onLog(p.line);
    });
    try {
      return await invoke<ImageSyncResult>('image_copy', {
        source,
        destRegistry,
        destRepo,
        destTag,
        srcCreds,
        insecureSrc,
        insecureDest,
      });
    } finally {
      off();
    }
  }

  // ---- Metrics range query (the only metrics method not shared via BaseRpcProvider) ----

  metricsQueryRange(
    name: string,
    promql: string,
    startMs: number,
    endMs: number,
    stepSeconds: number
  ): Promise<PromQueryResult> {
    return invoke<PromQueryResult>('metrics_query_range', {
      name,
      promql,
      startMs,
      endMs,
      stepSeconds,
    });
  }

  // ---- Grafana dashboard search (range methods live in BaseRpcProvider) ----

  grafanaSearchDashboards(
    name: string,
    query: string
  ): Promise<import('../types').GrafanaDashboardSearchResult[]> {
    return invoke<import('../types').GrafanaDashboardSearchResult[]>('grafana_search_dashboards', {
      name,
      query,
    });
  }

  // ---- Saved PromQL queries ----

  savedQueriesRun(
    query: SavedQuery,
    instance: string,
    forceRefresh: boolean
  ): Promise<PromQueryResult> {
    return invoke<PromQueryResult>('saved_queries_run', {
      query,
      instance,
      forceRefresh,
    });
  }
}

/** Encode a `Uint8Array` to base64 without depending on a Node-only API. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}
