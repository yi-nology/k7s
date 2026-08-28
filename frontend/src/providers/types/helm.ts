/**
 * Helm chart marketplace types.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

export interface HelmRepo {
  name: string;
  url: string;
  description: string;
  lastRefreshed: string | null;
  lastError: string | null;
}

export interface HelmRepoUpsert {
  name: string;
  url: string;
  description: string;
}

export interface HelmChartSummary {
  repo: string;
  name: string;
  version: string;
  appVersion: string;
  description: string;
  keywords: string[];
  home: string;
  maintainers: { name: string; email: string; url: string }[];
}

export interface HelmChartVersionEntry {
  version: string;
  appVersion: string;
  created: string;
  urls: string[];
}

/** One of the four helm operations. The `tag` discriminates which fields
 * apply (matching the backend's `enum HelmOp`). */
export type HelmOp =
  | { op: 'install'; args: HelmInstallArgs }
  | { op: 'upgrade'; args: HelmUpgradeArgs }
  | { op: 'uninstall'; args: HelmUninstallArgs }
  | { op: 'rollback'; args: HelmRollbackArgs };

export interface HelmInstallArgs {
  release: string;
  chart: string;
  version: string;
  namespace: string;
  kubeconfig?: string;
  /** Values YAML text ('' = chart defaults). The backend writes it to a
   * temp file and passes the path to helm; the TS side never materializes
   * a file. */
  values: string;
  dryRun: boolean;
  createNamespace: boolean;
  /** Extra `--set k=v` overrides. Omitted/null = none. */
  set?: Record<string, unknown> | null;
  /** `--atomic`: wait + roll back automatically on failure. */
  atomic?: boolean;
  /** Overrides helm's default 5m0s timeout; null/omitted = helm default. */
  timeoutSecs?: number | null;
}

export interface HelmUpgradeArgs {
  release: string;
  chart: string;
  version: string;
  namespace: string;
  kubeconfig?: string;
  values: string;
  dryRun: boolean;
  reuseValues: boolean;
  rollbackOnFailure: boolean;
  /** `--create-namespace`: create the target namespace if missing. */
  createNamespace?: boolean;
  /** Extra `--set k=v` overrides. Omitted/null = none. */
  set?: Record<string, unknown> | null;
  /** `--atomic`: wait + roll back automatically on failure. */
  atomic?: boolean;
  /** `--force`: resource updates go through the replacement strategy. */
  force?: boolean;
  /** Overrides helm's default 5m0s timeout; null/omitted = helm default. */
  timeoutSecs?: number | null;
}

export interface HelmUninstallArgs {
  release: string;
  namespace: string;
  kubeconfig?: string;
  keepHistory: boolean;
}

export interface HelmRollbackArgs {
  release: string;
  namespace: string;
  revision: number | null;
  kubeconfig?: string;
}

export interface HelmOpResult {
  op: string;
  release: string;
  namespace: string;
  success: boolean;
  lines: number;
  summary: string;
}

export interface HelmRevisionEntry {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  appVersion: string;
  description: string;
}

/** Entry in the local chart library (`<data_dir>/charts`). */
export type LocalChartKind = 'tgz' | 'dir';
export interface LocalChartEntry {
  id: string;
  kind: LocalChartKind;
  name: string;
  version: string;
  appVersion: string;
  description: string;
  icon: string;
  /** Absolute path on the backend host — the value passed to helm as the
   * chart reference when installing from the library. */
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** The `helm dependency` verb for the local-chart toolbox. Lowercase — this
 * is the wire shape the backend's `local::DepsAction` deserializes; an
 * unknown verb is a wire error. */
export type ChartDepsAction = 'list' | 'build' | 'update';

export interface LocalChartFile {
  path: string;
  sizeBytes: number;
  isDir: boolean;
}
export interface LocalChartDetail {
  entry: LocalChartEntry;
  files: LocalChartFile[];
  /** Empty when the chart ships no Chart.yaml (mirrors the backend's
   * serde camelCase wire name for `chart_yaml`). */
  chartYaml: string;
  valuesYaml: string;
  readme: string;
}

/**
 * A saved deployment profile (ChartOps parity): one helm install/upgrade
 * parameter set, persisted in `<data_dir>/helm-profiles.json` and upserted by
 * name. Field names match the Rust struct's serde camelCase wire shape.
 */
export interface HelmProfile {
  /** Unique key; `[a-zA-Z0-9-_]`, ≤64 chars. */
  name: string;
  /** Chart reference: `repo/name`, an OCI URL, or a local absolute path. */
  chartRef: string;
  /** Chart version; '' = latest. */
  version: string;
  namespace: string;
  /** values.yaml text ('' = chart defaults). */
  values: string;
  /** `--set` pairs keyed by literal Helm path (`image.tag`). */
  set?: Record<string, unknown> | null;
  atomic: boolean;
  force: boolean;
  createNamespace: boolean;
  /** Operation timeout in seconds; null = helm's default. */
  timeoutSecs?: number | null;
  /** RFC3339 creation time (stamped by the backend for new profiles). */
  createdAt: string;
}
