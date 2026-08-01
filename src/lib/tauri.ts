import { invoke } from "@tauri-apps/api/core";
import type {
  ContextInfo,
  CronJobRow,
  ConfigMapRow,
  DaemonSetRow,
  DeploymentRow,
  DescribeResult,
  EventRow,
  ExecResult,
  HpaRow,
  JobRow,
  NamespaceRow,
  NodeRow,
  PodRow,
  PortForwardInfo,
  PvcRow,
  ReplicaSetRow,
  ResourceDetail,
  SecretRow,
  ServiceRow,
  StatefulSetRow,
} from "./types";

// Thin wrappers around the Tauri commands defined in src-tauri/src/commands.rs.

export const api = {
  contexts: () => invoke<ContextInfo[]>("get_contexts"),
  currentContext: () => invoke<string | null>("get_current_context"),
  setContext: (name: string) => invoke<void>("set_current_context", { name }),

  namespaces: () => invoke<NamespaceRow[]>("list_namespaces"),
  nodes: () => invoke<NodeRow[]>("list_nodes"),

  pods: (namespace?: string) =>
    invoke<PodRow[]>("list_pods", { namespace: namespace ?? null }),
  deployments: (namespace?: string) =>
    invoke<DeploymentRow[]>("list_deployments", {
      namespace: namespace ?? null,
    }),
  statefulsets: (namespace?: string) =>
    invoke<StatefulSetRow[]>("list_statefulsets", {
      namespace: namespace ?? null,
    }),
  daemonsets: (namespace?: string) =>
    invoke<DaemonSetRow[]>("list_daemonsets", {
      namespace: namespace ?? null,
    }),
  replicasets: (namespace?: string) =>
    invoke<ReplicaSetRow[]>("list_replicasets", {
      namespace: namespace ?? null,
    }),
  jobs: (namespace?: string) =>
    invoke<JobRow[]>("list_jobs", { namespace: namespace ?? null }),
  cronjobs: (namespace?: string) =>
    invoke<CronJobRow[]>("list_cronjobs", {
      namespace: namespace ?? null,
    }),
  services: (namespace?: string) =>
    invoke<ServiceRow[]>("list_services", { namespace: namespace ?? null }),
  configmaps: (namespace?: string) =>
    invoke<ConfigMapRow[]>("list_configmaps", {
      namespace: namespace ?? null,
    }),
  secrets: (namespace?: string) =>
    invoke<SecretRow[]>("list_secrets", { namespace: namespace ?? null }),
  pvc: (namespace?: string) =>
    invoke<PvcRow[]>("list_pvc", { namespace: namespace ?? null }),
  hpa: (namespace?: string) =>
    invoke<HpaRow[]>("list_hpa", { namespace: namespace ?? null }),
  events: (namespace?: string) =>
    invoke<EventRow[]>("list_events", { namespace: namespace ?? null }),

  getYaml: (kind: string, namespace: string | null, name: string) =>
    invoke<ResourceDetail>("get_yaml", {
      kind,
      namespace,
      name,
    }),
  deleteResource: (kind: string, namespace: string | null, name: string) =>
    invoke<void>("delete_resource", { kind, namespace, name }),

  // Logs / exec / port-forward (k9s-style :l / :e / :pf)
  getPodLogs: (
    name: string,
    namespace: string,
    options: {
      container?: string | null;
      tail_lines?: number | null;
      previous?: boolean;
      timestamps?: boolean;
    } = {},
  ) =>
    invoke<string>("get_pod_logs", {
      name,
      namespace,
      container: options.container ?? null,
      tailLines: options.tail_lines ?? 200,
      previous: options.previous ?? false,
      timestamps: options.timestamps ?? false,
    }),
  execPod: (
    name: string,
    namespace: string,
    container: string | null,
    command: string[],
  ) =>
    invoke<ExecResult>("exec_pod", {
      name,
      namespace,
      container,
      command,
    }),
  startPortForward: (
    kind: string,
    name: string,
    namespace: string,
    localPort: number,
    remotePort: number,
  ) =>
    invoke<PortForwardInfo>("start_port_forward", {
      kind,
      name,
      namespace,
      localPort,
      remotePort,
    }),
  stopPortForward: (id: string) =>
    invoke<void>("stop_port_forward", { id }),
  listPortForwards: () => invoke<PortForwardInfo[]>("list_port_forwards"),

  // Scale / apply / describe (k9s-style :s / :e / :d)
  scaleResource: (
    kind: string,
    name: string,
    namespace: string,
    replicas: number,
  ) =>
    invoke<number>("scale_resource", {
      kind,
      name,
      namespace,
      replicas,
    }),
  applyYaml: (
    kind: string,
    name: string,
    namespace: string,
    yaml: string,
  ) =>
    invoke<string>("apply_yaml", {
      kind,
      name,
      namespace,
      yaml,
    }),
  describe: (
    kind: string,
    name: string,
    namespace: string,
  ) =>
    invoke<DescribeResult>("describe", {
      kind,
      name,
      namespace,
    }),
};

// Canonical capitalization used by the Rust backend for each resource kind.
// (Used when calling getYaml / deleteResource, which dispatch on the kind name.)
export const kindLabel: Record<string, { singular: string; plural: string; capital: string }> = {
  pods: { singular: "Pod", plural: "Pods", capital: "Pod" },
  deployments: { singular: "Deployment", plural: "Deployments", capital: "Deployment" },
  statefulsets: { singular: "StatefulSet", plural: "StatefulSets", capital: "StatefulSet" },
  daemonsets: { singular: "DaemonSet", plural: "DaemonSets", capital: "DaemonSet" },
  replicasets: { singular: "ReplicaSet", plural: "ReplicaSets", capital: "ReplicaSet" },
  jobs: { singular: "Job", plural: "Jobs", capital: "Job" },
  cronjobs: { singular: "CronJob", plural: "CronJobs", capital: "CronJob" },
  services: { singular: "Service", plural: "Services", capital: "Service" },
  configmaps: { singular: "ConfigMap", plural: "ConfigMaps", capital: "ConfigMap" },
  secrets: { singular: "Secret", plural: "Secrets", capital: "Secret" },
  pvc: { singular: "PersistentVolumeClaim", plural: "PVCs", capital: "PersistentVolumeClaim" },
  hpa: { singular: "HorizontalPodAutoscaler", plural: "HPAs", capital: "HorizontalPodAutoscaler" },
  events: { singular: "Event", plural: "Events", capital: "Event" },
  nodes: { singular: "Node", plural: "Nodes", capital: "Node" },
  namespaces: { singular: "Namespace", plural: "Namespaces", capital: "Namespace" },
};
