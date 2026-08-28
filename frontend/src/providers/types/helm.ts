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
  /** Rendered values.yaml. Sent over the wire as a file path the backend
   * already wrote; the helpers in helm/runOp handle that translation. */
  values: string;
  dryRun: boolean;
  createNamespace: boolean;
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
export interface LocalChartFile {
  path: string;
  sizeBytes: number;
  isDir: boolean;
}
export interface LocalChartDetail {
  entry: LocalChartEntry;
  files: LocalChartFile[];
  valuesYaml: string;
  readme: string;
}
