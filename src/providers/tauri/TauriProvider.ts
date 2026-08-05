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
import type {
  Alert,
  AlertManager,
  AlertManagerUpsert,
  ApplyResult,
  ClusterInfo,
  DocDryRun,
  ImportImageResult,
  SkopeoAvailability,
  ImageSyncResult,
  ArchiveInfo,
  ClusterStatus,
  ContextInfo,
  DataProvider,
  DashboardPreset,
  DrainProgress,
  EndpointAddress,
  EndpointRow,
  GrafanaConfig,
  GrafanaConfigUpsert,
  HelmChartSummary,
  HelmChartVersionEntry,
  HelmOp,
  HelmOpResult,
  HelmRepo,
  HelmRepoUpsert,
  HelmRevisionEntry,
  ImageRegistry,
  ImageRegistryUpsert,
  ImageRepo,
  ImageTag,
  ImageManifest,
  SavedQuery,
  MetricsConfig,
  MetricsConfigUpsert,
  NodeSample,
  NodeStatsError,
  EventItem,
  ForwardInfo,
  ImportResult,
  LogHandle,
  LogLine,
  LogOptions,
  NodeShellHandle,
  NodeMetricsMap,
  PodFileEntry,
  PodMetricsMap,
  PodSample,
  PromQueryResult,
  Silence,
  Prefs,
  Properties,
  CustomKind,
  KindId,
  ResourceRef,
  ShellHandle,
  Row,
  SavedLog,
  SecretEntry,
  Unsub,
  Revision,
  YamlDiff,
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

export class TauriProvider implements DataProvider {
  // ---- pod-stats fanout (see watchPodStats / onPodStats) ----
  //
  // A pod's Metrics tab is fed by filtering the cluster-wide `pod-metrics` event
  // down to the pods being watched, rather than a dedicated backend stream: the
  // poller is already running, so this is a pure client-side fanout.
  private watchedPods = new Set<string>();
  private podStatsCbs = new Set<(key: string, sample: PodSample) => void>();
  /** Lazily attached on the first onPodStats subscription; lives for the app. */
  private podMetricsFanout: Unsub | null = null;

  // ---- one-shot commands ----

  listContexts(): Promise<ContextInfo[]> {
    return invoke<ContextInfo[]>('list_contexts');
  }

  connect(context: string): Promise<ClusterInfo> {
    return invoke<ClusterInfo>('connect', { context });
  }

  restoreImports(paths: string[]): Promise<string[]> {
    return invoke<string[]>('restore_imports', { paths });
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

  getYaml(ref: ResourceRef): Promise<string> {
    return invoke<string>('get_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  applyYaml(ref: ResourceRef, text: string): Promise<void> {
    return invoke<void>('apply_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      yaml: text,
    });
  }

  dryRunYaml(ref: ResourceRef, text: string): Promise<YamlDiff> {
    return invoke<YamlDiff>('dry_run_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      yaml: text,
    });
  }

  getEvents(ref: ResourceRef): Promise<EventItem[]> {
    return invoke<EventItem[]>('get_events', {
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  getProperties(ref: ResourceRef): Promise<Properties> {
    return invoke<Properties>('get_properties', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  getSecretData(namespace: string, name: string): Promise<SecretEntry[]> {
    return invoke<SecretEntry[]>('get_secret_data', { namespace, name });
  }

  deleteResource(ref: ResourceRef): Promise<void> {
    return invoke<void>('delete_resource', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  scaleResource(ref: ResourceRef, replicas: number): Promise<void> {
    return invoke<void>('scale_resource', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      replicas,
    });
  }

  restartPod(ref: ResourceRef): Promise<void> {
    return invoke<void>('restart_pod', {
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  restartRollout(ref: ResourceRef): Promise<void> {
    return invoke<void>('restart_rollout', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  listRevisions(ref: ResourceRef): Promise<Revision[]> {
    return invoke<Revision[]>('list_revisions', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  undoRollout(ref: ResourceRef, toRevision?: number): Promise<void> {
    return invoke<void>('undo_rollout', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      toRevision: toRevision ?? null,
    });
  }

  setCordon(node: string, unschedulable: boolean): Promise<void> {
    return invoke<void>('set_cordon', { name: node, unschedulable });
  }

  drainNode(node: string): Promise<void> {
    return invoke<void>('drain_node', { name: node });
  }

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

  nodeHistory(node: string): Promise<NodeSample[]> {
    return invoke<NodeSample[]>('node_history', { node });
  }

  watchNodeStats(node: string): Promise<void> {
    return invoke<void>('watch_node_stats', { node });
  }

  unwatchNodeStats(node: string): Promise<void> {
    return invoke<void>('unwatch_node_stats', { node });
  }

  // ---- per-pod statistics ----

  async watchPodStats(key: string): Promise<void> {
    // No backend call: the metrics poller already runs cluster-wide. This just
    // marks the pod so the fanout forwards its samples.
    this.watchedPods.add(key);
  }

  async unwatchPodStats(key: string): Promise<void> {
    this.watchedPods.delete(key);
  }

  loadPrefs(): Promise<Prefs | null> {
    return invoke<Prefs | null>('load_prefs');
  }

  savePrefs(prefs: Prefs): Promise<void> {
    return invoke<void>('save_prefs', { prefs });
  }

  // ---- push subscriptions ----

  // ---- custom (CRD-backed) kinds (B15) ----

  watchCustomKind(id: string): Promise<void> {
    return invoke('watch_custom_kind', { kind: id });
  }

  unwatchCustomKind(id: string): Promise<void> {
    return invoke('unwatch_custom_kind', { kind: id });
  }

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

  stopPortForward(id: string): Promise<void> {
    return invoke<void>('stop_port_forward', { id });
  }

  listPortForwards(): Promise<ForwardInfo[]> {
    return invoke<ForwardInfo[]>('list_port_forwards');
  }

  // ---- Helm marketplace (Phase 1 of KubePi parity) ----

  helmListRepos(): Promise<HelmRepo[]> {
    return invoke<HelmRepo[]>('helm_list_repos');
  }
  helmAddRepo(input: HelmRepoUpsert): Promise<HelmRepo> {
    return invoke<HelmRepo>('helm_add_repo', { ...input });
  }
  helmRemoveRepo(name: string): Promise<void> {
    return invoke<void>('helm_remove_repo', { name });
  }
  helmUpdateRepo(name: string): Promise<HelmRepo> {
    return invoke<HelmRepo>('helm_update_repo', { name });
  }
  helmUpdateAllRepos(): Promise<HelmRepo[]> {
    return invoke<HelmRepo[]>('helm_update_all_repos');
  }
  helmSearchCharts(query: string): Promise<HelmChartSummary[]> {
    return invoke<HelmChartSummary[]>('helm_search_charts', { query });
  }
  helmChartVersions(repo: string, chart: string): Promise<HelmChartVersionEntry[]> {
    return invoke<HelmChartVersionEntry[]>('helm_chart_versions', { repo, chart });
  }
  helmExportChart(
    repo: string,
    chart: string,
    version: string,
    outputDir: string
  ): Promise<string> {
    return invoke<string>('helm_export_chart', { repo, chart, version, outputDir });
  }
  helmImportChart(filePath: string, repoName: string): Promise<string> {
    return invoke<string>('helm_import_chart', { filePath, repoName });
  }
  helmLocalCharts(repoName: string): Promise<string[]> {
    return invoke<string[]>('helm_local_charts', { repoName });
  }
  helmRenderDefaultValues(chart: string, version: string, kubeconfig?: string): Promise<string> {
    return invoke<string>('helm_render_default_values', {
      chart,
      version,
      kubeconfig: kubeconfig ?? null,
    });
  }
  helmRunOp(op: HelmOp): Promise<HelmOpResult> {
    // The backend uses serde's `tag = "op"`, which on the wire means the
    // discriminant is the *top-level* field. Mirror that on the JS side so
    // the call site can stay readable.
    return invoke<HelmOpResult>('helm_run_op', op as unknown as Record<string, unknown>);
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
  onHelmOpLog(cb: (line: { stream: 'stdout' | 'stderr'; line: string }) => void): Unsub {
    return subscribe<{ stream: 'stdout' | 'stderr'; line: string }>('helm-op-log', cb);
  }
  onHelmOpDone(cb: (result: HelmOpResult) => void): Unsub {
    return subscribe<HelmOpResult>('helm-op-done', cb);
  }

  // ---- Pod file management (Phase 2 of KubePi parity) ----

  podFilesList(ref: ResourceRef, container: string | null, path: string): Promise<PodFileEntry[]> {
    return invoke<PodFileEntry[]>('pod_files_list', {
      namespace: ref.namespace,
      pod: ref.name,
      container,
      path,
    });
  }
  podFilesRead(ref: ResourceRef, container: string | null, path: string): Promise<string> {
    return invoke<string>('pod_files_read', {
      namespace: ref.namespace,
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
      namespace: ref.namespace,
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
      namespace: ref.namespace,
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
      namespace: ref.namespace,
      pod: ref.name,
      container,
      destDir,
      // base64 in transit keeps the wire format text-only and survives
      // Tauri's JSON serialiser.
      tarB64: bytesToBase64(tarBytes),
    });
  }

  // ---- Image registry management (Phase 5 of KubePi parity) ----

  imageRegistryList(): Promise<ImageRegistry[]> {
    return invoke<ImageRegistry[]>('image_registry_list');
  }
  imageRegistryUpsert(input: ImageRegistryUpsert): Promise<ImageRegistry> {
    return invoke<ImageRegistry>('image_registry_upsert', { ...input });
  }
  imageRegistryRemove(name: string): Promise<void> {
    return invoke<void>('image_registry_remove', { name });
  }
  imageRegistryTest(name: string): Promise<void> {
    return invoke<void>('image_registry_test', { name });
  }
  imageRegistryRepos(name: string): Promise<ImageRepo[]> {
    return invoke<ImageRepo[]>('image_registry_repos', { name });
  }
  imageRegistryTags(name: string, repo: string): Promise<ImageTag[]> {
    return invoke<ImageTag[]>('image_registry_tags', { name, repo });
  }

  // ---- Multi-document YAML apply (Phase 4 — templates) ----

  applyYamlBundle(yaml: string): Promise<ApplyResult[]> {
    return invoke<ApplyResult[]>('apply_yaml_bundle', { yaml });
  }

  dryRunYamlBundle(yaml: string): Promise<DocDryRun[]> {
    return invoke<DocDryRun[]>('dry_run_yaml_bundle', { yaml });
  }

  importImageToNode(node: string, path: string): Promise<ImportImageResult> {
    return invoke<ImportImageResult>('import_image_to_node', { node, path });
  }

  imageSyncStatus(): Promise<SkopeoAvailability> {
    return invoke<SkopeoAvailability>('image_sync_status');
  }

  imageInspectArchive(tarPath: string): Promise<ArchiveInfo> {
    return invoke<ArchiveInfo>('image_inspect_archive', { tarPath });
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

  // ---- Endpoints (Phase 1 Tier-2) ----

  listEndpoints(): Promise<EndpointRow[]> {
    return invoke<EndpointRow[]>('list_endpoints');
  }
  listEndpointsForService(namespace: string, name: string): Promise<EndpointRow[]> {
    return invoke<EndpointRow[]>('list_endpoints_for_service', { namespace, name });
  }
  listEndpointAddresses(namespace: string, name: string): Promise<EndpointAddress[]> {
    return invoke<EndpointAddress[]>('list_endpoint_addresses', { namespace, name });
  }

  // ---- CronJob manual trigger (Phase 2 Tier-2) ----

  triggerCronjob(namespace: string, name: string): Promise<string> {
    return invoke<string>('trigger_cronjob', { namespace, name });
  }

  // ---- Metrics / Prometheus multi-instance ----

  metricsList(): Promise<MetricsConfig[]> {
    return invoke<MetricsConfig[]>('metrics_list');
  }
  metricsUpsert(input: MetricsConfigUpsert): Promise<MetricsConfig> {
    return invoke<MetricsConfig>('metrics_upsert', { ...input });
  }
  metricsRemove(name: string): Promise<void> {
    return invoke<void>('metrics_remove', { name });
  }
  metricsTest(name: string): Promise<void> {
    return invoke<void>('metrics_test', { name });
  }
  metricsQuery(name: string, promql: string): Promise<PromQueryResult> {
    return invoke<PromQueryResult>('metrics_query', { name, promql });
  }
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

  // ---- Grafana ----

  grafanaList(): Promise<GrafanaConfig[]> {
    return invoke<GrafanaConfig[]>('grafana_list');
  }
  grafanaUpsert(input: GrafanaConfigUpsert): Promise<GrafanaConfig> {
    return invoke<GrafanaConfig>('grafana_upsert', { ...input });
  }
  grafanaRemove(name: string): Promise<void> {
    return invoke<void>('grafana_remove', { name });
  }
  grafanaTest(name: string): Promise<void> {
    return invoke<void>('grafana_test', { name });
  }
  grafanaPresets(): Promise<DashboardPreset[]> {
    return invoke<DashboardPreset[]>('grafana_presets');
  }
  grafanaDashboardUrl(name: string, uid: string, fromMs: number, toMs: number): Promise<string> {
    return invoke<string>('grafana_dashboard_url', { name, uid, fromMs, toMs });
  }

  // ---- AlertManager ----

  alertManagerList(): Promise<AlertManager[]> {
    return invoke<AlertManager[]>('alertmanager_list');
  }
  alertManagerUpsert(input: AlertManagerUpsert): Promise<AlertManager> {
    return invoke<AlertManager>('alertmanager_upsert', { ...input });
  }
  alertManagerRemove(name: string): Promise<void> {
    return invoke<void>('alertmanager_remove', { name });
  }
  alertManagerTest(name: string): Promise<void> {
    return invoke<void>('alertmanager_test', { name });
  }
  alertManagerAlerts(name: string): Promise<Alert[]> {
    return invoke<Alert[]>('alertmanager_alerts', { name });
  }
  alertManagerSilences(name: string): Promise<Silence[]> {
    return invoke<Silence[]>('alertmanager_silences', { name });
  }
  alertManagerCreateSilence(
    instance: string,
    request: import('../types').CreateSilenceRequest
  ): Promise<string> {
    return invoke<string>('alertmanager_create_silence', { instance, request });
  }
  alertManagerDeleteSilence(instance: string, silenceId: string): Promise<void> {
    return invoke<void>('alertmanager_delete_silence', { instance, silenceId });
  }
  prometheusRules(instance: string): Promise<import('../types').RuleGroup[]> {
    return invoke<import('../types').RuleGroup[]>('prometheus_rules', { instance });
  }
  lokiList(): Promise<import('../types').LokiConfig[]> {
    return invoke<import('../types').LokiConfig[]>('loki_list');
  }
  lokiUpsert(input: import('../types').LokiUpsert): Promise<import('../types').LokiConfig> {
    return invoke<import('../types').LokiConfig>('loki_upsert', { ...input });
  }
  lokiRemove(name: string): Promise<void> {
    return invoke<void>('loki_remove', { name });
  }
  lokiTest(name: string): Promise<void> {
    return invoke<void>('loki_test', { name });
  }
  auditEvents(query: import('../types').AuditQuery): Promise<import('../types').AuditEvent[]> {
    return invoke<import('../types').AuditEvent[]>('audit_events', { query });
  }
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

  savedQueriesList(): Promise<SavedQuery[]> {
    return invoke<SavedQuery[]>('saved_queries_list');
  }
  savedQueriesUpsert(query: SavedQuery): Promise<SavedQuery> {
    return invoke<SavedQuery>('saved_queries_upsert', { ...query });
  }
  savedQueriesRemove(name: string): Promise<void> {
    return invoke<void>('saved_queries_remove', { name });
  }
  savedQueriesClearCache(): Promise<void> {
    return invoke<void>('saved_queries_clear_cache');
  }
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

  // ---- Image manifest drill-down ----

  imageRegistryManifest(name: string, repo: string, tag: string): Promise<ImageManifest> {
    return invoke<ImageManifest>('image_registry_manifest', { name, repo, tag });
  }

  // ---- SBOM (Software Bill of Materials) ----

  sbomGenerateImage(
    imageRef: string,
    format: import('../types/sbom').SbomFormat
  ): Promise<import('../types/sbom').SbomResult> {
    return invoke('sbom_generate_image', { imageRef, format });
  }

  sbomGenerateCluster(format: import('../types/sbom').SbomFormat): Promise<import('../types/sbom').SbomResult> {
    return invoke('sbom_generate_cluster', { format });
  }

  sbomListHistory(): Promise<import('../types/sbom').SbomSummary[]> {
    return invoke('sbom_list_history');
  }

  sbomGet(id: string): Promise<import('../types/sbom').SbomResult> {
    return invoke('sbom_get', { id });
  }

  sbomExport(id: string, outputPath: string): Promise<string> {
    return invoke('sbom_export', { id, outputPath });
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
