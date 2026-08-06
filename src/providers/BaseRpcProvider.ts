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
  DocDryRun,
  ExportFromNodeResult,
  ImportImageResult,
  SkopeoAvailability,
  ArchiveInfo,
  ContextInfo,
  DashboardPreset,
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
  ImageRegistry,
  ImageRegistryUpsert,
  ImageRepo,
  ImageTag,
  ImageManifest,
  SavedQuery,
  MetricsConfig,
  MetricsConfigUpsert,
  NodeSample,
  ForwardInfo,
  PromQueryResult,
  Silence,
  Prefs,
  SecretEntry,
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
  restoreImports(paths: string[]): Promise<string[]> {
    return this.rpc<string[]>('restore_imports', { paths });
  }
  getSecretData(namespace: string, name: string): Promise<SecretEntry[]> {
    return this.rpc<SecretEntry[]>('get_secret_data', { namespace, name });
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
    // discriminant is the *top-level* field. Mirror that on the JS side so
    // the call site can stay readable.
    return this.rpc<HelmOpResult>('helm_run_op', op as unknown as Record<string, unknown>);
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
}
