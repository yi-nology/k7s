/**
 * HttpProvider — the browser shell's DataProvider.
 *
 * Uses {@link httpInvoke} for one-shot commands and {@link httpSubscribe} for
 * live event streams. The wire format mirrors the Tauri IPC channel closely
 * (same event names, same payload shapes), so the two providers are
 * interchangeable from the UI's point of view.
 *
 * Most simple RPC methods are inherited from {@link BaseRpcProvider} (ResourceRef
 * helpers, Helm, image registries, observability, AI, etc.). Only transport-
 * specific methods (streaming, file dialogs, SSE subscriptions) and intentional
 * stubs (notImplemented / desktopOnly) are written out below.
 *
 * What works:
 * - `listContexts` / `connect` (via the k7s-web server, which talks to your
 *   real cluster).
 * - `getYaml` / `getEvents` / `getProperties` / `loadPrefs` / `savePrefs`
 *   (inherited from BaseRpcProvider).
 * - All mutations: `applyYaml`, `dryRunYaml`, `deleteResource`, `scaleResource`,
 *   `setCordon`, `restartPod`, `restartRollout`, `drainNode` (inherited).
 * - Log streaming (`startLogs` / `saveLogs` / `stopLogs`).
 * - Shells (`startShell` / `startNodeShell` / `stopShell`) — exec over SSE,
 *   input/resize as POSTs.
 * - `onResourceUpdate` / `onClusterStatus` / `onWatchStatus` /
 *   `onCustomKinds` / `onPodMetrics` / `onNodeMetrics` via SSE.
 *
 * What's still stubbed (rejects with a clear error so the UI can show it):
 * - Port forwards (`startPortForward` / `startServicePortForward` /
 *   `listPortForwards`). Bidirectional framing over SSE isn't built yet.
 * - The Tauri-specific bits (`setWindowTheme`). `importKubeconfig` is NOT
 *   stubbed — web mode opens a hidden file input and posts the picked file's
 *   contents via `import_kubeconfig_content` (the onboarding wizard depends
 *   on it).
 */

import { IS_TAURI, httpInvoke, httpSubscribe } from './transport';
import { BaseRpcProvider } from './BaseRpcProvider';
import type {
  ApplyResult,
  Alert,
  AlertManager,
  ImportImageResult,
  SkopeoAvailability,
  ArchiveInfo,
  AlertManagerUpsert,
  ClusterStatus,
  DataProvider,
  DashboardPreset,
  DrainProgress,
  EventItem,
  ForwardInfo,
  GrafanaConfig,
  GrafanaConfigUpsert,
  HelmChartSummary,
  HelmChartVersionEntry,
  HelmOp,
  HelmOpResult,
  HelmRepo,
  HelmRepoUpsert,
  ImageRegistry,
  ImageRegistryUpsert,
  ImageRepo,
  ImageTag,
  ImageManifest,
  SavedQuery,
  ImportResult,
  KindId,
  LogHandle,
  LogLine,
  LogOptions,
  MetricsConfig,
  MetricsConfigUpsert,
  NodeMetricsMap,
  NodeSample,
  NodeShellHandle,
  NodeStatsError,
  PodMetricsMap,
  PodSample,
  PromQueryResult,
  CustomKind,
  ResourceRef,
  Row,
  SavedLog,
  ShellHandle,
  Silence,
  Unsub,
} from './types';

/** All not-bridged methods share this rejection so the UI shows the same message. */
function notImplemented(method: string): Promise<never> {
  return Promise.reject(new Error(`${method} is not bridged through the browser shell yet`));
}

/**
 * True when the UI runs in the browser shell (talking to the k7s-web server)
 * rather than the Tauri desktop app. Reuses {@link IS_TAURI} so the runtime
 * detection lives in exactly one place. The LoginGate (and any other web-only
 * chrome) consults this instead of sniffing `window.__TAURI_INTERNALS__`
 * itself. Note: demo mode (VITE_DEMO=1) also runs in a browser tab, so this
 * returns true there — web-only features that need a server must fail open.
 */
export const isHttpMode = () => !IS_TAURI;

/** Features that require the native desktop runtime (skopeo, containerd import).
 *  Kept distinct from `notImplemented`: these are intentionally desktop-only by
 *  design, not "TODO: bridge through the browser shell". */
function desktopOnly(feature: string): Promise<never> {
  return Promise.reject(new Error(`${feature} is only available in the desktop app`));
}

/** Shared no-op unsubscribe for the `on*` events the web shell doesn't push. */
const noopUnsub: Unsub = () => {};

/**
 * Fallback for callers that haven't refactored yet: spin up a transient
 * hidden input and click it. Works in Chrome/Edge; Safari is flaky here
 * because the click() happens inside a Promise executor and the user
 * gesture is sometimes considered "lost". New call sites should pass
 * their own long-lived input via `importKubeconfigViaInput`.
 */
function importKubeconfigViaTransientInput(): Promise<ImportResult | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.yaml,.yml,.kubeconfig,application/x-yaml,text/yaml';
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  input.style.opacity = '0';
  document.body.appendChild(input);
  const promise = importKubeconfigViaInput(input);
  // The promise settles in change/cancel; clean the input off the DOM
  // in either case so we don't leak nodes.
  promise.finally(() => {
    if (input.parentNode) input.parentNode.removeChild(input);
  });
  input.click();
  return promise;
}

/**
 * Browser equivalent of the Tauri file dialog. The component owns a
 * hidden `<input type="file">` in the React tree; this function is a
 * promise that resolves when the input fires `change` (or null on cancel).
 *
 * The picker is *driven* by the component's own button (`onClick` calls
 * `inputRef.current?.click()` directly), so the user-gesture chain is
 * a single stack frame from click → click() with no `await` in between.
 * Older implementations created a fresh input per click, which made the
 * call chain a Promise executor and broke `click()` on some browsers
 * (Safari in particular would silently no-op because the gesture was
 * considered "lost"). A long-lived input element avoids that.
 */
export function importKubeconfigViaInput(input: HTMLInputElement): Promise<ImportResult | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      // Remove both listeners to prevent leaks — whichever didn't fire
      // would otherwise stay attached indefinitely.
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      // Reset value so picking the same file twice still fires `change`.
      input.value = '';
      fn();
    };

    const onChange = async () => {
      const file = input.files?.[0];
      if (!file) {
        settle(() => resolve(null));
        return;
      }
      try {
        const contents = await file.text();
        const result = await httpInvoke<ImportResult>('import_kubeconfig_content', {
          filename: file.name,
          contents,
        });
        settle(() => resolve(result));
      } catch (e) {
        settle(() => reject(e));
      }
    };
    // `cancel` only fires on some browsers; `change` is the source of
    // truth when the user actually picks a file. If the user dismisses
    // the dialog without picking, `change` never fires — so we also
    // listen for `cancel` to avoid a stuck promise.
    const onCancel = () => settle(() => resolve(null));

    input.addEventListener('change', onChange, { once: true });
    input.addEventListener('cancel', onCancel, { once: true });
  });
}

export class HttpProvider extends BaseRpcProvider implements DataProvider {
  // Bridge the base class's one-shot RPC contract to the HTTP transport. Every
  // faithful `this.rpc('cmd', args)` method in BaseRpcProvider now works over
  // HTTP for free; only the methods that *diverge* (HTTP returns [] / rejects
  // with notImplemented / desktopOnly) or are transport-specific (streaming,
  // file dialogs, SSE subscriptions) are written out below.
  protected rpc<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    return httpInvoke<T>(cmd, args);
  }

  // ---- one-shot commands (transport-specific: file dialog) ----

  importKubeconfig(_input?: HTMLInputElement): Promise<ImportResult | null> {
    // The Tauri shell pops a native file dialog; the browser shell uses
    // a hidden `<input type="file">` and POSTs the file's contents to the
    // back-end. The component owns the input (so the click→pick chain is
    // a single user-gesture stack frame) and passes it in. If the
    // component forgot to wire one, we fall back to a transient input —
    // which works in Chrome but is known to silently no-op in Safari.
    if (_input) return importKubeconfigViaInput(_input);
    return importKubeconfigViaTransientInput();
  }

  restoreImports(_paths: string[]): Promise<string[]> {
    // The web shell doesn't persist prefs across reloads by default; a
    // future "import kubeconfig via URL" flow would land here.
    return Promise.resolve([]);
  }

  // getYaml, applyYaml, dryRunYaml, getProperties, deleteResource,
  // scaleResource, restartPod, restartRollout, listRevisions, undoRollout
  // are now inherited from BaseRpcProvider.

  getEvents(ref: ResourceRef): Promise<EventItem[]> {
    // The back-end returns a simpler shape than `EventItem`; map it. `ty` is
    // renamed to `type` on the wire, and `lastTimestamp` carries the RFC3339
    // last-seen time for the EventsTab time-range filter.
    return httpInvoke<
      Array<{
        type: string;
        reason: string;
        message: string;
        count: number;
        age: string;
        lastTimestamp?: string;
      }>
    >('get_events', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    }).then((rows) =>
      rows.map((r) => ({
        type: r.type as 'Normal' | 'Warning',
        reason: r.reason,
        message: r.message,
        count: r.count,
        age: r.age,
        lastTimestamp: r.lastTimestamp,
      }))
    );
  }

  // getProperties, getSecretData, deleteResource, scaleResource, restartPod,
  // restartRollout, listRevisions, undoRollout, setCordon, drainNode are
  // inherited from BaseRpcProvider (faithful bridges).
  // setWindowTheme is inherited from BaseRpcProvider (no-op default).

  // ---- log streams ----

  async startLogs(
    ref: ResourceRef,
    container: string,
    opts: LogOptions,
    onLines: (lines: LogLine[]) => void,
    onClosed: (reason: string) => void
  ): Promise<LogHandle> {
    // Start the backend stream first so we know its id, then attach SSE
    // listeners to the id-scoped events. Same dance the Tauri shell does.
    const streamId = await httpInvoke<string>('start_log_stream', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      tail: opts.tail ?? null,
      sinceTime: opts.sinceTime ?? null,
      sinceSeconds: opts.sinceSeconds ?? null,
      previous: opts.previous ?? false,
    });

    const offLine = httpSubscribe<{ lines: LogLine[] }>(`log-line:${streamId}`, (p) =>
      onLines(p.lines)
    );
    const offClosed = httpSubscribe<string>(`log-closed:${streamId}`, onClosed);

    let stopped = false;
    return {
      stop: () => {
        if (stopped) return;
        stopped = true;
        offLine.unsubscribe();
        offClosed.unsubscribe();
        void httpInvoke('stop_log_stream', { streamId });
      },
    };
  }
  async saveLogs(
    ref: ResourceRef,
    container: string,
    opts: { sinceSeconds?: number; previous?: boolean }
  ): Promise<SavedLog | null> {
    // Issue the export as a POST with a JSON body, get the line count back
    // so the caller can show "saved N lines". A richer implementation would
    // stream the text back; for now, save to a server-side temp and let the
    // browser download it through a separate GET.
    const path = `/tmp/k7s-logs-${ref.namespace}-${ref.name}-${Date.now()}.log`;
    const lines = await httpInvoke<number>('export_logs', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      sinceSeconds: opts.sinceSeconds ?? null,
      previous: opts.previous ?? false,
      path,
    });
    return { path, lines };
  }
  async stopLogs(id: string): Promise<void> {
    await httpInvoke('stop_log_stream', { streamId: id });
  }

  // ---- shells ----

  async startShell(
    ref: ResourceRef,
    container: string,
    onOutput: (data: string) => void,
    onClosed: (reason: string) => void
  ): Promise<ShellHandle> {
    // Same dance as startLogs: ask the back-end for an id, then attach SSE
    // listeners to the id-scoped events. The shell task pumps output as
    // `shell-out:{id}` batches and a final `shell-closed:{id}`.
    const streamId = await httpInvoke<string>('start_shell', {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
    });
    const offOut = httpSubscribe<{ data: string }>(`shell-out:${streamId}`, (p) =>
      onOutput(p.data)
    );
    const offClosed = httpSubscribe<string>(`shell-closed:${streamId}`, onClosed);
    let stopped = false;
    return {
      input: (data: string) => httpInvoke<void>('shell_input', { streamId, data }),
      resize: (cols: number, rows: number) =>
        httpInvoke<void>('shell_resize', { streamId, cols, rows }),
      stop: () => {
        if (stopped) return;
        stopped = true;
        offOut.unsubscribe();
        offClosed.unsubscribe();
        void httpInvoke<void>('stop_shell', { streamId });
      },
    };
  }
  async startNodeShell(
    node: string,
    onOutput: (data: string) => void,
    onClosed: (reason: string) => void
  ): Promise<NodeShellHandle> {
    // The Tauri command returns `{ streamId, namespace, pod }`; the pod is
    // the one we just spawned, the user gets told so they can clean it up
    // manually if our teardown ever fails.
    const info = await httpInvoke<{ streamId: string; namespace: string; pod: string }>(
      'start_node_shell',
      { node }
    );
    const offOut = httpSubscribe<{ data: string }>(`shell-out:${info.streamId}`, (p) =>
      onOutput(p.data)
    );
    const offClosed = httpSubscribe<string>(`shell-closed:${info.streamId}`, onClosed);
    let stopped = false;
    return {
      namespace: info.namespace,
      pod: info.pod,
      input: (data: string) => httpInvoke<void>('shell_input', { streamId: info.streamId, data }),
      resize: (cols: number, rows: number) =>
        httpInvoke<void>('shell_resize', {
          streamId: info.streamId,
          cols,
          rows,
        }),
      stop: () => {
        if (stopped) return;
        stopped = true;
        offOut.unsubscribe();
        offClosed.unsubscribe();
        // Stopping a node shell also deletes the debug pod — the privileged
        // pod shouldn't outlive the session.
        void httpInvoke<void>('stop_node_shell', {
          streamId: info.streamId,
          pod: info.pod,
        });
      },
    };
  }
  async stopShell(id: string): Promise<void> {
    await httpInvoke<void>('stop_shell', { streamId: id });
  }
  async stopNodeShell(_id: string): Promise<void> {
    // `stopShell` already covers this for the Tauri path; the web shell's
    // pod cleanup is performed by `startNodeShell` callers via their handle's
    // own `stop()` (which knows the pod name). Keep the no-op shape for
    // parity with the Tauri side.
  }

  // ---- port forwards (stubbed) ----

  startPortForward(_ref: ResourceRef, _remotePort: number): Promise<ForwardInfo> {
    return notImplemented('startPortForward');
  }
  startServicePortForward(_namespace: string, _name: string, _port: number): Promise<ForwardInfo> {
    return notImplemented('startServicePortForward');
  }
  stopPortForward(_id: string): Promise<void> {
    return Promise.resolve();
  }
  listPortForwards(): Promise<ForwardInfo[]> {
    return Promise.resolve([]);
  }

  // ---- node-exporter stats (stubbed) ----

  nodeHistory(_node: string): Promise<NodeSample[]> {
    return Promise.resolve([]);
  }
  podHistory(_namespace: string, _pod: string): Promise<import('./types').PodSample[]> {
    return Promise.resolve([]);
  }
  watchNodeStats(_node: string): Promise<void> {
    return Promise.resolve();
  }
  unwatchNodeStats(_node: string): Promise<void> {
    return Promise.resolve();
  }
  watchCustomKind(_id: string): Promise<void> {
    return Promise.resolve();
  }
  unwatchCustomKind(_id: string): Promise<void> {
    return Promise.resolve();
  }
  // watchPodStats / unwatchPodStats are inherited from BaseRpcProvider (no-op defaults).
  // loadPrefs / savePrefs are inherited from BaseRpcProvider (faithful bridges).

  // ---- event subscriptions (live SSE) ----
  //
  // Each `on*` opens a fresh EventSource (well, our hand-rolled SSE
  // subscriber — see transport.ts) against the same `/events` endpoint and
  // filters for the event name. We could share one connection and
  // demux in the client, but a handful of lightweight subscribers is
  // simpler and the back-end's broadcast channel is already a fanout.

  onResourceUpdate(cb: (kind: KindId, rows: Row[]) => void): Unsub {
    const sub = httpSubscribe<{ kind: KindId; rows: Row[] }>('resource-update', (payload) =>
      cb(payload.kind, payload.rows)
    );
    return () => sub.unsubscribe();
  }

  onCustomKinds(cb: (kinds: CustomKind[]) => void): Unsub {
    const sub = httpSubscribe<CustomKind[]>('custom-kinds', cb);
    return () => sub.unsubscribe();
  }

  onPodMetrics(cb: (metrics: PodMetricsMap) => void): Unsub {
    const sub = httpSubscribe<PodMetricsMap>('pod-metrics', cb);
    return () => sub.unsubscribe();
  }

  onNodeMetrics(cb: (metrics: NodeMetricsMap) => void): Unsub {
    const sub = httpSubscribe<NodeMetricsMap>('node-metrics', cb);
    return () => sub.unsubscribe();
  }

  onClusterStatus(cb: (status: ClusterStatus) => void): Unsub {
    const sub = httpSubscribe<ClusterStatus>('cluster-status', cb);
    return () => sub.unsubscribe();
  }

  onWatchStatus(cb: (activeStreams: number) => void): Unsub {
    const sub = httpSubscribe<number>('watch-status', cb);
    return () => sub.unsubscribe();
  }

  onAiEvent(cb: (data: { runId: string; event: unknown }) => void): Unsub {
    const sub = httpSubscribe<{ runId: string; event: unknown }>('ai_event', cb);
    return () => sub.unsubscribe();
  }

  onWatchKindStatus(cb: (kind: string, status: 'ok' | 'forbidden') => void): Unsub {
    const sub = httpSubscribe<{ kind: string; status: string }>('watch-kind-status', (payload) => {
      cb(payload.kind, payload.status as 'ok' | 'forbidden');
    });
    return () => sub.unsubscribe();
  }

  onDrainProgress(_cb: (progress: DrainProgress) => void): Unsub {
    // No drain support in the web shell; return a no-op so the UI doesn't
    // have to special-case it.
    return noopUnsub;
  }

  onNodeStats(_cb: (node: string, sample: NodeSample) => void): Unsub {
    return noopUnsub;
  }
  onNodeStatsError(_cb: (err: NodeStatsError) => void): Unsub {
    return noopUnsub;
  }
  onPodStats(_cb: (key: string, sample: PodSample) => void): Unsub {
    return noopUnsub;
  }

  onForwards(_cb: (forwards: ForwardInfo[]) => void): Unsub {
    return noopUnsub;
  }

  // ---- Helm marketplace: web shell doesn't proxy these yet. ----
  async helmListRepos(): Promise<HelmRepo[]> {
    return notImplemented('helm_list_repos');
  }
  async helmAddRepo(_input: HelmRepoUpsert): Promise<HelmRepo> {
    return notImplemented('helm_add_repo');
  }
  async helmRemoveRepo(_name: string): Promise<void> {
    return notImplemented('helm_remove_repo');
  }
  async helmUpdateRepo(_name: string): Promise<HelmRepo> {
    return notImplemented('helm_update_repo');
  }
  async helmUpdateAllRepos(): Promise<HelmRepo[]> {
    return notImplemented('helm_update_all_repos');
  }
  async helmSearchCharts(_q: string): Promise<HelmChartSummary[]> {
    return [];
  }
  async helmChartVersions(_repo: string, _chart: string): Promise<HelmChartVersionEntry[]> {
    return [];
  }
  async helmExportChart(
    _repo: string,
    _chart: string,
    _version: string,
    _outputDir: string
  ): Promise<string> {
    return notImplemented('helm_export_chart');
  }
  async helmImportChart(_filePath: string, _repoName: string): Promise<string> {
    return notImplemented('helm_import_chart');
  }
  async helmLocalCharts(_repoName: string): Promise<string[]> {
    return [];
  }
  // helmRenderDefaultValues, helmReleaseHistory are inherited from
  // BaseRpcProvider (empty defaults).
  async helmRunOp(_op: HelmOp): Promise<HelmOpResult> {
    return notImplemented('helm_run_op');
  }
  onHelmOpLog(_cb: (line: { stream: 'stdout' | 'stderr'; line: string }) => void): Unsub {
    return noopUnsub;
  }
  onHelmOpDone(_cb: (result: HelmOpResult) => void): Unsub {
    return noopUnsub;
  }

  // Pod files (podFilesList, podFilesRead, podFilesWrite, podFilesDownload,
  // podFilesUpload) are inherited from BaseRpcProvider (empty defaults).

  // ---- Image registry: not proxied yet. ----
  async imageRegistryList(): Promise<ImageRegistry[]> {
    return [];
  }
  async imageRegistryUpsert(_input: ImageRegistryUpsert): Promise<ImageRegistry> {
    return notImplemented('image_registry_upsert');
  }
  async imageRegistryRemove(_name: string): Promise<void> {
    // No-op.
  }
  async imageRegistryTest(_name: string): Promise<void> {
    // No-op.
  }
  async imageRegistryRepos(_name: string): Promise<ImageRepo[]> {
    return [];
  }
  async imageRegistryTags(_name: string, _repo: string): Promise<ImageTag[]> {
    return [];
  }

  // ---- Multi-doc apply: not proxied yet. ----
  async applyYamlBundle(_yaml: string): Promise<ApplyResult[]> {
    return [];
  }

  // Multi-doc dry run is handled by the base class via rpc('dry_run_yaml_bundle').

  // ---- Image import: desktop only. The web shell has no access to the
  // user's local filesystem, so the native file-picker path doesn't apply
  // and there's no HTTP route to bridge. Throw a clear message; the panel
  // surfaces it as a "desktop app only" notice. ----
  async importImageToNode(_node: string, _path: string): Promise<ImportImageResult> {
    return desktopOnly('Image import');
  }

  async imageSyncStatus(): Promise<SkopeoAvailability> {
    return desktopOnly('Image sync');
  }

  async imageInspectArchive(_tarPath: string): Promise<ArchiveInfo> {
    return desktopOnly('Image inspect');
  }

  // exportFromNode / listNodeImages are inherited from BaseRpcProvider (faithful bridges).
  // exportFromRegistry / imageCopy are inherited from BaseRpcProvider (desktopOnly defaults).

  // ---- Endpoints / metrics / grafana / alerting (Phase 1 Tier-2) ----
  // listEndpoints / listEndpointsForService / listEndpointAddresses are
  // inherited from BaseRpcProvider (faithful bridges). The rest of this
  // section is not proxied through the web shell yet; the k7s-web server
  // doesn't implement these routes. Throw for mutations, return [] for reads
  // so the UI renders "no data" rather than an error.
  async triggerCronjob(_ns: string, _name: string): Promise<string> {
    return notImplemented('trigger_cronjob');
  }
  async metricsList(): Promise<MetricsConfig[]> {
    return [];
  }
  async metricsUpsert(_input: MetricsConfigUpsert): Promise<MetricsConfig> {
    return notImplemented('metrics_upsert');
  }
  async metricsRemove(_name: string): Promise<void> {
    /* no-op */
  }
  async metricsTest(_name: string): Promise<void> {
    /* no-op */
  }
  async metricsQuery(_name: string, promql: string): Promise<PromQueryResult> {
    void promql;
    return { resultType: 'matrix', series: [] };
  }
  // metricsQueryRange is inherited from BaseRpcProvider (empty default).
  async grafanaList(): Promise<GrafanaConfig[]> {
    return [];
  }
  async grafanaUpsert(_input: GrafanaConfigUpsert): Promise<GrafanaConfig> {
    return notImplemented('grafana_upsert');
  }
  async grafanaRemove(_name: string): Promise<void> {
    /* no-op */
  }
  async grafanaTest(_name: string): Promise<void> {
    /* no-op */
  }
  async grafanaPresets(): Promise<DashboardPreset[]> {
    return [];
  }
  async grafanaDashboardUrl(
    _name: string,
    _uid: string,
    _fromMs: number,
    _toMs: number
  ): Promise<string> {
    return '';
  }
  async alertManagerList(): Promise<AlertManager[]> {
    return [];
  }
  async alertManagerUpsert(_input: AlertManagerUpsert): Promise<AlertManager> {
    return notImplemented('alertmanager_upsert');
  }
  async alertManagerRemove(_name: string): Promise<void> {
    /* no-op */
  }
  async alertManagerTest(_name: string): Promise<void> {
    /* no-op */
  }
  async alertManagerAlerts(_name: string): Promise<Alert[]> {
    return [];
  }
  async alertManagerSilences(_name: string): Promise<Silence[]> {
    return [];
  }
  async alertManagerCreateSilence(
    _instance: string,
    _request: import('./types').CreateSilenceRequest
  ): Promise<string> {
    return notImplemented('alertmanager_create_silence');
  }
  async alertManagerDeleteSilence(_instance: string, _silenceId: string): Promise<void> {
    return notImplemented('alertmanager_delete_silence');
  }
  async prometheusRules(_instance: string): Promise<import('./types').RuleGroup[]> {
    return [];
  }
  async lokiList(): Promise<import('./types').LokiConfig[]> {
    return [];
  }
  async lokiUpsert(_input: import('./types').LokiUpsert): Promise<import('./types').LokiConfig> {
    return notImplemented('loki_upsert');
  }
  async lokiRemove(_name: string): Promise<void> {}
  async lokiTest(_name: string): Promise<void> {}
  async auditEvents(_query: import('./types').AuditQuery): Promise<import('./types').AuditEvent[]> {
    return [];
  }
  // grafanaSearchDashboards is inherited from BaseRpcProvider (empty default).

  // ---- Saved queries (Http shell: not proxied yet) ----
  async savedQueriesList(): Promise<SavedQuery[]> {
    return [];
  }
  async savedQueriesUpsert(_query: SavedQuery): Promise<SavedQuery> {
    return notImplemented('saved_queries_upsert');
  }
  async savedQueriesRemove(_name: string): Promise<void> {
    /* no-op */
  }
  async savedQueriesClearCache(): Promise<void> {
    /* no-op */
  }
  // savedQueriesRun is inherited from BaseRpcProvider (empty default).

  // ---- Image manifest (Http shell: not proxied yet) ----
  async imageRegistryManifest(_name: string, _repo: string, _tag: string): Promise<ImageManifest> {
    return notImplemented('image_registry_manifest');
  }

  // ---- SBOM + RBAC Security Audit ----
  // sbomGenerateImage / sbomGenerateCluster / sbomListHistory / sbomGet /
  // sbomExport / securityAudit are all inherited from BaseRpcProvider
  // (faithful bridges over httpInvoke).
}
