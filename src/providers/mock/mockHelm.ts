/**
 * Mock Helm operations.
 */

import type {
  HelmChartSummary,
  HelmChartVersionEntry,
  HelmOp,
  HelmOpResult,
  HelmRepo,
  HelmRepoUpsert,
  HelmRevisionEntry,
  Unsub,
} from '../types';

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

  async helmImportChart(_filePath: string, _repoName: string): Promise<string> {
    return '/tmp/imported.tgz';
  }

  async helmLocalCharts(_repoName: string): Promise<string[]> {
    return [];
  }

  async helmRenderDefaultValues(_chart: string, _version: string, _kc?: string): Promise<string> {
    return '# demo values\nreplicaCount: 1\nimage:\n  repository: nginx\n  tag: latest\n';
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
