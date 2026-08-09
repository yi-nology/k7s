/**
 * The full DataProvider contract — the interface between UI and backend.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

import type { CustomKind, KindId } from './resource';
import type { EventItem, Row } from './table';
import type {
  ClusterInfo,
  ClusterStatus,
  ContextInfo,
  ImportResult,
  Prefs,
  ResourceRef,
} from './cluster';
import type {
  DrainProgress,
  ForwardInfo,
  LogHandle,
  LogLine,
  LogOptions,
  NodeMetricsMap,
  NodeSample,
  NodeShellHandle,
  NodeStatsError,
  PodMetricsMap,
  PodSample,
  Properties,
  Revision,
  SavedLog,
  SecretEntry,
  ShellHandle,
  Unsub,
  YamlDiff,
} from './kubernetes';
import type {
  HelmChartSummary,
  HelmChartVersionEntry,
  HelmOp,
  HelmOpResult,
  HelmRepo,
  HelmRepoUpsert,
  HelmRevisionEntry,
} from './helm';
import type {
  Alert,
  AlertManager,
  AlertManagerUpsert,
  AuditEvent,
  AuditQuery,
  CreateSilenceRequest,
  DashboardPreset,
  EndpointAddress,
  EndpointRow,
  GrafanaConfig,
  GrafanaConfigUpsert,
  GrafanaDashboardSearchResult,
  LokiConfig,
  LokiUpsert,
  MetricsConfig,
  MetricsConfigUpsert,
  PromQueryResult,
  RuleGroup,
  SavedQuery,
  Silence,
} from './observability';
import type {
  ArchiveInfo,
  ExportFromNodeResult,
  ExportFromRegistryResult,
  ImageManifest,
  ImageRegistry,
  ImageRegistryUpsert,
  ImageRepo,
  ImageSyncResult,
  ImageTag,
  ImportImageResult,
  PodFileEntry,
  SkopeoAvailability,
} from './image';
import type { ApplyResult, DocDryRun } from './operations';
import type { SbomFormat, SbomResult, SbomSummary } from './sbom';
import type { AuditReport } from './security';

/**
 * The full provider contract. See file header for the two implementations.
 */
export interface DataProvider {
  // ---- one-shot commands ----
  /** The switcher list: default kubeconfig contexts plus any imported ones. */
  listContexts(): Promise<ContextInfo[]>;
  connect(context: string): Promise<ClusterInfo>;
  /**
   * Import contexts from a kubeconfig file (via a native file picker). Returns the
   * merged list and the imported path, or null if the user cancelled.
   */
  importKubeconfig(): Promise<ImportResult | null>;
  /**
   * Re-register previously imported kubeconfig files on boot (B17). Returns the
   * paths that still parse — callers should persist that, dropping the rest.
   * Must run before {@link listContexts} for imports to appear in the switcher.
   */
  restoreImports(paths: string[]): Promise<string[]>;
  getYaml(ref: ResourceRef): Promise<string>;
  /** Rejects with the API error message (shown inline) on failure. */
  applyYaml(ref: ResourceRef, text: string): Promise<void>;
  /**
   * Send an edit as a server-side dry run and return both sides for a diff
   * (B36). Rejects with the server's message when admission refuses it —
   * nothing is written either way.
   */
  dryRunYaml(ref: ResourceRef, text: string): Promise<YamlDiff>;
  getEvents(ref: ResourceRef): Promise<EventItem[]>;
  /**
   * Properties for an object: what it's wired to, as a generic section document.
   * Rejects for kinds without a gatherer — see `KINDS_WITH_PROPERTIES`, which is
   * what stops the tab being offered for them (B13, B18).
   */
  getProperties(ref: ResourceRef): Promise<Properties>;

  /** Decode Secret data (base64 -> text). Explicit user action — values are otherwise redacted. */
  getSecretData(namespace: string, name: string): Promise<SecretEntry[]>;

  // ---- mutations (B3); all reject with the API error message on failure ----
  /** Delete a resource of any kind. */
  deleteResource(ref: ResourceRef): Promise<void>;
  /** Scale a Deployment/StatefulSet to `replicas`. */
  scaleResource(ref: ResourceRef, replicas: number): Promise<void>;
  /**
   * Restart a pod (B34) by deleting it; its controller recreates a fresh one.
   * Rejects for a pod with no controller — that would just delete it.
   */
  restartPod(ref: ResourceRef): Promise<void>;
  /**
   * Rollout-restart a Deployment/StatefulSet/DaemonSet (B34) — the `kubectl
   * rollout restart` template-annotation patch, rolled through the update strategy.
   */
  restartRollout(ref: ResourceRef): Promise<void>;
  /**
   * List the revision history of a Deployment/StatefulSet/DaemonSet — the data
   * behind the Revisions detail tab. Newest revision first. RBAC denials degrade
   * to an empty list rather than rejecting, so the tab still opens.
   */
  listRevisions(ref: ResourceRef): Promise<Revision[]>;
  /**
   * Roll a workload back to `toRevision`, or to the previous revision when
   * `toRevision` is omitted — the `kubectl rollout undo` default. The controller
   * rolls through its normal update strategy, respecting surge/MaxUnavailable.
   */
  undoRollout(ref: ResourceRef, toRevision?: number): Promise<void>;
  /** Cordon or uncordon a node. */
  setCordon(node: string, unschedulable: boolean): Promise<void>;
  /**
   * Drain a node (B20): cordon it, then evict its pods in the background.
   * Resolves once cordoned — watch {@link onDrainProgress} for the rest.
   */
  drainNode(node: string): Promise<void>;

  /**
   * Tell the OS window which palette the app is using (B52), so the native
   * titlebar and scrollbars match. CSS can't reach window chrome, and this is the
   * only reason the frontend needs the window API — hence it going through the
   * provider rather than importing Tauri into a hook, which would break demo mode
   * in a plain browser. A no-op where there is no native window.
   */
  setWindowTheme(theme: 'dark' | 'light'): Promise<void>;

  /**
   * Open a root shell on a node's host OS (B53).
   *
   * Creates a privileged pod on that node and `nsenter`s into the host's
   * namespaces — see src-tauri/src/kube/nodeshell.rs for exactly what that grants.
   * Only ever call this from an explicit, confirmed user action; it is not
   * something to do speculatively or on navigation.
   *
   * Resolves once the shell is attached, which can take a while on first use
   * (the node pulls the image). Rejects with an explanation if the pod never
   * starts — a NotReady node and a wrong-architecture image are the usual causes.
   */
  startNodeShell(
    node: string,
    onOutput: (data: string) => void,
    onClosed: (reason: string) => void
  ): Promise<NodeShellHandle>;

  // ---- node-exporter statistics (B27) ----
  /**
   * Start scraping a node's node-exporter. Lazy, like custom kinds: each scrape
   * moves a few hundred KB and holds a port-forward, so it runs only while the
   * node's Metrics tab is open. Safe to call twice.
   */
  /**
   * Backfill a node's charts from Prometheus (B38), newest last. Resolves to an
   * empty list when the cluster has no Prometheus we recognise — that's the
   * normal no-history case, not a failure, and the live scraper covers it.
   */
  nodeHistory(node: string): Promise<NodeSample[]>;
  watchNodeStats(node: string): Promise<void>;
  /** Stop scraping a node (idempotent). */
  unwatchNodeStats(node: string): Promise<void>;

  /**
   * Start feeding per-pod usage samples for the pod keyed "namespace/name",
   * emitted through `onPodStats`. Unlike a node, this needs no scraper — the
   * cluster-wide metrics poller is already running — so this only marks the pod
   * as one whose samples should be forwarded. Safe to call twice.
   */
  watchPodStats(key: string): Promise<void>;
  /** Stop forwarding a pod's samples (idempotent). */
  unwatchPodStats(key: string): Promise<void>;

  // ---- persisted preferences (B11) ----
  /** Load persisted UI preferences, or null if none / not supported (demo). */
  loadPrefs(): Promise<Prefs | null>;
  /** Persist UI preferences (no-op in demo mode). */
  savePrefs(prefs: Prefs): Promise<void>;

  // ---- custom (CRD-backed) kinds (B15) ----
  /**
   * Start watching a custom kind. Called when the user opens it — watchers are
   * lazy because a cluster can define hundreds of CRDs. Safe to call twice.
   */
  watchCustomKind(id: string): Promise<void>;
  /** Stop watching a custom kind (idempotent). Called when navigating away. */
  unwatchCustomKind(id: string): Promise<void>;

  // ---- push subscriptions (return an unsubscribe fn) ----
  onResourceUpdate(cb: (kind: KindId, rows: Row[]) => void): Unsub;
  /** CRD-backed kinds discovered on connect; re-emitted on every connect. */
  onCustomKinds(cb: (kinds: CustomKind[]) => void): Unsub;
  onPodMetrics(cb: (metrics: PodMetricsMap) => void): Unsub;
  onNodeMetrics(cb: (metrics: NodeMetricsMap) => void): Unsub;
  onClusterStatus(cb: (status: ClusterStatus) => void): Unsub;
  onWatchStatus(cb: (activeStreams: number) => void): Unsub;
  /** Subscribe to AI agent events (SSE `ai_event`). */
  onAiEvent(cb: (data: { runId: string; event: unknown }) => void): Unsub;
  /** Per-kind watch status: "ok" when watching succeeds, "forbidden" on 403. */
  onWatchKindStatus(cb: (kind: string, status: 'ok' | 'forbidden') => void): Unsub;
  /** Progress of running node drains (B20). */
  onDrainProgress(cb: (progress: DrainProgress) => void): Unsub;
  /** node-exporter samples for nodes being watched (B27). */
  onNodeStats(cb: (node: string, sample: NodeSample) => void): Unsub;
  /** Why a watched node has no samples (B27). */
  onNodeStatsError(cb: (err: NodeStatsError) => void): Unsub;
  /** Per-pod usage samples for pods whose Metrics tab is open, keyed "ns/name". */
  onPodStats(cb: (key: string, sample: PodSample) => void): Unsub;

  // ---- log streaming ----
  startLogs(
    ref: ResourceRef,
    container: string,
    opts: LogOptions,
    onLines: (lines: LogLine[]) => void,
    onClosed: (reason: string) => void
  ): Promise<LogHandle>;

  /**
   * Save a pod's full logs to a file the user picks (B29).
   *
   * Not "save what's on screen": the view holds a ring buffer, and the reason to
   * export is usually the part that scrolled away — so this re-reads with no tail
   * cap. Returns null if the user cancelled the save dialog.
   */
  saveLogs(
    ref: ResourceRef,
    container: string,
    opts: { sinceSeconds?: number; previous?: boolean }
  ): Promise<SavedLog | null>;

  // ---- shell / exec (B4) ----
  startShell(
    ref: ResourceRef,
    container: string,
    onOutput: (data: string) => void,
    onClosed: (reason: string) => void
  ): Promise<ShellHandle>;

  // ---- port-forwarding (B6, B16) ----
  /**
   * Forward a port. `ref.kind` selects the strategy: a pod forwards directly; a
   * Service resolves to a Ready backing pod first, and `remotePort` is then the
   * *service* port rather than the pod's (B16).
   */
  startPortForward(ref: ResourceRef, remotePort: number): Promise<ForwardInfo>;
  stopPortForward(id: string): Promise<void>;
  listPortForwards(): Promise<ForwardInfo[]>;
  /** Active forwards, pushed on add/remove/failure (B16). */
  onForwards(cb: (forwards: ForwardInfo[]) => void): Unsub;

  // ---- Helm chart marketplace (Phase 1 of KubePi parity) ----
  /** A configured chart repository. The password never reaches the front-end;
   * it lives in the backend's local secrets store (chmod 0600). */
  helmListRepos(): Promise<HelmRepo[]>;
  helmAddRepo(input: HelmRepoUpsert): Promise<HelmRepo>;
  helmRemoveRepo(name: string): Promise<void>;
  /** Re-fetch a single repo's index.yaml. On failure, the repo's `lastError`
   * is updated and the error is re-thrown for inline display. */
  helmUpdateRepo(name: string): Promise<HelmRepo>;
  helmUpdateAllRepos(): Promise<HelmRepo[]>;
  /** Search every cached index. Empty query returns the full catalog. */
  helmSearchCharts(query: string): Promise<HelmChartSummary[]>;
  helmChartVersions(repo: string, chart: string): Promise<HelmChartVersionEntry[]>;
  /** Export a chart .tgz to a local directory (air-gap / offline). */
  helmExportChart(repo: string, chart: string, version: string, outputDir: string): Promise<string>;
  /** Import a local chart .tgz into the chart cache. */
  helmImportChart(filePath: string, repoName: string): Promise<string>;
  /** List locally imported chart archives for a repo. */
  helmLocalCharts(repoName: string): Promise<string[]>;
  /** Default values.yaml from the chart itself (via `helm show values`). */
  helmRenderDefaultValues(chart: string, version: string, kubeconfig?: string): Promise<string>;
  /** Run install/upgrade/uninstall/rollback to completion. Live logs and the
   * final result stream back through `onHelmOpLog` and `onHelmOpDone`. */
  helmRunOp(op: HelmOp): Promise<HelmOpResult>;
  helmReleaseHistory(
    release: string,
    namespace: string,
    kubeconfig?: string
  ): Promise<HelmRevisionEntry[]>;
  onHelmOpLog(cb: (line: { stream: 'stdout' | 'stderr'; line: string }) => void): Unsub;
  onHelmOpDone(cb: (result: HelmOpResult) => void): Unsub;

  // ---- Pod file management (Phase 2 of KubePi parity) ----
  podFilesList(ref: ResourceRef, container: string | null, path: string): Promise<PodFileEntry[]>;
  podFilesRead(ref: ResourceRef, container: string | null, path: string): Promise<string>;
  podFilesWrite(
    ref: ResourceRef,
    container: string | null,
    path: string,
    content: string
  ): Promise<void>;
  /** Returns the tar archive bytes (base64 in transit). The UI turns these
   * into a user-saved file. */
  podFilesDownload(ref: ResourceRef, container: string | null, path: string): Promise<Uint8Array>;
  /** Upload a tar archive (base64) into a directory inside the container. */
  podFilesUpload(
    ref: ResourceRef,
    container: string | null,
    destDir: string,
    tarBytes: Uint8Array
  ): Promise<void>;

  // ---- Image registry management (Phase 5 of KubePi parity) ----
  imageRegistryList(): Promise<ImageRegistry[]>;
  imageRegistryUpsert(input: ImageRegistryUpsert): Promise<ImageRegistry>;
  imageRegistryRemove(name: string): Promise<void>;
  imageRegistryTest(name: string): Promise<void>;
  imageRegistryRepos(name: string): Promise<ImageRepo[]>;
  imageRegistryTags(name: string, repo: string): Promise<ImageTag[]>;

  // ---- Multi-document YAML apply (Phase 4 — templates) ----
  /** Apply a YAML bundle. Returns one entry per document with an `action`
   * of "created" / "updated" / "failed" and a per-doc error message. */
  applyYamlBundle(yaml: string): Promise<ApplyResult[]>;

  /** Per-document result of a bundle dry run (create-side preview). `proposed`
   * is the server-defaulted manifest that would be stored, or null when the
   * doc errored; `error` carries the per-doc failure reason. */
  dryRunYamlBundle(yaml: string): Promise<DocDryRun[]>;

  // ---- Image import (air-gapped clusters) ----
  /** Import a local `.tar` image archive into a node's container runtime via a
   * temporary privileged pod. `path` is an absolute filesystem path from the
   * native file picker — desktop (Tauri) only; the web shell throws. */
  importImageToNode(node: string, path: string): Promise<ImportImageResult>;

  /** Whether skopeo is installed on the host (gates the To-Registry tab). */
  imageSyncStatus(): Promise<SkopeoAvailability>;

  /** Copy an image into a configured destination registry via `skopeo copy`.
   * `source` is any skopeo transport (`docker://…`, `docker-archive:/path`,
   * `oci:…`). The destination registry is resolved by name from the stored
   * image-registries config. Progress streams via the `onLog` callback. */
  imageCopy(
    source: string,
    destRegistry: string,
    destRepo: string,
    destTag: string,
    srcCreds: string | null,
    insecureSrc: boolean,
    insecureDest: boolean,
    onLog: (line: string) => void
  ): Promise<ImageSyncResult>;

  /** Inspect a local `docker save` tarball: name, tags, digest, arch, os, size. */
  imageInspectArchive(tarPath: string): Promise<ArchiveInfo>;

  // ---- Image Export ----

  /** Export a container image from a K8s node to a local .tar file. */
  exportFromNode(node: string, imageRef: string, savePath: string): Promise<ExportFromNodeResult>;

  /** List container images present on a K8s node. */
  listNodeImages(node: string): Promise<string[]>;

  /** Export an image from a configured registry to a local .tar file. */
  exportFromRegistry(
    registryName: string,
    repo: string,
    tag: string,
    savePath: string,
    insecureSrc: boolean,
    onLog: (line: string) => void
  ): Promise<ExportFromRegistryResult>;

  // ---- Endpoints (Phase 1 Tier-2 of KubePi parity) ----
  /** List all EndpointSlices cluster-wide. */
  listEndpoints(): Promise<EndpointRow[]>;
  /** EndpointSlices for one Service. */
  listEndpointsForService(namespace: string, name: string): Promise<EndpointRow[]>;
  /** Per-address detail for one slice. */
  listEndpointAddresses(namespace: string, name: string): Promise<EndpointAddress[]>;

  // ---- CronJob manual trigger (Phase 2 Tier-2) ----
  /** Create a Job from a CronJob. Returns the new Job's name. */
  triggerCronjob(namespace: string, name: string): Promise<string>;

  // ---- Metrics / Prometheus multi-instance ----
  metricsList(): Promise<MetricsConfig[]>;
  metricsUpsert(input: MetricsConfigUpsert): Promise<MetricsConfig>;
  metricsRemove(name: string): Promise<void>;
  metricsTest(name: string): Promise<void>;
  /** Instant PromQL query. */
  metricsQuery(name: string, promql: string): Promise<PromQueryResult>;
  /** Range query. Times are Unix ms; step is seconds. */
  metricsQueryRange(
    name: string,
    promql: string,
    startMs: number,
    endMs: number,
    stepSeconds: number
  ): Promise<PromQueryResult>;

  // ---- Grafana ----
  grafanaList(): Promise<GrafanaConfig[]>;
  grafanaUpsert(input: GrafanaConfigUpsert): Promise<GrafanaConfig>;
  grafanaRemove(name: string): Promise<void>;
  grafanaTest(name: string): Promise<void>;
  grafanaPresets(): Promise<DashboardPreset[]>;
  /** Build the iframe URL for a given dashboard uid. */
  grafanaDashboardUrl(name: string, uid: string, fromMs: number, toMs: number): Promise<string>;

  // ---- AlertManager ----
  alertManagerList(): Promise<AlertManager[]>;
  alertManagerUpsert(input: AlertManagerUpsert): Promise<AlertManager>;
  alertManagerRemove(name: string): Promise<void>;
  alertManagerTest(name: string): Promise<void>;
  alertManagerAlerts(name: string): Promise<Alert[]>;
  alertManagerSilences(name: string): Promise<Silence[]>;
  alertManagerCreateSilence(instance: string, request: CreateSilenceRequest): Promise<string>;
  alertManagerDeleteSilence(instance: string, silenceId: string): Promise<void>;
  prometheusRules(instance: string): Promise<RuleGroup[]>;

  // ---- Loki / K8s Audit log ----
  lokiList(): Promise<LokiConfig[]>;
  lokiUpsert(input: LokiUpsert): Promise<LokiConfig>;
  lokiRemove(name: string): Promise<void>;
  lokiTest(name: string): Promise<void>;
  auditEvents(query: AuditQuery): Promise<AuditEvent[]>;

  // ---- Grafana dashboard search ----
  grafanaSearchDashboards(name: string, query: string): Promise<GrafanaDashboardSearchResult[]>;

  // ---- Saved PromQL queries + in-memory cache ----
  savedQueriesList(): Promise<SavedQuery[]>;
  savedQueriesUpsert(query: SavedQuery): Promise<SavedQuery>;
  savedQueriesRemove(name: string): Promise<void>;
  savedQueriesClearCache(): Promise<void>;
  savedQueriesRun(
    query: SavedQuery,
    instance: string,
    forceRefresh: boolean
  ): Promise<PromQueryResult>;

  // ---- Image manifest drill-down ----
  imageRegistryManifest(name: string, repo: string, tag: string): Promise<ImageManifest>;

  // ---- SBOM (Software Bill of Materials) ----
  sbomGenerateImage(imageRef: string, format: SbomFormat): Promise<SbomResult>;
  sbomGenerateCluster(format: SbomFormat): Promise<SbomResult>;
  sbomListHistory(): Promise<SbomSummary[]>;
  sbomGet(id: string): Promise<SbomResult>;
  sbomExport(id: string, outputPath: string): Promise<string>;

  // ---- RBAC Security Audit ----
  /** Run an RBAC security audit on the connected cluster. */
  securityAudit(): Promise<AuditReport>;

  // ---- AI Assistant ----
  aiGetConfig(): Promise<import('../../lib/ai/types').AiConfigView>;
  aiGetContext(): Promise<string>;
  aiSaveConfig(config: import('../../lib/ai/types').AiConfig): Promise<void>;
  aiSaveApiKey(apiKey: string): Promise<void>;
  aiTestConnection(): Promise<string>;
  aiListSkills(): Promise<import('../../lib/ai/types').Skill[]>;
  aiMemoryList(kubeContext: string, tier?: string): Promise<import('../../lib/ai/types').MemoryEntry[]>;
  aiMemorySearch(kubeContext: string, query: string): Promise<import('../../lib/ai/types').MemoryEntry[]>;
  aiMemoryAdd(kubeContext: string, content: string, tags: string[], tier?: string): Promise<void>;
  aiMemoryDelete(kubeContext: string, id: string): Promise<boolean>;
  aiMemoryClear(kubeContext: string, tier?: string): Promise<void>;
  aiMemoryPreferences(kubeContext: string): Promise<import('../../lib/ai/types').UserPreference[]>;
  aiMemorySearchVault(kubeContext: string, query: string): Promise<import('../../lib/ai/types').MemoryEntry[]>;
  aiCronList(): Promise<import('../../lib/ai/types').CronTask[]>;
  aiCronPresets(): Promise<import('../../lib/ai/types').CronTask[]>;
  aiCronAdd(task: import('../../lib/ai/types').CronTask): Promise<void>;
  aiCronToggle(id: string): Promise<boolean>;
  aiCronDelete(id: string): Promise<boolean>;
  aiEvolutionStrategies(): Promise<unknown[]>;
  aiChat(request: unknown, sessionId?: string): Promise<string>;
  aiCancel(runId: string): Promise<void>;
  aiApproveToolCall(runId: string, callId: string, approved: boolean): Promise<void>;
}
