/**
 * MockProvider — a full {@link DataProvider} backed by the prototype's static
 * data. Activated in demo mode (VITE_DEMO=1) so the entire UI runs in a plain
 * browser with no cluster.
 *
 * Refactored into smaller modules for high cohesion and low coupling.
 */

import type {
  ImageManifest,
  DataProvider,
  ImageRegistry,
  ImageRegistryUpsert,
  ImageRepo,
  ImageTag,
  ExportFromNodeResult,
  ExportFromRegistryResult,
  ImportImageResult,
  PodFileEntry,
  SkopeoAvailability,
  ImageSyncResult,
  ArchiveInfo,
  SavedQuery,
  MetricsConfig,
  MetricsConfigUpsert,
  Silence,
  Alert,
  AlertManager,
  AlertManagerUpsert,
  GrafanaConfig,
  GrafanaConfigUpsert,
  EndpointRow,
  EndpointAddress,
  PromQueryResult,
  DashboardPreset,
  CreateSilenceRequest,
  RuleGroup,
  LokiConfig,
  LokiUpsert,
  AuditEvent,
  AuditQuery,
  GrafanaDashboardSearchResult,
  SbomFormat,
  SbomResult,
  SbomSummary,
  AuditReport,
} from '../types';
import { MockConnectionMixin } from './mockConnection';
import { MockResourcesMixin } from './mockResources';
import { MockMetricsMixin } from './mockMetrics';
import { MockHelmMixin } from './mockHelm';
import { MockShellMixin } from './mockShell';

/**
 * Demo observability configs — returned verbatim by every config getter/upsert
 * so the panels have something to render in demo mode. Centralised here instead
 * of being re-typed in each method (the same object appeared 3× per backend).
 */
const DEMO_METRICS_CONFIG: MetricsConfig = {
  name: 'demo',
  url: 'http://localhost:9090',
  username: '',
  description: 'Demo Prometheus',
  lastError: null,
  lastRefreshed: null,
};
const DEMO_GRAFANA_CONFIG: GrafanaConfig = {
  name: 'demo',
  url: 'http://localhost:3000',
  username: '',
  defaultDatasource: '',
  description: 'Demo Grafana',
  lastError: null,
  lastRefreshed: null,
};
const DEMO_ALERTMANAGER_CONFIG: AlertManager = {
  name: 'demo',
  url: 'http://localhost:9093',
  description: 'Demo AlertManager',
  lastError: null,
  lastRefreshed: null,
};

export class MockProvider extends MockConnectionMixin implements DataProvider {
  // Mix in the other capabilities
  private resources = new MockResourcesMixin();
  private metrics = new MockMetricsMixin();
  private helm = new MockHelmMixin();
  private shell = new MockShellMixin();

  // Forward resource methods
  getYaml = this.resources.getYaml.bind(this.resources);
  applyYaml = this.resources.applyYaml.bind(this.resources);
  dryRunYaml = this.resources.dryRunYaml.bind(this.resources);
  getEvents = this.resources.getEvents.bind(this.resources);
  getProperties = this.resources.getProperties.bind(this.resources);
  getSecretData = this.resources.getSecretData.bind(this.resources);
  deleteResource = this.resources.deleteResource.bind(this.resources);
  scaleResource = this.resources.scaleResource.bind(this.resources);
  restartPod = this.resources.restartPod.bind(this.resources);
  restartRollout = this.resources.restartRollout.bind(this.resources);
  listRevisions = this.resources.listRevisions.bind(this.resources);
  undoRollout = this.resources.undoRollout.bind(this.resources);
  setCordon = this.resources.setCordon.bind(this.resources);
  applyYamlBundle = this.resources.applyYamlBundle.bind(this.resources);
  dryRunYamlBundle = this.resources.dryRunYamlBundle.bind(this.resources);
  onResourceUpdate = this.resources.onResourceUpdate.bind(this.resources);
  onCustomKinds = this.resources.onCustomKinds.bind(this.resources);
  watchCustomKind = this.resources.watchCustomKind.bind(this.resources);
  unwatchCustomKind = this.resources.unwatchCustomKind.bind(this.resources);

  // Forward metrics methods
  drainNode = this.metrics.drainNode.bind(this.metrics);
  onPodMetrics = this.metrics.onPodMetrics.bind(this.metrics);
  onNodeMetrics = this.metrics.onNodeMetrics.bind(this.metrics);
  onDrainProgress = this.metrics.onDrainProgress.bind(this.metrics);
  onNodeStats = this.metrics.onNodeStats.bind(this.metrics);
  onNodeStatsError = this.metrics.onNodeStatsError.bind(this.metrics);
  nodeHistory = this.metrics.nodeHistory.bind(this.metrics);
  podHistory = this.metrics.podHistory.bind(this.metrics);
  watchNodeStats = this.metrics.watchNodeStats.bind(this.metrics);
  unwatchNodeStats = this.metrics.unwatchNodeStats.bind(this.metrics);
  onPodStats = this.metrics.onPodStats.bind(this.metrics);
  watchPodStats = this.metrics.watchPodStats.bind(this.metrics);
  unwatchPodStats = this.metrics.unwatchPodStats.bind(this.metrics);

  // Forward helm methods
  helmListRepos = this.helm.helmListRepos.bind(this.helm);
  helmAddRepo = this.helm.helmAddRepo.bind(this.helm);
  helmRemoveRepo = this.helm.helmRemoveRepo.bind(this.helm);
  helmUpdateRepo = this.helm.helmUpdateRepo.bind(this.helm);
  helmUpdateAllRepos = this.helm.helmUpdateAllRepos.bind(this.helm);
  helmSearchCharts = this.helm.helmSearchCharts.bind(this.helm);
  helmChartVersions = this.helm.helmChartVersions.bind(this.helm);
  helmExportChart = this.helm.helmExportChart.bind(this.helm);
  helmImportChart = this.helm.helmImportChart.bind(this.helm);
  helmLocalCharts = this.helm.helmLocalCharts.bind(this.helm);
  helmRenderDefaultValues = this.helm.helmRenderDefaultValues.bind(this.helm);
  helmRunOp = this.helm.helmRunOp.bind(this.helm);
  helmReleaseHistory = this.helm.helmReleaseHistory.bind(this.helm);
  helmManifestRevision = this.helm.helmManifestRevision.bind(this.helm);
  helmValuesRevision = this.helm.helmValuesRevision.bind(this.helm);
  onHelmOpLog = this.helm.onHelmOpLog.bind(this.helm);
  onHelmOpDone = this.helm.onHelmOpDone.bind(this.helm);

  // Forward shell methods
  startLogs = this.shell.startLogs.bind(this.shell);
  saveLogs = this.shell.saveLogs.bind(this.shell);
  startShell = this.shell.startShell.bind(this.shell);
  startNodeShell = this.shell.startNodeShell.bind(this.shell);
  startPortForward = this.shell.startPortForward.bind(this.shell);
  stopPortForward = this.shell.stopPortForward.bind(this.shell);
  listPortForwards = this.shell.listPortForwards.bind(this.shell);
  onForwards = this.shell.onForwards.bind(this.shell);

  // Override emitAllRows to use resources mixin
  protected emitAllRows(): void {
    this.resources['emitAllRows']();
  }

  // ---- Image registry management: empty in demo. ----
  async imageRegistryList(): Promise<ImageRegistry[]> {
    return [
      {
        name: 'demo',
        url: 'https://registry.demo/v2',
        username: '',
        insecure: false,
        description: 'Demo OCI registry',
        lastError: null,
        lastRefreshed: new Date().toISOString(),
      },
    ];
  }

  async imageRegistryUpsert(_input: ImageRegistryUpsert): Promise<ImageRegistry> {
    throw new Error('image registry not available in demo mode');
  }

  async imageRegistryRemove(_name: string): Promise<void> {}

  async imageRegistryTest(_name: string): Promise<void> {}

  async imageRegistryRepos(_name: string): Promise<ImageRepo[]> {
    return [{ name: 'library/nginx' }, { name: 'library/redis' }, { name: 'library/postgres' }];
  }

  async imageRegistryTags(_name: string, _repo: string): Promise<ImageTag[]> {
    return [
      {
        name: '1.25',
        digest: 'sha256:' + 'a'.repeat(64),
        size: 142000000,
        created: '2024-01-15T10:00:00Z',
      },
      {
        name: '1.24',
        digest: 'sha256:' + 'b'.repeat(64),
        size: 140000000,
        created: '2023-12-01T10:00:00Z',
      },
      {
        name: 'latest',
        digest: 'sha256:' + 'c'.repeat(64),
        size: 142000000,
        created: '2024-01-15T10:00:00Z',
      },
    ];
  }

  // ---- Image import (air-gapped): mock that "succeeds" in demo. ----
  async importImageToNode(_node: string, path: string): Promise<ImportImageResult> {
    const base = path.split('/').pop() ?? 'image.tar';
    return {
      runtime: 'containerd',
      output: `Loaded image: docker.io/library/${base.replace(/\.tar$/, '')}:latest`,
      images: [`docker.io/library/${base.replace(/\.tar$/, '')}:latest`],
      error: null,
    };
  }

  async listEndpoints(): Promise<EndpointRow[]> {
    return [];
  }

  async listEndpointAddresses(_namespace: string, _name: string): Promise<EndpointAddress[]> {
    return [];
  }

  // ---- Pod file management: demo mode renders a static tree. ----
  async podFilesList(
    _ref: { kind: string; namespace?: string; name: string },
    _container: string | null,
    _path: string
  ): Promise<PodFileEntry[]> {
    return [
      { name: 'etc', kind: 'dir', size: 0, modified: 1700000000, mode: 0o755 },
      { name: 'var', kind: 'dir', size: 0, modified: 1700000000, mode: 0o755 },
      { name: 'tmp', kind: 'dir', size: 0, modified: 1700000000, mode: 0o1777 },
      { name: 'demo.txt', kind: 'file', size: 12, modified: 1700000000, mode: 0o644 },
    ];
  }

  async podFilesRead(
    _ref: { kind: string; namespace?: string; name: string },
    _container: string | null,
    path: string
  ): Promise<string> {
    return `demo file: ${path}\n`;
  }

  async podFilesWrite(
    _ref: { kind: string; namespace?: string; name: string },
    _container: string | null,
    _path: string,
    _content: string
  ): Promise<void> {}

  async podFilesDownload(
    _ref: { kind: string; namespace?: string; name: string },
    _container: string | null,
    _path: string
  ): Promise<Uint8Array> {
    return new TextEncoder().encode('demo archive\n');
  }

  async podFilesUpload(
    _ref: { kind: string; namespace?: string; name: string },
    _container: string | null,
    _destDir: string,
    _tar: Uint8Array
  ): Promise<void> {}

  // ---- Additional DataProvider methods ----
  async imageSyncStatus(): Promise<SkopeoAvailability> {
    return { available: true, path: '/usr/bin/skopeo', version: '1.13.0' };
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
    return {
      source: 'docker-archive:/tmp/nginx.tar',
      destination: 'docker://registry.demo/library/nginx:1.25',
      success: true,
      lines: 10,
      summary: 'Copied nginx:1.25 to registry.demo/library/nginx:1.25',
    };
  }

  async imageInspectArchive(_tarPath: string): Promise<ArchiveInfo> {
    return {
      name: 'nginx',
      repoTags: ['1.25', 'latest'],
      digest: 'sha256:' + 'a'.repeat(64),
      architecture: 'amd64',
      os: 'linux',
      created: new Date().toISOString(),
      sizeBytes: 142000000,
    };
  }

  async exportFromNode(_node: string, _imageRef: string, savePath: string): Promise<ExportFromNodeResult> {
    return { runtime: 'containerd', output: 'mock export', images: [], savedPath: savePath, error: null };
  }

  async listNodeImages(_node: string): Promise<string[]> {
    return ['nginx:1.25', 'busybox:latest', 'redis:7'];
  }

  async exportFromRegistry(
    _registryName: string,
    _repo: string,
    _tag: string,
    savePath: string,
    _insecureSrc: boolean,
    _onLog: (line: string) => void
  ): Promise<ExportFromRegistryResult> {
    return { source: 'docker://mock/image:tag', savedPath: savePath, success: true, lines: 1, summary: 'mock export done' };
  }

  async listEndpointsForService(_namespace: string, _name: string): Promise<EndpointRow[]> {
    return [];
  }

  async triggerCronjob(_namespace: string, _name: string): Promise<string> {
    return 'demo-triggered-job';
  }

  async metricsList(): Promise<MetricsConfig[]> {
    return [];
  }

  async metricsUpsert(_input: MetricsConfigUpsert): Promise<MetricsConfig> {
    return DEMO_METRICS_CONFIG;
  }

  async metricsRemove(_name: string): Promise<void> {}

  async metricsTest(_name: string): Promise<void> {}

  async metricsQuery(_name: string, _promql: string): Promise<PromQueryResult> {
    return { resultType: 'vector', series: [] };
  }

  async metricsQueryRange(
    _name: string,
    _promql: string,
    _startMs: number,
    _endMs: number,
    _stepSeconds: number
  ): Promise<PromQueryResult> {
    return { resultType: 'matrix', series: [] };
  }

  async grafanaList(): Promise<GrafanaConfig[]> {
    return [];
  }

  async grafanaUpsert(_input: GrafanaConfigUpsert): Promise<GrafanaConfig> {
    return DEMO_GRAFANA_CONFIG;
  }

  async grafanaRemove(_name: string): Promise<void> {}

  async grafanaTest(_name: string): Promise<void> {}

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
    return DEMO_ALERTMANAGER_CONFIG;
  }

  async alertManagerRemove(_name: string): Promise<void> {}

  async alertManagerTest(_name: string): Promise<void> {}

  async alertManagerAlerts(_name: string): Promise<Alert[]> {
    return [];
  }

  async alertManagerSilences(_name: string): Promise<Silence[]> {
    return [];
  }

  async alertManagerCreateSilence(
    _instance: string,
    _request: CreateSilenceRequest
  ): Promise<string> {
    return 'mock-silence-id';
  }

  async alertManagerDeleteSilence(_instance: string, _silenceId: string): Promise<void> {}

  async prometheusRules(_instance: string): Promise<RuleGroup[]> {
    return [];
  }

  async lokiList(): Promise<LokiConfig[]> {
    return [];
  }

  async lokiUpsert(_input: LokiUpsert): Promise<LokiConfig> {
    return {
      name: 'demo',
      url: 'http://localhost:3100',
      username: '',
      description: 'Demo Loki',
      lastError: null,
      lastRefreshed: null,
    };
  }

  async lokiRemove(_name: string): Promise<void> {}

  async lokiTest(_name: string): Promise<void> {}

  async auditEvents(_query: AuditQuery): Promise<AuditEvent[]> {
    return [];
  }

  async grafanaSearchDashboards(
    _name: string,
    _query: string
  ): Promise<GrafanaDashboardSearchResult[]> {
    return [];
  }

  async savedQueriesList(): Promise<SavedQuery[]> {
    return [];
  }

  async savedQueriesUpsert(query: SavedQuery): Promise<SavedQuery> {
    return query;
  }

  async savedQueriesRemove(_name: string): Promise<void> {}

  async savedQueriesClearCache(): Promise<void> {}

  async savedQueriesRun(
    _query: SavedQuery,
    _instance: string,
    _forceRefresh: boolean
  ): Promise<PromQueryResult> {
    return { resultType: 'vector', series: [] };
  }

  async imageRegistryManifest(_name: string, _repo: string, _tag: string): Promise<ImageManifest> {
    return {
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      size: 1000,
      digest: 'sha256:' + 'a'.repeat(64),
      raw: '{}',
      configDigest: 'sha256:' + 'b'.repeat(64),
      configSize: 500,
      layers: [],
    };
  }

  // ---- SBOM (Software Bill of Materials) ----

  async sbomGenerateImage(_imageRef: string, _format: SbomFormat): Promise<SbomResult> {
    return this.mockSbomResult();
  }

  async sbomGenerateCluster(_format: SbomFormat): Promise<SbomResult> {
    return this.mockSbomResult();
  }

  async sbomListHistory(): Promise<SbomSummary[]> {
    return [];
  }

  async sbomGet(_id: string): Promise<SbomResult> {
    return this.mockSbomResult();
  }

  async sbomExport(_id: string, _outputPath: string): Promise<string> {
    return '/tmp/sbom-export.json';
  }

  private mockSbomResult(): SbomResult {
    return {
      id: 'mock-001',
      source: { kind: 'image', imageRef: 'nginx:1.25', namespace: 'default' },
      format: 'cyclonedx',
      specVersion: '1.5',
      metadata: { tool: 'mock', toolVersion: '0.1.0', scanDurationMs: 100 },
      components: [
        {
          name: 'openssl',
          version: '3.1.4',
          componentType: 'library',
          licenses: ['Apache-2.0'],
          hashes: [],
        },
        {
          name: 'nginx',
          version: '1.25.3',
          componentType: 'application',
          licenses: ['BSD-2-Clause'],
          hashes: [],
        },
      ],
      dependencies: [],
      vulnerabilities: [
        {
          id: 'CVE-2024-MOCK',
          severity: 'high',
          affectedComponents: ['openssl'],
          fixedVersion: '3.1.5',
        },
      ],
      createdAt: new Date().toISOString(),
    };
  }

  // ---- Scanner Status ----

  async scannerStatus(): Promise<import('../types/scanner').ScannerStatus> {
    return {
      engines: [
        { name: 'trivy', available: false, path: null, configurable: true, pathSource: 'auto-detected' },
        { name: 'grype', available: false, path: null, configurable: true, pathSource: 'auto-detected' },
        { name: 'native', available: true, path: null, configurable: false, pathSource: 'built-in' },
      ],
      activeEngine: 'native',
      timeout: '5m',
    };
  }

  // ---- RBAC Security Audit ----

  async securityAudit(): Promise<AuditReport> {
    return {
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      scannedAt: new Date().toISOString(),
    };
  }

  // ---- AI Assistant (stubs for demo mode) ----
  async aiGetConfig() {
    return { enabled: false, provider: { baseUrl: '', model: '' }, permission: 'readConfirmWrite' as const, maxTurns: 10, hasApiKey: false };
  }
  async aiGetContext() { return ''; }
  async aiSaveConfig() {}
  async aiSaveApiKey() {}
  async aiTestConnection() { return 'demo mode'; }
  async aiListSkills() { return []; }
  async aiMemoryList() { return []; }
  async aiMemorySearch() { return []; }
  async aiMemoryAdd() {}
  async aiMemoryDelete() { return false; }
  async aiMemoryClear() {}
  async aiMemoryPreferences() { return []; }
  async aiMemorySearchVault() { return []; }
  async aiCronList() { return []; }
  async aiCronPresets() { return []; }
  async aiCronAdd() {}
  async aiCronToggle() { return false; }
  async aiCronDelete() { return false; }
  async aiEvolutionStrategies() { return []; }
  async aiChat() { return 'demo-run-id'; }
  async aiCancel() {}
  async aiApproveToolCall() {}

  // ---- Custom kind instance counts (mock: all non-zero for demo visibility) ----
  async customKindCounts(): Promise<Array<{ id: string; count: number }>> {
    // Return counts matching MOCK_CUSTOM_KINDS — the mock data has rows for
    // each kind so the badge shows a realistic number in demo mode.
    return [
      { id: 'argoproj.io/applications', count: 3 },
      { id: 'argoproj.io/appprojects', count: 1 },
      { id: 'traefik.io/ingressroutes', count: 2 },
      { id: 'cert-manager.io/clusterissuers', count: 2 },
    ];
  }
}
