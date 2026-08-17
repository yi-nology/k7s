/**
 * BaseRpcProvider — the ~80 one-shot RPC methods shared by every transport-backed
 * provider. Subclasses implement `rpc()` (Tauri binds @tauri-apps invoke, HTTP binds
 * httpInvoke) and keep the streaming / dialog / subscription methods that genuinely
 * differ between transports.
 *
 * Only methods whose body is a single `return invoke<...>('cmd', {args})` live here;
 * anything with branching, byte conversion, native dialogs, or event subscriptions
 * stays in the concrete provider. MockProvider is structurally separate (demo data,
 * no transport) and does not extend this.
 */

import type {
  Alert,
  AlertManager,
  AlertManagerUpsert,
  ApplyResult,
  ClusterInfo,
  ConfigSnapshot,
  DependencyGraph,
  DocDryRun,
  IngressDebugResult,
  ExportFromNodeResult,
  ExportFromRegistryResult,
  ImportImageResult,
  ImageSyncResult,
  SkopeoAvailability,
  ArchiveInfo,
  ContextInfo,
  DashboardPreset,
  EndpointAddress,
  EndpointRow,
  GrafanaConfig,
  GrafanaConfigUpsert,
  GrafanaDashboardSearchResult,
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
  PodFileEntry,
  Properties,
  ResourceRef,
  Revision,
  SavedQuery,
  MetricsConfig,
  MetricsConfigUpsert,
  NodeSample,
  ForwardInfo,
  PromQueryResult,
  Silence,
  Prefs,
  SecretEntry,
  YamlDiff,
  SimulationResult,
} from './types';

export abstract class BaseRpcProvider {
  /**
   * One-shot RPC bound to the concrete transport. Tauri's `invoke` and HTTP's
   * `httpInvoke` both satisfy this signature; the subclass hands the right one
   * to `super()` (or implements it directly).
   */
  protected abstract rpc<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;

  listContexts(): Promise<ContextInfo[]> {
    return this.rpc<ContextInfo[]>('list_contexts');
  }
  connect(context: string): Promise<ClusterInfo> {
    return this.rpc<ClusterInfo>('connect', { context });
  }
  dependencyGraph(): Promise<DependencyGraph> {
    return this.rpc<DependencyGraph>('dependency_graph', {});
  }
  simulateConnectivity(
    srcNamespace: string,
    srcPod: string,
    dstNamespace: string,
    dstPod: string,
    port?: number,
    protocol?: string
  ): Promise<SimulationResult> {
    return this.rpc<SimulationResult>('simulate_connectivity', {
      srcNamespace,
      srcPod,
      dstNamespace,
      dstPod,
      port: port ?? null,
      protocol: protocol ?? null,
    });
  }
  debugIngress(namespace: string, name: string): Promise<IngressDebugResult> {
    return this.rpc<IngressDebugResult>('debug_ingress', { namespace, name });
  }
  restoreImports(paths: string[]): Promise<string[]> {
    return this.rpc<string[]>('restore_imports', { paths });
  }
  getSecretData(namespace: string, name: string): Promise<SecretEntry[]> {
    return this.rpc<SecretEntry[]>('get_secret_data', { namespace, name });
  }

  /** Snapshot a ConfigMap's current state and return all available snapshots. */
  configmapSnapshots(namespace: string, name: string): Promise<ConfigSnapshot[]> {
    return this.rpc<ConfigSnapshot[]>('configmap_snapshots', { namespace, name });
  }

  /** Snapshot a Secret's current state and return all available snapshots. */
  secretSnapshots(namespace: string, name: string): Promise<ConfigSnapshot[]> {
    return this.rpc<ConfigSnapshot[]>('secret_snapshots', { namespace, name });
  }

  /** Get a specific snapshot's YAML by kind, resource name, and version. */
  configmapSnapshotYaml(
    kind: string,
    namespace: string,
    name: string,
    resourceVersion: string
  ): Promise<string | null> {
    return this.rpc<string | null>('configmap_snapshot_yaml', {
      kind,
      namespace,
      name,
      resourceVersion,
    });
  }
  setCordon(node: string, unschedulable: boolean): Promise<void> {
    return this.rpc<void>('set_cordon', { name: node, unschedulable });
  }
  drainNode(node: string): Promise<void> {
    return this.rpc<void>('drain_node', { name: node });
  }
  nodeHistory(node: string): Promise<NodeSample[]> {
    return this.rpc<NodeSample[]>('node_history', { node });
  }
  watchNodeStats(node: string): Promise<void> {
    return this.rpc<void>('watch_node_stats', { node });
  }
  unwatchNodeStats(node: string): Promise<void> {
    return this.rpc<void>('unwatch_node_stats', { node });
  }
  loadPrefs(): Promise<Prefs | null> {
    return this.rpc<Prefs | null>('load_prefs');
  }
  savePrefs(prefs: Prefs): Promise<void> {
    return this.rpc<void>('save_prefs', { prefs });
  }
  watchCustomKind(id: string): Promise<void> {
    return this.rpc('watch_custom_kind', { kind: id });
  }
  unwatchCustomKind(id: string): Promise<void> {
    return this.rpc('unwatch_custom_kind', { kind: id });
  }
  stopPortForward(id: string): Promise<void> {
    return this.rpc<void>('stop_port_forward', { id });
  }
  listPortForwards(): Promise<ForwardInfo[]> {
    return this.rpc<ForwardInfo[]>('list_port_forwards');
  }
  helmListRepos(): Promise<HelmRepo[]> {
    return this.rpc<HelmRepo[]>('helm_list_repos');
  }
  helmAddRepo(input: HelmRepoUpsert): Promise<HelmRepo> {
    return this.rpc<HelmRepo>('helm_add_repo', { ...input });
  }
  helmRemoveRepo(name: string): Promise<void> {
    return this.rpc<void>('helm_remove_repo', { name });
  }
  helmUpdateRepo(name: string): Promise<HelmRepo> {
    return this.rpc<HelmRepo>('helm_update_repo', { name });
  }
  helmUpdateAllRepos(): Promise<HelmRepo[]> {
    return this.rpc<HelmRepo[]>('helm_update_all_repos');
  }
  helmSearchCharts(query: string): Promise<HelmChartSummary[]> {
    return this.rpc<HelmChartSummary[]>('helm_search_charts', { query });
  }
  helmChartVersions(repo: string, chart: string): Promise<HelmChartVersionEntry[]> {
    return this.rpc<HelmChartVersionEntry[]>('helm_chart_versions', { repo, chart });
  }
  helmExportChart(
    repo: string,
    chart: string,
    version: string,
    outputDir: string
  ): Promise<string> {
    return this.rpc<string>('helm_export_chart', { repo, chart, version, outputDir });
  }
  helmImportChart(filePath: string, repoName: string): Promise<string> {
    return this.rpc<string>('helm_import_chart', { filePath, repoName });
  }
  helmLocalCharts(repoName: string): Promise<string[]> {
    return this.rpc<string[]>('helm_local_charts', { repoName });
  }
  helmRunOp(op: HelmOp): Promise<HelmOpResult> {
    // The backend uses serde's `tag = "op"`, which on the wire means the
    // discriminant (`op`) and the variant's fields (`args`) sit side by side
    // at the top level. Flatten into a plain object so `rpc` gets a
    // `Record<string, unknown>` without a type-bypassing cast.
    return this.rpc<HelmOpResult>('helm_run_op', { op: op.op, ...op.args });
  }
  imageRegistryList(): Promise<ImageRegistry[]> {
    return this.rpc<ImageRegistry[]>('image_registry_list');
  }
  imageRegistryUpsert(input: ImageRegistryUpsert): Promise<ImageRegistry> {
    return this.rpc<ImageRegistry>('image_registry_upsert', { ...input });
  }
  imageRegistryRemove(name: string): Promise<void> {
    return this.rpc<void>('image_registry_remove', { name });
  }
  imageRegistryTest(name: string): Promise<void> {
    return this.rpc<void>('image_registry_test', { name });
  }
  imageRegistryRepos(name: string): Promise<ImageRepo[]> {
    return this.rpc<ImageRepo[]>('image_registry_repos', { name });
  }
  imageRegistryTags(name: string, repo: string): Promise<ImageTag[]> {
    return this.rpc<ImageTag[]>('image_registry_tags', { name, repo });
  }
  applyYamlBundle(yaml: string): Promise<ApplyResult[]> {
    return this.rpc<ApplyResult[]>('apply_yaml_bundle', { yaml });
  }
  dryRunYamlBundle(yaml: string): Promise<DocDryRun[]> {
    return this.rpc<DocDryRun[]>('dry_run_yaml_bundle', { yaml });
  }
  importImageToNode(node: string, path: string): Promise<ImportImageResult> {
    return this.rpc<ImportImageResult>('import_image_to_node', { node, path });
  }
  imageSyncStatus(): Promise<SkopeoAvailability> {
    return this.rpc<SkopeoAvailability>('image_sync_status');
  }
  imageInspectArchive(tarPath: string): Promise<ArchiveInfo> {
    return this.rpc<ArchiveInfo>('image_inspect_archive', { tarPath });
  }
  async exportFromNode(node: string, imageRef: string, savePath: string): Promise<ExportFromNodeResult> {
    return this.rpc<ExportFromNodeResult>('export_from_node', { node, imageRef, savePath });
  }
  async listNodeImages(node: string): Promise<string[]> {
    return this.rpc<string[]>('list_node_images', { node });
  }
  listEndpoints(): Promise<EndpointRow[]> {
    return this.rpc<EndpointRow[]>('list_endpoints');
  }
  listEndpointsForService(namespace: string, name: string): Promise<EndpointRow[]> {
    return this.rpc<EndpointRow[]>('list_endpoints_for_service', { namespace, name });
  }
  listEndpointAddresses(namespace: string, name: string): Promise<EndpointAddress[]> {
    return this.rpc<EndpointAddress[]>('list_endpoint_addresses', { namespace, name });
  }
  triggerCronjob(namespace: string, name: string): Promise<string> {
    return this.rpc<string>('trigger_cronjob', { namespace, name });
  }
  metricsList(): Promise<MetricsConfig[]> {
    return this.rpc<MetricsConfig[]>('metrics_list');
  }
  metricsUpsert(input: MetricsConfigUpsert): Promise<MetricsConfig> {
    return this.rpc<MetricsConfig>('metrics_upsert', { ...input });
  }
  metricsRemove(name: string): Promise<void> {
    return this.rpc<void>('metrics_remove', { name });
  }
  metricsTest(name: string): Promise<void> {
    return this.rpc<void>('metrics_test', { name });
  }
  metricsQuery(name: string, promql: string): Promise<PromQueryResult> {
    return this.rpc<PromQueryResult>('metrics_query', { name, promql });
  }
  grafanaList(): Promise<GrafanaConfig[]> {
    return this.rpc<GrafanaConfig[]>('grafana_list');
  }
  grafanaUpsert(input: GrafanaConfigUpsert): Promise<GrafanaConfig> {
    return this.rpc<GrafanaConfig>('grafana_upsert', { ...input });
  }
  grafanaRemove(name: string): Promise<void> {
    return this.rpc<void>('grafana_remove', { name });
  }
  grafanaTest(name: string): Promise<void> {
    return this.rpc<void>('grafana_test', { name });
  }
  grafanaPresets(): Promise<DashboardPreset[]> {
    return this.rpc<DashboardPreset[]>('grafana_presets');
  }
  grafanaDashboardUrl(name: string, uid: string, fromMs: number, toMs: number): Promise<string> {
    return this.rpc<string>('grafana_dashboard_url', { name, uid, fromMs, toMs });
  }
  alertManagerList(): Promise<AlertManager[]> {
    return this.rpc<AlertManager[]>('alertmanager_list');
  }
  alertManagerUpsert(input: AlertManagerUpsert): Promise<AlertManager> {
    return this.rpc<AlertManager>('alertmanager_upsert', { ...input });
  }
  alertManagerRemove(name: string): Promise<void> {
    return this.rpc<void>('alertmanager_remove', { name });
  }
  alertManagerTest(name: string): Promise<void> {
    return this.rpc<void>('alertmanager_test', { name });
  }
  alertManagerAlerts(name: string): Promise<Alert[]> {
    return this.rpc<Alert[]>('alertmanager_alerts', { name });
  }
  alertManagerSilences(name: string): Promise<Silence[]> {
    return this.rpc<Silence[]>('alertmanager_silences', { name });
  }
  alertManagerCreateSilence(
    instance: string,
    request: import('./types').CreateSilenceRequest
  ): Promise<string> {
    return this.rpc<string>('alertmanager_create_silence', { instance, request });
  }
  alertManagerDeleteSilence(instance: string, silenceId: string): Promise<void> {
    return this.rpc<void>('alertmanager_delete_silence', { instance, silenceId });
  }
  prometheusRules(instance: string): Promise<import('./types').RuleGroup[]> {
    return this.rpc<import('./types').RuleGroup[]>('prometheus_rules', { instance });
  }
  lokiList(): Promise<import('./types').LokiConfig[]> {
    return this.rpc<import('./types').LokiConfig[]>('loki_list');
  }
  lokiUpsert(input: import('./types').LokiUpsert): Promise<import('./types').LokiConfig> {
    return this.rpc<import('./types').LokiConfig>('loki_upsert', { ...input });
  }
  lokiRemove(name: string): Promise<void> {
    return this.rpc<void>('loki_remove', { name });
  }
  lokiTest(name: string): Promise<void> {
    return this.rpc<void>('loki_test', { name });
  }
  auditEvents(query: import('./types').AuditQuery): Promise<import('./types').AuditEvent[]> {
    return this.rpc<import('./types').AuditEvent[]>('audit_events', { query });
  }
  savedQueriesList(): Promise<SavedQuery[]> {
    return this.rpc<SavedQuery[]>('saved_queries_list');
  }
  savedQueriesUpsert(query: SavedQuery): Promise<SavedQuery> {
    return this.rpc<SavedQuery>('saved_queries_upsert', { ...query });
  }
  savedQueriesRemove(name: string): Promise<void> {
    return this.rpc<void>('saved_queries_remove', { name });
  }
  savedQueriesClearCache(): Promise<void> {
    return this.rpc<void>('saved_queries_clear_cache');
  }
  imageRegistryManifest(name: string, repo: string, tag: string): Promise<ImageManifest> {
    return this.rpc<ImageManifest>('image_registry_manifest', { name, repo, tag });
  }
  sbomGenerateImage(
    imageRef: string,
    format: import('./types/sbom').SbomFormat
  ): Promise<import('./types/sbom').SbomResult> {
    return this.rpc('sbom_generate_image', { image_ref: imageRef, format });
  }
  sbomGenerateCluster(
    format: import('./types/sbom').SbomFormat
  ): Promise<import('./types/sbom').SbomResult> {
    return this.rpc('sbom_generate_cluster', { format });
  }
  sbomListHistory(): Promise<import('./types/sbom').SbomSummary[]> {
    return this.rpc('sbom_list_history');
  }
  sbomGet(id: string): Promise<import('./types/sbom').SbomResult> {
    return this.rpc('sbom_get', { id });
  }
  sbomExport(id: string, outputPath: string): Promise<string> {
    return this.rpc('sbom_export', { id, output_path: outputPath });
  }
  securityAudit(): Promise<import('./types/security').AuditReport> {
    return this.rpc('security_audit_run');
  }
  rbacPermissionMatrix(): Promise<import('./types/security').PermissionMatrix> {
    return this.rpc('rbac_permission_matrix');
  }
  scannerStatus(): Promise<import('./types/scanner').ScannerStatus> {
    return this.rpc('scanner_status');
  }

  // ── ResourceRef helpers (shared by all transports) ─────────────────
  //
  // These accept a ResourceRef, destructure it, and forward to the backend.
  // Both TauriProvider and HttpProvider had identical copies; they now live
  // here so there is a single source of truth.

  getYaml(ref: ResourceRef): Promise<string> {
    return this.rpc<string>('get_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  applyYaml(ref: ResourceRef, text: string): Promise<void> {
    return this.rpc<void>('apply_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      yaml: text,
    });
  }
  dryRunYaml(ref: ResourceRef, text: string): Promise<YamlDiff> {
    return this.rpc<YamlDiff>('dry_run_yaml', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      yaml: text,
    });
  }
  getProperties(ref: ResourceRef): Promise<Properties> {
    return this.rpc<Properties>('get_properties', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  deleteResource(ref: ResourceRef): Promise<void> {
    return this.rpc<void>('delete_resource', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  scaleResource(ref: ResourceRef, replicas: number): Promise<void> {
    return this.rpc<void>('scale_resource', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      replicas,
    });
  }
  restartPod(ref: ResourceRef): Promise<void> {
    return this.rpc<void>('restart_pod', {
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  diagnosePod(namespace: string, pod: string): Promise<import('./types').PodDiagnosis> {
    return this.rpc<import('./types').PodDiagnosis>('diagnose_pod', { namespace, pod });
  }
  restartRollout(ref: ResourceRef): Promise<void> {
    return this.rpc<void>('restart_rollout', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  listRevisions(ref: ResourceRef): Promise<Revision[]> {
    return this.rpc<Revision[]>('list_revisions', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  undoRollout(ref: ResourceRef, toRevision?: number): Promise<void> {
    return this.rpc<void>('undo_rollout', {
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
      toRevision: toRevision ?? null,
    });
  }

  // ── Default stubs for transport-specific methods ───────────────────
  //
  // TauriProvider overrides these with real implementations (native
  // dialogs, streaming subscriptions, base64 conversion, etc.).
  // HttpProvider inherits the defaults, removing ~15 stub methods.

  /** No-op where there is no native window (browser shell). */
  setWindowTheme(_theme: 'dark' | 'light'): Promise<void> {
    return Promise.resolve();
  }

  /** No-op in transports without a client-side pod-stats fanout. */
  watchPodStats(_key: string): Promise<void> {
    return Promise.resolve();
  }
  unwatchPodStats(_key: string): Promise<void> {
    return Promise.resolve();
  }

  /** Default values.yaml stub (Tauri overrides with `helm show values`). */
  helmRenderDefaultValues(_chart: string, _version: string, _kubeconfig?: string): Promise<string> {
    return Promise.resolve('');
  }
  /** Release history stub (Tauri overrides with real Helm history). */
  helmReleaseHistory(
    _release: string,
    _namespace: string,
    _kubeconfig?: string
  ): Promise<HelmRevisionEntry[]> {
    return Promise.resolve([]);
  }
  helmManifestRevision(namespace: string, name: string, revision: number): Promise<string> {
    return this.rpc<string>('helm_manifest_revision', { namespace, name, revision });
  }
  helmValuesRevision(namespace: string, name: string, revision: number): Promise<unknown> {
    return this.rpc<unknown>('helm_values_revision', { namespace, name, revision });
  }

  // ---- Pod file management defaults ----
  podFilesList(_ref: ResourceRef, _container: string | null, _path: string): Promise<PodFileEntry[]> {
    return Promise.resolve([]);
  }
  podFilesRead(_ref: ResourceRef, _container: string | null, _path: string): Promise<string> {
    return Promise.resolve('');
  }
  podFilesWrite(
    _ref: ResourceRef,
    _container: string | null,
    _path: string,
    _content: string
  ): Promise<void> {
    return Promise.resolve();
  }
  podFilesDownload(_ref: ResourceRef, _container: string | null, _path: string): Promise<Uint8Array> {
    return Promise.resolve(new Uint8Array());
  }
  podFilesUpload(
    _ref: ResourceRef,
    _container: string | null,
    _destDir: string,
    _tarBytes: Uint8Array
  ): Promise<void> {
    return Promise.resolve();
  }

  // ---- Image transfer defaults (desktop-only) ----
  exportFromRegistry(
    _registryName: string,
    _repo: string,
    _tag: string,
    _savePath: string,
    _insecureSrc: boolean,
    _onLog: (line: string) => void
  ): Promise<ExportFromRegistryResult> {
    return Promise.reject(new Error('Registry export is only available in the desktop app'));
  }
  imageCopy(
    _source: string,
    _destRegistry: string,
    _destRepo: string,
    _destTag: string,
    _srcCreds: string | null,
    _insecureSrc: boolean,
    _insecureDest: boolean,
    _onLog: (line: string) => void
  ): Promise<ImageSyncResult> {
    return Promise.reject(new Error('Image sync is only available in the desktop app'));
  }

  // ---- Metrics range query default ----
  metricsQueryRange(
    _name: string,
    _promql: string,
    _startMs: number,
    _endMs: number,
    _stepSeconds: number
  ): Promise<PromQueryResult> {
    return Promise.resolve({ resultType: 'matrix', series: [] });
  }

  // ---- Grafana dashboard search default ----
  grafanaSearchDashboards(
    _name: string,
    _query: string
  ): Promise<GrafanaDashboardSearchResult[]> {
    return Promise.resolve([]);
  }

  // ---- Saved PromQL queries run default ----
  savedQueriesRun(
    _query: SavedQuery,
    _instance: string,
    _forceRefresh: boolean
  ): Promise<PromQueryResult> {
    return Promise.resolve({ resultType: 'matrix', series: [] });
  }

  // ── AI assistant ────────────────────────────────────────────────────
  aiGetConfig(): Promise<import('../lib/ai/types').AiConfigView> {
    return this.rpc('ai_get_config');
  }
  aiGetContext(): Promise<string> {
    return this.rpc('ai_get_context');
  }
  aiSaveConfig(config: import('../lib/ai/types').AiConfig): Promise<void> {
    return this.rpc('ai_save_config', { configInput: config });
  }
  aiSaveApiKey(apiKey: string): Promise<void> {
    return this.rpc('ai_save_api_key', { apiKey });
  }
  aiTestConnection(): Promise<string> {
    return this.rpc('ai_test_connection');
  }
  aiListSkills(): Promise<import('../lib/ai/types').Skill[]> {
    return this.rpc('ai_list_skills');
  }
  aiMemoryList(kubeContext: string, tier?: string): Promise<import('../lib/ai/types').MemoryEntry[]> {
    return this.rpc('ai_memory_list', { kubeContext, tier });
  }
  aiMemorySearch(kubeContext: string, query: string): Promise<import('../lib/ai/types').MemoryEntry[]> {
    return this.rpc('ai_memory_search', { kubeContext, query });
  }
  aiMemoryAdd(kubeContext: string, content: string, tags: string[], tier?: string): Promise<void> {
    return this.rpc('ai_memory_add', { kubeContext, content, tags, tier });
  }
  aiMemoryDelete(kubeContext: string, id: string): Promise<boolean> {
    return this.rpc('ai_memory_delete', { kubeContext, id });
  }
  aiMemoryClear(kubeContext: string, tier?: string): Promise<void> {
    return this.rpc('ai_memory_clear', { kubeContext, tier });
  }
  aiMemoryPreferences(kubeContext: string): Promise<import('../lib/ai/types').UserPreference[]> {
    return this.rpc('ai_memory_preferences', { kubeContext });
  }
  aiMemorySearchVault(kubeContext: string, query: string): Promise<import('../lib/ai/types').MemoryEntry[]> {
    return this.rpc('ai_memory_search_vault', { kubeContext, query });
  }
  aiCronList(): Promise<import('../lib/ai/types').CronTask[]> {
    return this.rpc('ai_cron_list');
  }
  aiCronPresets(): Promise<import('../lib/ai/types').CronTask[]> {
    return this.rpc('ai_cron_presets');
  }
  aiCronAdd(task: import('../lib/ai/types').CronTask): Promise<void> {
    return this.rpc('ai_cron_add', { task });
  }
  aiCronToggle(id: string): Promise<boolean> {
    return this.rpc('ai_cron_toggle', { id });
  }
  aiCronDelete(id: string): Promise<boolean> {
    return this.rpc('ai_cron_delete', { id });
  }
  aiEvolutionStrategies(): Promise<unknown[]> {
    return this.rpc('ai_evolution_strategies');
  }
  aiChat(request: unknown, sessionId?: string): Promise<string> {
    return this.rpc('ai_chat', { request, sessionId });
  }
  aiCancel(runId: string): Promise<void> {
    return this.rpc('ai_cancel', { runId });
  }
  aiApproveToolCall(runId: string, callId: string, approved: boolean): Promise<void> {
    return this.rpc('ai_approve_tool_call', { runId, callId, approved });
  }
}
