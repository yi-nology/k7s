/**
 * Observability types: endpoints, metrics/Prometheus, Grafana, AlertManager, Loki, audit.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

// ---- Endpoints (Phase 1 Tier-2 of KubePi parity) ----

export interface EndpointRow {
  name: string;
  namespace: string;
  service: string;
  ready: number;
  total: number;
  addresses: string[];
  age: string;
}

export interface EndpointAddress {
  address: string;
  ready: boolean;
  nodeName: string;
  targetRefKind: string;
  targetRefName: string;
}

// ---- Metrics / Prometheus multi-instance ----

export interface MetricsConfig {
  name: string;
  url: string;
  username: string;
  description: string;
  lastError: string | null;
  lastRefreshed: string | null;
}

export interface MetricsConfigUpsert {
  name: string;
  url: string;
  username: string;
  password: string;
  description: string;
}

export interface PromSample {
  /** Unix milliseconds. */
  ts: number;
  value: number;
}

export interface PromSeries {
  metric: Record<string, string>;
  samples: PromSample[];
}

export interface PromQueryResult {
  resultType: string;
  series: PromSeries[];
}

// ---- Grafana ----

export interface GrafanaConfig {
  name: string;
  url: string;
  username: string;
  defaultDatasource: string;
  description: string;
  lastError: string | null;
  lastRefreshed: string | null;
}

export interface GrafanaConfigUpsert {
  name: string;
  url: string;
  username: string;
  password: string;
  apiToken: string;
  defaultDatasource: string;
  description: string;
}

export interface DashboardPreset {
  id: string;
  title: string;
  uid: string;
  description: string;
}

export interface GrafanaDashboardSearchResult {
  uid: string;
  title: string;
  uri: string;
  type: string;
  tags: string[];
  url: string;
}

// ---- AlertManager ----

export interface AlertManager {
  name: string;
  url: string;
  description: string;
  lastError: string | null;
  lastRefreshed: string | null;
}

export interface AlertManagerUpsert {
  name: string;
  url: string;
  bearerToken: string;
  description: string;
}

export interface Alert {
  fingerprint: string;
  name: string;
  state: string;
  severity: string;
  summary: string;
  description: string;
  activeAt: string;
  labels: Record<string, string>;
  generatorUrl: string;
  inhibitedBy: string;
}

export interface Silence {
  id: string;
  matchers: string[];
  createdBy: string;
  comment: string;
  startsAt: string;
  endsAt: string;
  status: string;
}

export interface SilenceMatcher {
  name: string;
  value: string;
  isRegex: boolean;
}

export interface CreateSilenceRequest {
  matchers: SilenceMatcher[];
  comment: string;
  createdBy: string;
  startsAt: string;
  endsAt: string;
}

export interface AlertRule {
  name: string;
  state: string;
  severity: string;
  query: string;
  duration: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface RuleGroup {
  name: string;
  file: string;
  interval: number;
  rules: AlertRule[];
}

// ---- Loki / K8s Audit log ----

export interface LokiConfig {
  name: string;
  url: string;
  username: string;
  description: string;
  lastError: string | null;
  lastRefreshed: string | null;
}

export interface LokiUpsert {
  name: string;
  url: string;
  username: string;
  password: string;
  description: string;
}

export interface AuditQuery {
  instance: string;
  namespace: string;
  resource: string;
  user: string;
  sinceSeconds: number;
  limit: number;
}

export interface AuditEvent {
  timestamp: string;
  verb: string;
  resource: string;
  subresource: string;
  namespace: string;
  name: string;
  user: string;
  sourceIp: string;
  statusCode: number;
  stage: string;
  auditId: string;
  raw: string;
}

// ---- Saved PromQL queries ----

export interface SavedQuery {
  name: string;
  promql: string;
  note: string;
  cacheSeconds: number;
}
