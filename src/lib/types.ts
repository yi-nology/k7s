// Mirrors the structs exposed by the Tauri Rust backend (serde-renamed to snake_case).

export interface ContextInfo {
  name: string;
  cluster: string;
  user: string;
  namespace: string | null;
  is_current: boolean;
}

export interface NamespaceRow {
  name: string;
  status: string;
  age: string;
}

export interface PodRow {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  age: string;
  node: string;
  ip: string;
  containers: string;
}

export interface NodeRow {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
  internal_ip: string;
}

export interface DeploymentRow {
  name: string;
  namespace: string;
  ready: string;
  up_to_date: number;
  available: number;
  age: string;
}

export interface StatefulSetRow {
  name: string;
  namespace: string;
  ready: string;
  age: string;
}

export interface DaemonSetRow {
  name: string;
  namespace: string;
  desired: number;
  ready: number;
  age: string;
}

export interface ReplicaSetRow {
  name: string;
  namespace: string;
  desired: number;
  ready: string;
  age: string;
}

export interface JobRow {
  name: string;
  namespace: string;
  status: string;
  completions: string;
  age: string;
  duration: string;
}

export interface CronJobRow {
  name: string;
  namespace: string;
  schedule: string;
  suspend: boolean;
  last_schedule: string;
  age: string;
}

export interface ServiceRow {
  name: string;
  namespace: string;
  kind: string;
  cluster_ip: string;
  ports: string;
  age: string;
}

export interface ConfigMapRow {
  name: string;
  namespace: string;
  data_keys: number;
  age: string;
}

export interface SecretRow {
  name: string;
  namespace: string;
  kind: string;
  data_keys: number;
  age: string;
}

export interface PvcRow {
  name: string;
  namespace: string;
  status: string;
  volume: string;
  capacity: string;
  age: string;
}

export interface HpaRow {
  name: string;
  namespace: string;
  reference: string;
  targets: string;
  min_replicas: number;
  max_replicas: number;
  age: string;
}

export interface EventRow {
  namespace: string;
  name: string;
  kind: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  last_seen: string;
  type_: string;
}

export interface ResourceDetail {
  kind: string;
  name: string;
  namespace: string;
  yaml: string;
}

export type ResourceKind =
  | "pods"
  | "deployments"
  | "statefulsets"
  | "daemonsets"
  | "replicasets"
  | "jobs"
  | "cronjobs"
  | "services"
  | "configmaps"
  | "secrets"
  | "pvc"
  | "hpa"
  | "events"
  | "nodes"
  | "namespaces";
