/**
 * Mock Helm operations.
 */

import type {
  ChartDepsAction,
  HelmChartSummary,
  HelmChartVersionEntry,
  HelmOp,
  HelmOpResult,
  HelmProfile,
  HelmRepo,
  HelmRepoUpsert,
  HelmRevisionEntry,
  LocalChartDetail,
  LocalChartEntry,
  Unsub,
} from '../types';

/** The demo local chart library (`<data_dir>/charts` in demo mode). One
 * packaged chart and one unpacked directory, so both toolbox halves (verify
 * vs package) have something to act on. */
const localCharts: LocalChartEntry[] = [
  {
    id: 'demo-app-1.1.0.tgz',
    kind: 'tgz',
    name: 'demo-app',
    version: '1.1.0',
    appVersion: '1.1.0',
    description: 'demo chart',
    icon: '',
    path: '/tmp/demo-app-1.1.0.tgz',
    sizeBytes: 2048,
    modifiedAt: '2026-08-28T00:00:00Z',
  },
  {
    id: 'demo-src',
    kind: 'dir',
    name: 'demo-src',
    version: '0.9.0',
    appVersion: '0.9.0',
    description: 'unpacked demo chart source',
    icon: '',
    path: '/tmp/demo-src',
    sizeBytes: 4096,
    modifiedAt: '2026-08-28T00:00:00Z',
  },
];

/** Saved deployment profiles (in-memory — demo mode has no data dir). */
const demoProfiles: HelmProfile[] = [
  {
    name: 'demo-web-prod',
    chartRef: '/tmp/demo-app-1.1.0.tgz',
    version: '1.1.0',
    namespace: 'web',
    values: 'replicaCount: 2\nservice:\n  type: ClusterIP\n',
    set: null,
    atomic: true,
    force: false,
    createNamespace: true,
    timeoutSecs: 300,
    createdAt: '2026-08-28T00:00:00Z',
  },
];

/** Canned `helm template` output for the render preview in demo mode. */
const DEMO_RENDER_YAML = `---
# Source: demo-app/templates/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-app
  labels:
    app.kubernetes.io/name: demo-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: demo-app
  template:
    metadata:
      labels:
        app.kubernetes.io/name: demo-app
    spec:
      containers:
        - name: demo-app
          image: "nginx:1.25.3"
          ports:
            - name: http
              containerPort: 80
              protocol: TCP
`;

function demoMockRepos(): HelmRepo[] {
  return [
    {
      name: 'bitnami',
      url: 'https://charts.bitnami.com/bitnami',
      description: 'Bitnami Helm charts',
      lastRefreshed: new Date().toISOString(),
      lastError: null,
    },
    {
      name: 'ingress-nginx',
      url: 'https://kubernetes.github.io/ingress-nginx',
      description: 'Ingress NGINX Helm charts',
      lastRefreshed: new Date().toISOString(),
      lastError: null,
    },
  ];
}

function demoMockCharts(): HelmChartSummary[] {
  return [
    {
      repo: 'bitnami',
      name: 'nginx',
      version: '1.25.3',
      appVersion: '1.25.3',
      description:
        'NGINX Open Source is a web server that can be also used as a reverse proxy, load balancer, and HTTP cache.',
      keywords: ['nginx', 'web', 'server'],
      home: 'https://nginx.org',
      maintainers: [],
    },
    {
      repo: 'bitnami',
      name: 'redis',
      version: '18.0.0',
      appVersion: '7.2.0',
      description: 'Redis is an in-memory database that persists on disk.',
      keywords: ['redis', 'database', 'cache'],
      home: 'https://redis.io',
      maintainers: [],
    },
    {
      repo: 'bitnami',
      name: 'postgresql',
      version: '12.10.0',
      appVersion: '15.4.0',
      description: 'PostgreSQL (Postgres) is an open source object-relational database.',
      keywords: ['postgresql', 'database', 'sql'],
      home: 'https://www.postgresql.org',
      maintainers: [],
    },
  ];
}

export class MockHelmMixin {
  async helmListRepos(): Promise<HelmRepo[]> {
    return demoMockRepos();
  }

  async helmAddRepo(_input: HelmRepoUpsert): Promise<HelmRepo> {
    throw new Error('Helm not available in demo mode');
  }

  async helmRemoveRepo(_name: string): Promise<void> {
    throw new Error('Helm not available in demo mode');
  }

  async helmUpdateRepo(name: string): Promise<HelmRepo> {
    const r = (await this.helmListRepos()).find((x) => x.name === name);
    if (!r) throw new Error(`repo ${name} not found`);
    return { ...r, lastRefreshed: new Date().toISOString(), lastError: null };
  }

  async helmUpdateAllRepos(): Promise<HelmRepo[]> {
    return this.helmListRepos();
  }

  async helmSearchCharts(query: string): Promise<HelmChartSummary[]> {
    const all = demoMockCharts();
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.toLowerCase().includes(q))
    );
  }

  async helmChartVersions(_repo: string, _chart: string): Promise<HelmChartVersionEntry[]> {
    return [
      { version: '1.2.3', appVersion: '1.0.0', created: '2024-01-01T00:00:00Z', urls: [] },
      { version: '1.2.2', appVersion: '1.0.0', created: '2023-12-01T00:00:00Z', urls: [] },
      { version: '1.2.1', appVersion: '0.9.0', created: '2023-11-01T00:00:00Z', urls: [] },
    ];
  }

  async helmExportChart(
    _repo: string,
    _chart: string,
    _version: string,
    _outputDir: string
  ): Promise<string> {
    return '/tmp/chart.tgz';
  }

  async localChartsList(): Promise<LocalChartEntry[]> {
    return [...localCharts];
  }

  async localChartDetail(id: string): Promise<LocalChartDetail> {
    const entry = localCharts.find((c) => c.id === id) ?? localCharts[0];
    return {
      entry,
      files: [
        { path: `${entry.name}/Chart.yaml`, sizeBytes: 128, isDir: false },
        { path: `${entry.name}/values.yaml`, sizeBytes: 64, isDir: false },
      ],
      chartYaml: `apiVersion: v2\nname: ${entry.name}\nversion: ${entry.version}\n`,
      valuesYaml: 'replicaCount: 1\n',
      readme: '# demo\n',
    };
  }

  async localChartFile(_id: string, path: string): Promise<string> {
    return `# ${path}\n`;
  }

  async localChartUpload(filename: string, _b64: string): Promise<LocalChartEntry> {
    return {
      ...localCharts[0],
      id: filename,
      name: filename.replace(/-[\d.]+\.tgz$/, ''),
    };
  }

  async localChartRemove(_id: string): Promise<void> {}

  // ---- chart toolbox (canned helm CLI output) ----

  async localChartLint(id: string): Promise<string> {
    const entry = localCharts.find((c) => c.id === id) ?? localCharts[0];
    return `==> Linting chart ${entry.name}\n\n1 chart(s) linted, 0 chart(s) with failures`;
  }

  async localChartVerify(_id: string): Promise<string> {
    return 'Signature is valid';
  }

  async localChartPackage(id: string): Promise<LocalChartEntry> {
    const entry = localCharts.find((c) => c.id === id);
    if (!entry) throw new Error(`chart ${id} not found`);
    // Mirror the backend: an already-packaged chart has nothing to package.
    if (entry.kind === 'tgz') throw new Error('already packaged');
    const fresh: LocalChartEntry = {
      ...entry,
      id: `${entry.name}-${entry.version}.tgz`,
      kind: 'tgz',
      path: `/tmp/${entry.name}-${entry.version}.tgz`,
      sizeBytes: 2048,
      modifiedAt: new Date().toISOString(),
    };
    localCharts.push(fresh);
    return fresh;
  }

  async localChartDeps(_id: string, action: ChartDepsAction): Promise<string> {
    // The demo charts declare no dependencies, so every verb is a no-op.
    switch (action) {
      case 'list':
        return 'No dependencies found';
      case 'build':
        return 'No dependencies to build — the chart declares none';
      case 'update':
        return 'No dependencies to update — the chart declares none';
    }
  }

  async helmRenderDefaultValues(_chart: string, _version: string, _kc?: string): Promise<string> {
    return '# demo values\nreplicaCount: 1\nimage:\n  repository: nginx\n  tag: latest\n';
  }

  /** Canned offline render — stable text containing `kind: Deployment` so
   * preview UIs (and their tests) have something deterministic to assert on. */
  async helmRenderPreview(
    _chart: string,
    _version: string,
    _values: string,
    _kc?: string
  ): Promise<string> {
    return DEMO_RENDER_YAML;
  }

  async helmProfileList(): Promise<HelmProfile[]> {
    return [...demoProfiles].sort((a, b) => a.name.localeCompare(b.name));
  }

  async helmProfileSave(profile: HelmProfile): Promise<HelmProfile[]> {
    const i = demoProfiles.findIndex((p) => p.name === profile.name);
    if (i >= 0) demoProfiles[i] = profile;
    else demoProfiles.push(profile);
    return this.helmProfileList();
  }

  async helmProfileDelete(name: string): Promise<HelmProfile[]> {
    const i = demoProfiles.findIndex((p) => p.name === name);
    if (i >= 0) demoProfiles.splice(i, 1);
    return this.helmProfileList();
  }

  async helmRunOp(_op: HelmOp): Promise<HelmOpResult> {
    return {
      op: 'install',
      release: 'demo',
      namespace: 'default',
      success: true,
      lines: 0,
      summary: 'demo mode: no helm backend',
    };
  }

  async helmReleaseHistory(
    _release: string,
    _ns: string,
    _kc?: string
  ): Promise<HelmRevisionEntry[]> {
    return [];
  }

  async helmManifestRevision(_namespace: string, _name: string, _revision: number): Promise<string> {
    return '';
  }

  async helmValuesRevision(_namespace: string, _name: string, _revision: number): Promise<unknown> {
    return {};
  }

  onHelmOpLog(_cb: (line: { stream: 'stdout' | 'stderr'; line: string }) => void): Unsub {
    return () => {};
  }

  onHelmOpDone(_cb: (result: HelmOpResult) => void): Unsub {
    return () => {};
  }
}
