/**
 * HttpProvider — the browser shell's DataProvider.
 *
 * Uses {@link httpInvoke} for one-shot commands and {@link httpSubscribe} for
 * live event streams. The wire format mirrors the Tauri IPC channel closely
 * (same event names, same payload shapes), so the two providers are
 * interchangeable from the UI's point of view.
 *
 * What works:
 * - `listContexts` / `connect` (via the k7s-web server, which talks to your
 *   real cluster).
 * - `getYaml` / `getEvents` / `getProperties` / `loadPrefs` / `savePrefs`.
 * - All mutations: `applyYaml`, `dryRunYaml`, `deleteResource`, `scaleResource`,
 *   `setCordon`, `restartPod`, `restartRollout`, `drainNode`.
 * - Log streaming (`startLogs` / `saveLogs` / `stopLogs`).
 * - Shells (`startShell` / `startNodeShell` / `stopShell`) — exec over SSE,
 *   input/resize as POSTs.
 * - `onResourceUpdate` / `onClusterStatus` / `onWatchStatus` /
 *   `onCustomKinds` / `onPodMetrics` / `onNodeMetrics` via SSE.
 *
 * What's still stubbed (rejects with a clear error so the UI can show it):
 * - Port forwards (`startPortForward` / `startServicePortForward` /
 *   `listPortForwards`). Bidirectional framing over SSE isn't built yet.
 * - The Tauri-specific bits (`setWindowTheme`, `importKubeconfig` from disk).
 */

import { httpInvoke, httpSubscribe } from './transport';
import type {
  ApplyResult,
  Alert,
  AlertManager,
  DocDryRun,
  ImportImageResult,
  SkopeoAvailability,
  ImageSyncResult,
  ArchiveInfo,
  AlertManagerUpsert,
  ClusterInfo,
  ClusterStatus,
  ContextInfo,
  DataProvider,
  DashboardPreset,
  DrainProgress,
  EndpointAddress,
  EndpointRow,
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
  HelmRevisionEntry,
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
  PodFileEntry,
  PodMetricsMap,
  PodSample,
  Prefs,
  PromQueryResult,
  Properties,
  CustomKind,
  ResourceRef,
  Row,
  SavedLog,
  ShellHandle,
  SecretEntry,
  Silence,
  Unsub,
  Revision,
  YamlDiff,
} from './types';

/** All not-bridged methods share this rejection so the UI shows the same message. */
function notImplemented(method: string): Promise<never> {
  return Promise.reject(new Error(`${method} is not bridged through the browser shell yet`));
}

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

export class HttpProvider implements DataProvider {
  // ---- one-shot commands ----

  listContexts(): Promise<ContextInfo[]> {
    return httpInvoke<ContextInfo[]>('list_contexts');
  }

  connect(context: string): Promise<ClusterInfo> {
    return httpInvoke<ClusterInfo>('connect', { context });
  }

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

  getYaml(ref: ResourceRef): Promise<string> {
    return httpInvoke<string>('get_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  applyYaml(ref: ResourceRef, text: string): Promise<void> {
    return httpInvoke<void>('apply_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      yaml: text,
    });
  }

  dryRunYaml(ref: ResourceRef, text: string): Promise<YamlDiff> {
    return httpInvoke<YamlDiff>('dry_run_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      yaml: text,
    });
  }

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

  getProperties(ref: ResourceRef): Promise<Properties> {
    return httpInvoke<Properties>('get_properties', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }

  getSecretData(namespace: string, name: string): Promise<SecretEntry[]> {
    return httpInvoke<SecretEntry[]>('get_secret_data', { namespace, name });
  }

  // ---- mutations ----

  deleteResource(ref: ResourceRef): Promise<void> {
    return httpInvoke<void>('delete_resource', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  scaleResource(ref: ResourceRef, replicas: number): Promise<void> {
    return httpInvoke<void>('scale_resource', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      replicas,
    });
  }
  restartPod(ref: ResourceRef): Promise<void> {
    return httpInvoke<void>('restart_pod', {
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  restartRollout(ref: ResourceRef): Promise<void> {
    return httpInvoke<void>('restart_rollout', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  listRevisions(ref: ResourceRef): Promise<Revision[]> {
    return httpInvoke<Revision[]>('list_revisions', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  undoRollout(ref: ResourceRef, toRevision?: number): Promise<void> {
    return httpInvoke<void>('undo_rollout', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      toRevision: toRevision ?? null,
    });
  }
  setCordon(node: string, unschedulable: boolean): Promise<void> {
    return httpInvoke<void>('set_cordon', { name: node, unschedulable });
  }
  drainNode(node: string): Promise<void> {
    return httpInvoke<void>('drain_node', { name: node });
  }
  setWindowTheme(_theme: 'dark' | 'light'): Promise<void> {
    // No-op in the browser — CSS variables handle dark/light via the
    // [data-theme] attribute on <html>; nothing to push to a native window.
    return Promise.resolve();
  }

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
    // The browser has no native "save file" dialog wired up. We download the
    // log text via a transient anchor in the calling component (it owns the
    // <a download>), so this just hands back the URL pattern; the actual
    // export is performed by a custom round-trip below.
    const url = `/api/invoke/export_logs`;
    // Issue the export as a POST with a JSON body, get the line count back
    // so the caller can show "saved N lines". A richer implementation would
    // stream the text back; for now, save to a server-side temp and let the
    // browser download it through a separate GET. (B47)
    const path = `/tmp/k7s-logs-${ref.namespace}-${ref.name}-${Date.now()}.log`;
    const lines = await httpInvoke<number>(url, {
      namespace: ref.namespace ?? '',
      pod: ref.name,
      container,
      sinceSeconds: opts.sinceSeconds ?? null,
      previous: opts.previous ?? false,
      path,
    });
    return {
      path,
      lines,
      bytes: 0, // back-end doesn't echo this; the UI can stat the file
    } as SavedLog;
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
  watchPodStats(_key: string): Promise<void> {
    return Promise.resolve();
  }
  unwatchPodStats(_key: string): Promise<void> {
    return Promise.resolve();
  }

  // ---- preferences ----

  loadPrefs(): Promise<Prefs | null> {
    return httpInvoke<Prefs | null>('load_prefs');
  }
  savePrefs(prefs: Prefs): Promise<void> {
    return httpInvoke<void>('save_prefs', { prefs });
  }

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

  onWatchKindStatus(cb: (kind: string, status: 'ok' | 'forbidden') => void): Unsub {
    const sub = httpSubscribe<{ kind: string; status: string }>('watch-kind-status', (payload) => {
      cb(payload.kind, payload.status as 'ok' | 'forbidden');
    });
    return () => sub.unsubscribe();
  }

  onDrainProgress(_cb: (progress: DrainProgress) => void): Unsub {
    // No drain support in the web shell; return a no-op so the UI doesn't
    // have to special-case it.
    return () => {};
  }

  onNodeStats(_cb: (node: string, sample: NodeSample) => void): Unsub {
    return () => {};
  }
  onNodeStatsError(_cb: (err: NodeStatsError) => void): Unsub {
    return () => {};
  }
  onPodStats(_cb: (key: string, sample: PodSample) => void): Unsub {
    return () => {};
  }

  onForwards(_cb: (forwards: ForwardInfo[]) => void): Unsub {
    return () => {};
  }

  // ---- Helm marketplace: web shell doesn't proxy these yet. ----
  async helmListRepos(): Promise<HelmRepo[]> {
    throw new Error('helm_list_repos not implemented in HttpProvider');
  }
  async helmAddRepo(_input: HelmRepoUpsert): Promise<HelmRepo> {
    throw new Error('helm_add_repo not implemented in HttpProvider');
  }
  async helmRemoveRepo(_name: string): Promise<void> {
    throw new Error('helm_remove_repo not implemented in HttpProvider');
  }
  async helmUpdateRepo(_name: string): Promise<HelmRepo> {
    throw new Error('helm_update_repo not implemented in HttpProvider');
  }
  async helmUpdateAllRepos(): Promise<HelmRepo[]> {
    throw new Error('helm_update_all_repos not implemented in HttpProvider');
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
    throw new Error('helm_export_chart not implemented in HttpProvider');
  }
  async helmImportChart(_filePath: string, _repoName: string): Promise<string> {
    throw new Error('helm_import_chart not implemented in HttpProvider');
  }
  async helmLocalCharts(_repoName: string): Promise<string[]> {
    return [];
  }
  async helmRenderDefaultValues(_chart: string, _version: string, _kc?: string): Promise<string> {
    return '';
  }
  async helmRunOp(_op: HelmOp): Promise<HelmOpResult> {
    throw new Error('helm_run_op not implemented in HttpProvider');
  }
  async helmReleaseHistory(_r: string, _ns: string, _kc?: string): Promise<HelmRevisionEntry[]> {
    return [];
  }
  onHelmOpLog(_cb: (line: { stream: 'stdout' | 'stderr'; line: string }) => void): Unsub {
    return () => {};
  }
  onHelmOpDone(_cb: (result: HelmOpResult) => void): Unsub {
    return () => {};
  }

  // ---- Pod files: not proxied yet. ----
  async podFilesList(_r: ResourceRef, _c: string | null, _p: string): Promise<PodFileEntry[]> {
    return [];
  }
  async podFilesRead(_r: ResourceRef, _c: string | null, _p: string): Promise<string> {
    return '';
  }
  async podFilesWrite(
    _r: ResourceRef,
    _c: string | null,
    _p: string,
    _content: string
  ): Promise<void> {
    // No-op.
  }
  async podFilesDownload(_r: ResourceRef, _c: string | null, _p: string): Promise<Uint8Array> {
    return new Uint8Array();
  }
  async podFilesUpload(
    _r: ResourceRef,
    _c: string | null,
    _d: string,
    _t: Uint8Array
  ): Promise<void> {
    // No-op.
  }

  // ---- Image registry: not proxied yet. ----
  async imageRegistryList(): Promise<ImageRegistry[]> {
    return [];
  }
  async imageRegistryUpsert(_input: ImageRegistryUpsert): Promise<ImageRegistry> {
    throw new Error('image_registry_upsert not implemented in HttpProvider');
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

  // ---- Multi-doc dry run: not proxied yet. ----
  async dryRunYamlBundle(_yaml: string): Promise<DocDryRun[]> {
    return [];
  }

  // ---- Image import: desktop only. The web shell has no access to the
  // user's local filesystem, so the native file-picker path doesn't apply
  // and there's no HTTP route to bridge. Throw a clear message; the panel
  // surfaces it as a "desktop app only" notice. ----
  async importImageToNode(_node: string, _path: string): Promise<ImportImageResult> {
    throw new Error('Image import is only available in the desktop app');
  }

  async imageSyncStatus(): Promise<SkopeoAvailability> {
    throw new Error('Image sync is only available in the desktop app');
  }

  async imageInspectArchive(_tarPath: string): Promise<ArchiveInfo> {
    throw new Error('Image inspect is only available in the desktop app');
  }

  async imageCopy(
    _source: string,
    _destRegistry: string,
    _destRepo: string,
    _destTag: string,
    _srcCreds: string | null,
    _insecureSrc: boolean,
    _insecureDest: boolean,
    _onLog: (line: string) => void
  ): Promise<ImageSyncResult> {
    throw new Error('Image sync is only available in the desktop app');
  }

  // ---- Endpoints / metrics / grafana / alerting (Phase 1 Tier-2) ----
  // Not proxied through the web shell yet; the k7s-web server doesn't
  // implement these routes. Throw for everything, return [] for reads
  // so the UI renders "no data" rather than an error.
  async listEndpoints(): Promise<EndpointRow[]> {
    return httpInvoke<EndpointRow[]>('list_endpoints');
  }
  async listEndpointsForService(ns: string, name: string): Promise<EndpointRow[]> {
    return httpInvoke<EndpointRow[]>('list_endpoints_for_service', { namespace: ns, name });
  }
  async listEndpointAddresses(ns: string, name: string): Promise<EndpointAddress[]> {
    return httpInvoke<EndpointAddress[]>('list_endpoint_addresses', { namespace: ns, name });
  }
  async triggerCronjob(_ns: string, _name: string): Promise<string> {
    throw new Error('trigger_cronjob not implemented in HttpProvider');
  }
  async metricsList(): Promise<MetricsConfig[]> {
    return [];
  }
  async metricsUpsert(_input: MetricsConfigUpsert): Promise<MetricsConfig> {
    throw new Error('metrics_upsert not implemented in HttpProvider');
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
  async metricsQueryRange(
    _name: string,
    _promql: string,
    _start: number,
    _end: number,
    _step: number
  ): Promise<PromQueryResult> {
    return { resultType: 'matrix', series: [] };
  }
  async grafanaList(): Promise<GrafanaConfig[]> {
    return [];
  }
  async grafanaUpsert(_input: GrafanaConfigUpsert): Promise<GrafanaConfig> {
    throw new Error('grafana_upsert not implemented in HttpProvider');
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
    throw new Error('alertmanager_upsert not implemented in HttpProvider');
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
    throw new Error('alertmanager_create_silence not implemented in HttpProvider');
  }
  async alertManagerDeleteSilence(_instance: string, _silenceId: string): Promise<void> {
    throw new Error('alertmanager_delete_silence not implemented in HttpProvider');
  }
  async prometheusRules(_instance: string): Promise<import('./types').RuleGroup[]> {
    return [];
  }
  async lokiList(): Promise<import('./types').LokiConfig[]> {
    return [];
  }
  async lokiUpsert(_input: import('./types').LokiUpsert): Promise<import('./types').LokiConfig> {
    throw new Error('loki_upsert not implemented in HttpProvider');
  }
  async lokiRemove(_name: string): Promise<void> {}
  async lokiTest(_name: string): Promise<void> {}
  async auditEvents(_query: import('./types').AuditQuery): Promise<import('./types').AuditEvent[]> {
    return [];
  }
  async grafanaSearchDashboards(
    _name: string,
    _query: string
  ): Promise<import('./types').GrafanaDashboardSearchResult[]> {
    return [];
  }

  // ---- Saved queries (Http shell: not proxied yet) ----
  async savedQueriesList(): Promise<SavedQuery[]> {
    return [];
  }
  async savedQueriesUpsert(_query: SavedQuery): Promise<SavedQuery> {
    throw new Error('saved_queries_upsert not implemented in HttpProvider');
  }
  async savedQueriesRemove(_name: string): Promise<void> {
    /* no-op */
  }
  async savedQueriesClearCache(): Promise<void> {
    /* no-op */
  }
  async savedQueriesRun(
    _query: SavedQuery,
    _instance: string,
    _force: boolean
  ): Promise<PromQueryResult> {
    return { resultType: 'matrix', series: [] };
  }

  // ---- Image manifest (Http shell: not proxied yet) ----
  async imageRegistryManifest(_name: string, _repo: string, _tag: string): Promise<ImageManifest> {
    throw new Error('image_registry_manifest not implemented in HttpProvider');
  }

  // ---- SBOM (Software Bill of Materials) ----
  async sbomGenerateImage(
    imageRef: string,
    format: import('./types/sbom').SbomFormat
  ): Promise<import('./types/sbom').SbomResult> {
    return httpInvoke('sbom_generate_image', { image_ref: imageRef, format });
  }

  async sbomGenerateCluster(
    format: import('./types/sbom').SbomFormat
  ): Promise<import('./types/sbom').SbomResult> {
    return httpInvoke('sbom_generate_cluster', { format });
  }

  async sbomListHistory(): Promise<import('./types/sbom').SbomSummary[]> {
    return httpInvoke('sbom_list_history');
  }

  async sbomGet(id: string): Promise<import('./types/sbom').SbomResult> {
    return httpInvoke('sbom_get', { id });
  }

  async sbomExport(id: string, outputPath: string): Promise<string> {
    return httpInvoke('sbom_export', { id, output_path: outputPath });
  }

  // ---- RBAC Security Audit ----
  async securityAudit(): Promise<import('./types/security').AuditReport> {
    return httpInvoke('security_audit_run');
  }
}
