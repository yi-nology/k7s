/**
 * Per-kind column layouts and the sidebar nav.
 *
 * The backend emits `cells: Cell[]` per row in a fixed order per kind.
 * This file says which kind has which columns (label / width / align).
 * If the backend adds a new cell to a kind, the column here will just
 * show "—" (the table handles missing cells gracefully).
 */

import type { ResourceKind } from "./types";
import type { ColumnSpec } from "../components/table/ResourceTable";
import type { NavGroup } from "../components/sidebar/Sidebar";

// ---------------------------------------------------------------------------
// Per-kind column layouts
// ---------------------------------------------------------------------------

export const COLUMNS: Record<string, ColumnSpec[]> = {
  pods: [
    { label: "Name", width: "32%" },
    { label: "Namespace", width: "14%" },
    { label: "Ready", width: "8%" },
    { label: "Status", width: "12%" },
    { label: "Restarts", width: "8%", align: "right" },
    { label: "Age", width: "8%", align: "right" },
    { label: "Node", width: "12%" },
    { label: "IP", width: "8%" },
  ],
  deployments: [
    { label: "Name", width: "32%" },
    { label: "Namespace", width: "16%" },
    { label: "Ready", width: "10%" },
    { label: "Up-to-date", width: "12%", align: "right" },
    { label: "Available", width: "12%", align: "right" },
    { label: "Age", width: "10%", align: "right" },
  ],
  statefulsets: [
    { label: "Name", width: "44%" },
    { label: "Namespace", width: "20%" },
    { label: "Ready", width: "16%" },
    { label: "Age", width: "10%", align: "right" },
  ],
  daemonsets: [
    { label: "Name", width: "40%" },
    { label: "Namespace", width: "18%" },
    { label: "Desired", width: "10%", align: "right" },
    { label: "Ready", width: "10%", align: "right" },
    { label: "Age", width: "10%", align: "right" },
  ],
  replicasets: [
    { label: "Name", width: "44%" },
    { label: "Namespace", width: "20%" },
    { label: "Desired", width: "10%", align: "right" },
    { label: "Ready", width: "10%" },
    { label: "Age", width: "10%", align: "right" },
  ],
  jobs: [
    { label: "Name", width: "34%" },
    { label: "Namespace", width: "16%" },
    { label: "Status", width: "12%" },
    { label: "Completions", width: "14%" },
    { label: "Duration", width: "10%" },
    { label: "Age", width: "8%", align: "right" },
  ],
  cronjobs: [
    { label: "Name", width: "26%" },
    { label: "Namespace", width: "16%" },
    { label: "Schedule", width: "22%" },
    { label: "Suspend", width: "10%" },
    { label: "Last", width: "12%" },
    { label: "Age", width: "8%", align: "right" },
  ],
  services: [
    { label: "Name", width: "28%" },
    { label: "Namespace", width: "14%" },
    { label: "Type", width: "10%" },
    { label: "Cluster IP", width: "14%" },
    { label: "Ports", width: "22%" },
    { label: "Age", width: "8%", align: "right" },
  ],
  configmaps: [
    { label: "Name", width: "44%" },
    { label: "Namespace", width: "22%" },
    { label: "Data Keys", width: "14%", align: "right" },
    { label: "Age", width: "10%", align: "right" },
  ],
  secrets: [
    { label: "Name", width: "40%" },
    { label: "Namespace", width: "20%" },
    { label: "Type", width: "14%" },
    { label: "Data Keys", width: "10%", align: "right" },
    { label: "Age", width: "10%", align: "right" },
  ],
  pvc: [
    { label: "Name", width: "32%" },
    { label: "Namespace", width: "16%" },
    { label: "Status", width: "10%" },
    { label: "Volume", width: "18%" },
    { label: "Capacity", width: "12%" },
    { label: "Age", width: "8%", align: "right" },
  ],
  nodes: [
    { label: "Name", width: "30%" },
    { label: "Status", width: "10%" },
    { label: "Roles", width: "16%" },
    { label: "Version", width: "14%" },
    { label: "Internal IP", width: "16%" },
    { label: "Age", width: "8%", align: "right" },
  ],
  namespaces: [
    { label: "Name", width: "60%" },
    { label: "Status", width: "20%" },
    { label: "Age", width: "20%", align: "right" },
  ],
  hpa: [
    { label: "Name", width: "26%" },
    { label: "Namespace", width: "14%" },
    { label: "Reference", width: "20%" },
    { label: "Targets", width: "10%" },
    { label: "Min", width: "8%", align: "right" },
    { label: "Max", width: "8%", align: "right" },
    { label: "Age", width: "8%", align: "right" },
  ],
  events: [
    { label: "Type", width: "8%" },
    { label: "Namespace", width: "14%" },
    { label: "Kind", width: "10%" },
    { label: "Object", width: "22%" },
    { label: "Reason", width: "14%" },
    { label: "Message", width: "20%" },
    { label: "Last Seen", width: "8%" },
    { label: "Cnt", width: "4%", align: "right" },
  ],
};

export function columnsFor(kind: string): ColumnSpec[] {
  return COLUMNS[kind] ?? [{ label: "Name", width: "60%" }, { label: "Age", width: "20%", align: "right" }];
}

// ---------------------------------------------------------------------------
// Sidebar nav — same order as s4njee/k7s reference
// ---------------------------------------------------------------------------

export const NAV: NavGroup[] = [
  {
    group: "Workloads",
    items: [
      { kind: "pods", label: "Pods", icon: "◎" },
      { kind: "deployments", label: "Deployments", icon: "◧" },
      { kind: "statefulsets", label: "StatefulSets", icon: "▥" },
      { kind: "daemonsets", label: "DaemonSets", icon: "▣" },
      { kind: "replicasets", label: "ReplicaSets", icon: "▤" },
      { kind: "jobs", label: "Jobs", icon: "▶" },
      { kind: "cronjobs", label: "CronJobs", icon: "⏱" },
    ],
  },
  {
    group: "Discovery & LB",
    items: [
      { kind: "services", label: "Services", icon: "⇄" },
      { kind: "ingresses", label: "Ingresses", icon: "↥" },
    ],
  },
  {
    group: "Config & Storage",
    items: [
      { kind: "configmaps", label: "ConfigMaps", icon: "▢" },
      { kind: "secrets", label: "Secrets", icon: "🔒" },
      { kind: "pvc", label: "PVCs", icon: "▦" },
    ],
  },
  {
    group: "Cluster",
    items: [
      { kind: "nodes", label: "Nodes", icon: "▣" },
      { kind: "namespaces", label: "Namespaces", icon: "▦" },
    ],
  },
  {
    group: "Metadata",
    items: [
      { kind: "hpa", label: "HPAs", icon: "↕" },
      { kind: "events", label: "Events", icon: "!" },
    ],
  },
];

export const DEFAULT_KIND: ResourceKind = "pods";

/**
 * Map from sidebar kind (lowercase plural) to the canonical Capitalized
 * kind name the API server expects (e.g. `pods` → `Pod`). Used by the
 * detail panel and any delete/scale action.
 */
export const KIND_TO_API: Record<string, string> = {
  pods: "Pod",
  deployments: "Deployment",
  statefulsets: "StatefulSet",
  daemonsets: "DaemonSet",
  replicasets: "ReplicaSet",
  jobs: "Job",
  cronjobs: "CronJob",
  services: "Service",
  ingresses: "Ingress",
  ingressclasses: "IngressClass",
  configmaps: "ConfigMap",
  secrets: "Secret",
  serviceaccounts: "ServiceAccount",
  pvc: "PersistentVolumeClaim",
  persistentvolumeclaims: "PersistentVolumeClaim",
  persistentvolumes: "PersistentVolume",
  storageclasses: "StorageClass",
  nodes: "Node",
  namespaces: "Namespace",
  events: "Event",
  hpa: "HorizontalPodAutoscaler",
};

export function apiKindFor(kind: string): string {
  return KIND_TO_API[kind] ?? kind;
}
