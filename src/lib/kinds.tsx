/* eslint-disable react-refresh/only-export-components -- This is a pure data
 * registry, not a component module: it exports KIND_META (with Lucide icons as
 * *data values* in the `icon:` field), types, and helper functions — no React
 * components at all. The JSX exists only as icon data. Splitting the icons out
 * would reintroduce the .ts/.tsx duplication this file was consolidated from,
 * so the warning is acknowledged and suppressed at the file level. */
/**
 * Static metadata for each resource kind: nav group, display label, glyph
 * icon, and the exact column set (order + labels) for each kind's table.
 *
 * This is the *column contract*: the Rust DTO layer (and the MockProvider) must
 * emit each row's `cells` array in exactly this column order. Transcribed from the
 * prototype's `resourceDefs` and the Pods branch of its render (design/K8s Monitor.dc.html).
 */

import type { ReactNode } from 'react';
import {
  Circle,
  Rocket,
  Copy,
  Layers,
  RefreshCw,
  Timer,
  Clock,
  TrendingUp,
  Zap,
  ArrowRightFromLine,
  Network,
  Shield,
  FileText,
  KeyRound,
  User,
  Gauge,
  Database,
  HardDrive,
  FolderArchive,
  Lock,
  Link,
  Server,
  LayoutGrid,
  Activity,
  Package,
  SlidersHorizontal,
  ShieldAlert,
  Webhook,
  ServerCog,
  Box,
} from 'lucide-react';
import type { CustomKind, KindId, ResourceKind } from '../providers/types';

// Re-export so consumers can pull the kind type and its metadata from one module.
export type { CustomKind, KindId, ResourceKind } from '../providers/types';

/** Nav groups, in sidebar order. "custom" holds discovered CRD kinds (B15). */
export type NavGroup =
  'workloads' | 'network' | 'storage' | 'config' | 'access' | 'images' | 'helm' | 'cluster' | 'custom';

/** Human-readable group headers (mono uppercase in the sidebar). */
export const GROUP_LABELS: Record<NavGroup, string> = {
  workloads: 'Workloads',
  network: 'Network',
  storage: 'Storage',
  config: 'Config',
  access: 'Access',
  images: 'Images',
  helm: 'Helm',
  cluster: 'Cluster',
  custom: 'Custom',
};

export interface KindMeta {
  group: NavGroup;
  /** Sidebar + breadcrumb label, e.g. "StatefulSets". */
  label: string;
  /** Lucide icon element (14px in the sidebar). */
  icon: ReactNode;
  /** Table column headers, in order. Row cells must align to this. */
  columns: string[];
}

/**
 * The kind registry. Insertion order is the sidebar order within each group, so
 * iterating `Object.entries(KIND_META)` yields Pods…Namespaces top-to-bottom.
 */
export const KIND_META: Record<ResourceKind, KindMeta> = {
  // ---- Workloads ----
  pods: {
    group: 'workloads',
    label: 'Pods',
    icon: <Circle size={14} />,
    columns: ['NAME', 'NAMESPACE', 'READY', 'RESTARTS', 'CPU', 'MEM', 'AGE', 'STATUS'],
  },
  deployments: {
    group: 'workloads',
    label: 'Deployments',
    icon: <Rocket size={14} />,
    columns: ['NAME', 'NAMESPACE', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'CPU', 'MEM', 'AGE'],
  },
  // A Deployment's actual generation, and a pod's immediate owner — the object
  // the owner chain used to have to route around (B33).
  replicasets: {
    group: 'workloads',
    label: 'ReplicaSets',
    icon: <Copy size={14} />,
    columns: ['NAME', 'NAMESPACE', 'DESIRED', 'CURRENT', 'READY', 'AGE'],
  },
  statefulsets: {
    group: 'workloads',
    label: 'StatefulSets',
    icon: <Layers size={14} />,
    columns: ['NAME', 'NAMESPACE', 'READY', 'CPU', 'MEM', 'AGE'],
  },
  daemonsets: {
    group: 'workloads',
    label: 'DaemonSets',
    icon: <RefreshCw size={14} />,
    columns: ['NAME', 'NAMESPACE', 'DESIRED', 'READY', 'CPU', 'MEM', 'AGE'],
  },
  jobs: {
    group: 'workloads',
    label: 'Jobs',
    icon: <Timer size={14} />,
    columns: ['NAME', 'NAMESPACE', 'COMPLETIONS', 'DURATION', 'AGE'],
  },
  cronjobs: {
    group: 'workloads',
    label: 'CronJobs',
    icon: <Clock size={14} />,
    columns: ['NAME', 'NAMESPACE', 'SCHEDULE', 'LAST RUN', 'AGE'],
  },
  // ---- Network ----
  services: {
    group: 'network',
    label: 'Services',
    icon: <Zap size={14} />,
    columns: ['NAME', 'NAMESPACE', 'TYPE', 'CLUSTER-IP', 'PORTS', 'AGE'],
  },
  ingresses: {
    group: 'network',
    label: 'Ingresses',
    icon: <ArrowRightFromLine size={14} />,
    columns: ['NAME', 'NAMESPACE', 'HOSTS', 'CLASS', 'AGE'],
  },
  // Cluster-scoped; the default is marked in the NAME, as kubectl does.
  ingressclasses: {
    group: 'network',
    label: 'IngressClasses',
    icon: <Network size={14} />,
    columns: ['NAME', 'CONTROLLER', 'PARAMETERS', 'AGE'],
  },
  // ---- Config ----
  configmaps: {
    group: 'config',
    label: 'ConfigMaps',
    icon: <FileText size={14} />,
    columns: ['NAME', 'NAMESPACE', 'DATA', 'AGE'],
  },
  secrets: {
    group: 'config',
    label: 'Secrets',
    icon: <KeyRound size={14} />,
    columns: ['NAME', 'NAMESPACE', 'TYPE', 'DATA', 'AGE'],
  },
  // The identity a pod runs as — an RBAC subject. Lives under Access beside
  // the Roles/RoleBindings that bind it. (Namespaced, so it still honours the
  // namespace filter, unlike the cluster-scoped RBAC kinds alongside it.)
  serviceaccounts: {
    group: 'access',
    label: 'ServiceAccounts',
    icon: <User size={14} />,
    columns: ['NAME', 'NAMESPACE', 'SECRETS', 'AGE'],
  },
  // ---- Storage ----
  // Claims first: a claim is what a workload actually references, and the volume
  // behind it is the follow-up question.
  persistentvolumeclaims: {
    group: 'storage',
    label: 'PersistentVolumeClaims',
    icon: <Database size={14} />,
    columns: ['NAME', 'NAMESPACE', 'STATUS', 'VOLUME', 'CAPACITY', 'ACCESS', 'CLASS', 'AGE'],
  },
  // Cluster-scoped, so no NAMESPACE column — CLAIM carries "namespace/name".
  persistentvolumes: {
    group: 'storage',
    label: 'PersistentVolumes',
    icon: <HardDrive size={14} />,
    columns: ['NAME', 'CAPACITY', 'ACCESS', 'RECLAIM', 'STATUS', 'CLAIM', 'CLASS', 'AGE'],
  },
  // Cluster-scoped. The default class is marked in the NAME, as kubectl does.
  storageclasses: {
    group: 'storage',
    label: 'StorageClasses',
    icon: <FolderArchive size={14} />,
    columns: ['NAME', 'PROVISIONER', 'RECLAIM', 'BINDING', 'EXPANSION', 'AGE'],
  },
  // ---- Cluster (cluster-scoped: no NAMESPACE column) ----
  nodes: {
    group: 'cluster',
    label: 'Nodes',
    icon: <Server size={14} />,
    columns: ['NAME', 'STATUS', 'ROLES', 'CPU', 'MEMORY', 'VERSION'],
  },
  namespaces: {
    group: 'cluster',
    label: 'Namespaces',
    icon: <LayoutGrid size={14} />,
    columns: ['NAME', 'STATUS', 'PODS', 'AGE'],
  },
  // Phase 2 Tier-2 of KubePi parity: NetworkPolicy / HPA / ResourceQuota /
  // LimitRange. The Rust mappers exist in `mappers.rs`; the watcher
  // integration is left to the lazy CRD path (open a row → the data
  // appears). Columns are intentionally minimal: deep columns would
  // require typed mappers and a per-kind watcher.
  networkpolicies: {
    group: 'network',
    label: 'NetworkPolicies',
    icon: <Shield size={14} />,
    columns: ['NAME', 'NAMESPACE', 'POD_SELECTOR', 'AGE'],
  },
  // HPA is an autoscaling control-plane resource, not a workload itself — it
  // scales a Deployment/StatefulSet from the side. Filed under Config with the
  // other things you *tune a workload with* (ResourceQuota, LimitRange, PDB).
  horizontalpodautoscalers: {
    group: 'config',
    label: 'HPAs',
    icon: <TrendingUp size={14} />,
    columns: ['NAME', 'NAMESPACE', 'TARGET', 'MIN', 'MAX', 'REPLICAS', 'AGE'],
  },
  resourcequotas: {
    group: 'config',
    label: 'ResourceQuotas',
    icon: <Gauge size={14} />,
    columns: ['NAME', 'NAMESPACE', 'HARD', 'USED', 'AGE'],
  },
  limitranges: {
    group: 'config',
    label: 'LimitRanges',
    icon: <SlidersHorizontal size={14} />,
    columns: ['NAME', 'NAMESPACE', 'LIMITS', 'AGE'],
  },
  // ---- Access (RBAC) ----
  roles: {
    group: 'access',
    label: 'Roles',
    icon: <Lock size={14} />,
    columns: ['NAME', 'NAMESPACE', 'AGE'],
  },
  clusterroles: {
    group: 'access',
    label: 'ClusterRoles',
    icon: <Lock size={14} />,
    columns: ['NAME', 'AGE'],
  },
  rolebindings: {
    group: 'access',
    label: 'RoleBindings',
    icon: <Link size={14} />,
    columns: ['NAME', 'NAMESPACE', 'ROLE', 'AGE'],
  },
  clusterrolebindings: {
    group: 'access',
    label: 'ClusterRoleBindings',
    icon: <Link size={14} />,
    columns: ['NAME', 'ROLE', 'AGE'],
  },
  poddisruptionbudgets: {
    group: 'config',
    label: 'PDBs',
    icon: <ShieldAlert size={14} />,
    columns: [
      'NAME',
      'NAMESPACE',
      'MIN AVAILABLE',
      'MAX UNAVAILABLE',
      'ALLOWED DISRUPTIONS',
      'AGE',
    ],
  },
  mutatingwebhookconfigurations: {
    group: 'config',
    label: 'MutatingWebhooks',
    icon: <Webhook size={14} />,
    columns: ['NAME', 'WEBHOOKS', 'AGE'],
  },
  validatingwebhookconfigurations: {
    group: 'config',
    label: 'ValidatingWebhooks',
    icon: <Webhook size={14} />,
    columns: ['NAME', 'WEBHOOKS', 'AGE'],
  },
  apiservices: {
    group: 'config',
    label: 'APIServices',
    icon: <ServerCog size={14} />,
    columns: ['NAME', 'SERVICE', 'AVAILABLE', 'AGE'],
  },
  // A read-only feed rather than a managed resource, but it lives in the Cluster
  // group because it is cluster-wide. It *is* namespaced, so it keeps a NAMESPACE
  // column and honours the namespace filter.
  events: {
    group: 'cluster',
    label: 'Events',
    icon: <Activity size={14} />,
    columns: ['TYPE', 'REASON', 'OBJECT', 'NAMESPACE', 'AGE', 'COUNT', 'MESSAGE'],
  },
  // ---- Helm (B26) ----
  // Its own group, as in Lens: a release isn't a Kubernetes kind, it's a thing
  // Helm keeps *in* Kubernetes, and filing it under Config next to the Secrets it
  // happens to be stored in would say the wrong thing about what it is.
  helm: {
    group: 'helm',
    label: 'Releases',
    icon: <Package size={14} />,
    columns: ['NAME', 'NAMESPACE', 'CHART', 'APP VERSION', 'REVISION', 'STATUS', 'UPDATED'],
  },
};

/** All built-in kinds in sidebar order (Pods → Events). */
export const KIND_ORDER = Object.keys(KIND_META) as ResourceKind[];

/** Built-in kinds that are cluster-scoped and therefore ignore the namespace filter. */
const CLUSTER_SCOPED: ReadonlySet<string> = new Set<string>([
  'nodes',
  'namespaces',
  'persistentvolumes',
  'storageclasses',
  'ingressclasses',
  'clusterroles',
  'clusterrolebindings',
  'mutatingwebhookconfigurations',
  'validatingwebhookconfigurations',
  'apiservices',
]);

/** Groups in sidebar order. */
export const GROUP_ORDER: NavGroup[] = [
  'workloads',
  'network',
  'storage',
  'config',
  'access',
  'images',
  'helm',
  'cluster',
  'custom',
];

/**
 * Kinds with a properties gatherer (B13, B18). Must match the `match` in
 * src-tauri/src/kube/properties.rs `gather` — a kind listed here without a
 * gatherer would show a tab that only ever errors, and one with a gatherer but
 * missing here just doesn't offer the tab.
 */
export const KINDS_WITH_PROPERTIES: ReadonlySet<string> = new Set<string>([
  'pods',
  'deployments',
  'services',
  'statefulsets',
  'nodes',
  'helm',
  'ingresses',
  'secrets',
  'serviceaccounts',
  'storageclasses',
  'namespaces',
  'persistentvolumeclaims',
  'persistentvolumes',
  'jobs',
  'cronjobs',
  'horizontalpodautoscalers',
  'networkpolicies',
  'resourcequotas',
  'roles',
  'clusterroles',
  'rolebindings',
  'clusterrolebindings',
  'poddisruptionbudgets',
  'mutatingwebhookconfigurations',
  'validatingwebhookconfigurations',
  'apiservices',
]);

/** Detail-panel tabs, in strip order. Mirrors DetailTab in the store. */
export type DetailTabId =
  | 'logs'
  | 'properties'
  | 'revisions'
  | 'metrics'
  | 'shell'
  | 'yaml'
  | 'events'
  | 'pods'
  | 'timeline';

/** Tab id → label, in the order the strip renders them. */
export const DETAIL_TABS: { id: DetailTabId; label: string }[] = [
  { id: 'logs', label: 'Logs' },
  { id: 'properties', label: 'Properties' },
  { id: 'revisions', label: 'Revisions' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'pods', label: 'Pods' },
  { id: 'shell', label: 'Shell' },
  { id: 'yaml', label: 'YAML' },
  { id: 'events', label: 'Events' },
  { id: 'timeline', label: 'Timeline' },
];

/**
 * Which tabs a selected object gets.
 *
 * One source of truth, because there are three consumers that must agree: the
 * tab strip, the body that renders beneath it, and the `[`/`]` cycle keys. They
 * had already drifted — the cycle keys still believed non-pods had only
 * YAML+Events, which stopped being true when Properties grew past pods (B18),
 * Metrics arrived (B27) and Helm dropped Events (B26). Cycling would have landed
 * on tabs that weren't there.
 *
 * The rules: Logs needs a running container, so it's pods-only. Shell is pods
 * *or* nodes — a node's shell is a different mechanism (a privileged debug pod;
 * see B53) but the same tab from the user's point of view. Properties needs a
 * backend gatherer. Metrics is pods *or* nodes — a node's come from its
 * node-exporter, a pod's from metrics.k8s.io — again the same tab either way. A
 * Helm release has no Kubernetes events of its own.
 */
export function tabsFor(kind: KindId, isPod: boolean): DetailTabId[] {
  return DETAIL_TABS.filter((t) => {
    switch (t.id) {
      case 'logs':
        return isPod;
      case 'shell':
        return isPod || kind === 'nodes';
      case 'properties':
        // Built-in kinds need a gatherer; custom (CRD) kinds use the generic
        // CRD detail gatherer, so they always get the tab.
        return KINDS_WITH_PROPERTIES.has(kind) || isCustomKind(kind);
      case 'revisions':
        // Revision history + rollback — only workloads that carry a pod
        // template with retained history (Deployment/StatefulSet/DaemonSet).
        return isRolloutKind(kind);
      case 'metrics':
        return isPod || kind === 'nodes';
      case 'pods':
        // The "Pods on this node" tab — a node-resource breakdown view. Only
        // nodes get it (a pod's own metrics live on its Metrics tab).
        return kind === 'nodes';
      case 'events':
        return kind !== 'helm';
      case 'timeline':
        return kind === 'cronjobs';
      default:
        return true;
    }
  }).map((t) => t.id);
}

// ---------------------------------------------------------------------------
// Custom (CRD-backed) kinds — B15
// ---------------------------------------------------------------------------

/**
 * True when `id` refers to a discovered CRD kind rather than a built-in one.
 * Custom ids are "group/plural"; built-in ids are bare plurals, so the slash is
 * an unambiguous test (a Kubernetes group name always contains a dot, never a
 * slash, and a plural contains neither).
 */
export function isCustomKind(id: KindId): boolean {
  return id.includes('/');
}

/**
 * The three Kubernetes workload kinds that carry a `kubectl rollout` history
 * (restart, undo, revision list). Centralised here so every "is this a
 * rollout-shaped workload?" check — tabs, actions, table columns, mock data —
 * agrees on the same set.
 */
export function isRolloutKind(kind: KindId): boolean {
  return kind === 'deployments' || kind === 'statefulsets' || kind === 'daemonsets';
}

/**
 * Kubernetes Kind (PascalCase) → built-in nav id, for the kinds we list. Used to
 * resolve an event's involvedObject to a navigable table (B33).
 */
const BUILTIN_KIND_TO_NAV: Record<string, ResourceKind> = {
  Pod: 'pods',
  Deployment: 'deployments',
  ReplicaSet: 'replicasets',
  StatefulSet: 'statefulsets',
  DaemonSet: 'daemonsets',
  Job: 'jobs',
  CronJob: 'cronjobs',
  Service: 'services',
  Ingress: 'ingresses',
  IngressClass: 'ingressclasses',
  ConfigMap: 'configmaps',
  Secret: 'secrets',
  ServiceAccount: 'serviceaccounts',
  PersistentVolumeClaim: 'persistentvolumeclaims',
  PersistentVolume: 'persistentvolumes',
  StorageClass: 'storageclasses',
  Node: 'nodes',
  Namespace: 'namespaces',
  Role: 'roles',
  ClusterRole: 'clusterroles',
  RoleBinding: 'rolebindings',
  ClusterRoleBinding: 'clusterrolebindings',
  PodDisruptionBudget: 'poddisruptionbudgets',
  MutatingWebhookConfiguration: 'mutatingwebhookconfigurations',
  ValidatingWebhookConfiguration: 'validatingwebhookconfigurations',
  APIService: 'apiservices',
};

/**
 * Resolve an object's Kubernetes Kind (plus its apiVersion, needed to
 * disambiguate CRDs) to the nav id of a table we show, or null when we don't list
 * that kind (B33). A null result is why an event row stays inert rather than
 * dead-clicking.
 *
 * Built-ins match by Kind alone. A CRD matches a discovered `CustomKind` by both
 * Kind and group (the group is the part of `apiVersion` before the slash) — Kind
 * alone can collide across groups (two CRDs both named `Application`).
 */
export function navIdForKind(
  kind: string,
  apiVersion: string | undefined,
  customKinds: CustomKind[]
): KindId | null {
  const builtin = BUILTIN_KIND_TO_NAV[kind];
  if (builtin) return builtin;
  const group = apiVersion && apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
  const ck = customKinds.find((c) => c.kind === kind && c.group === group);
  return ck ? ck.id : null;
}

/** Icon for every custom kind (they have no per-kind glyph of their own). */
const CUSTOM_ICON = <Box size={14} />;

/**
 * Generic columns for a CRD-backed kind. A CRD's schema is arbitrary, so there's
 * nothing meaningful to show beyond identity and age without per-CRD knowledge —
 * the YAML tab carries the detail. Must match the backend's `map_dynamic`.
 */
function customColumns(namespaced: boolean): string[] {
  return namespaced ? ['NAME', 'NAMESPACE', 'AGE'] : ['NAME', 'AGE'];
}

/**
 * Metadata for any kind: the static entry for built-ins, or a derived one for a
 * discovered custom kind. Returns undefined for an id that is neither (e.g. a
 * persisted nav pointing at a CRD that no longer exists on this cluster).
 */
export function kindMeta(id: KindId, customKinds: CustomKind[]): KindMeta | undefined {
  if (!isCustomKind(id)) return KIND_META[id as ResourceKind];
  const ck = customKinds.find((k) => k.id === id);
  if (!ck) return undefined;
  return {
    group: 'custom',
    // The Kind name reads better than the plural ("Application", not "applications").
    label: ck.kind,
    icon: CUSTOM_ICON,
    columns: customColumns(ck.namespaced),
  };
}

/** Whether a kind ignores the namespace filter (cluster-scoped). */
export function isClusterScoped(id: KindId, customKinds: CustomKind[]): boolean {
  if (!isCustomKind(id)) return CLUSTER_SCOPED.has(id);
  const ck = customKinds.find((k) => k.id === id);
  // Unknown custom kinds have no rows to filter; treat as namespaced.
  return ck ? !ck.namespaced : false;
}
