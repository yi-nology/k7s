/**
 * Kubernetes resource kinds and custom kind discovery.
 *
 * Split from providers/types.ts during the large-file refactor.
 */

/**
 * The Kubernetes resource kinds the app navigates. "events" is a read-only
 * cluster-wide feed rather than a managed resource (B14), but it rides the same
 * row/table plumbing as the rest.
 */
export type ResourceKind =
  | 'pods'
  | 'deployments'
  | 'replicasets'
  | 'statefulsets'
  | 'daemonsets'
  | 'jobs'
  | 'cronjobs'
  | 'services'
  | 'ingresses'
  | 'ingressclasses'
  | 'configmaps'
  | 'secrets'
  | 'serviceaccounts'
  | 'persistentvolumeclaims'
  | 'persistentvolumes'
  | 'storageclasses'
  | 'networkpolicies'
  | 'horizontalpodautoscalers'
  | 'resourcequotas'
  | 'limitranges'
  | 'nodes'
  | 'namespaces'
  | 'events'
  | 'roles'
  | 'clusterroles'
  | 'rolebindings'
  | 'clusterrolebindings'
  | 'poddisruptionbudgets'
  | 'mutatingwebhookconfigurations'
  | 'validatingwebhookconfigurations'
  | 'apiservices'
  | 'helm';

/**
 * A CRD-backed kind discovered on connect (B15).
 *
 * These aren't known at build time, so they can't be part of {@link ResourceKind}.
 */
export interface CustomKind {
  /** Stable id, always "group/plural" (e.g. "argoproj.io/applications"). */
  id: string;
  group: string;
  /** The version being watched (the CRD's storage version). */
  version: string;
  /** Kind name, e.g. "Application" — the nav label. */
  kind: string;
  plural: string;
  /** False for cluster-scoped CRDs, which ignore the namespace filter. */
  namespaced: boolean;
}

/**
 * Any kind the table can show: a built-in {@link ResourceKind} or a custom kind's
 * id. The `(string & {})` keeps editor autocomplete for the built-in literals
 * while still admitting the dynamic ids.
 *
 * A custom id always contains a slash; a built-in id never does. That's the test
 * used wherever the two need distinguishing (`isCustomKind`).
 */
// eslint-disable-next-line @typescript-eslint/ban-types
export type KindId = ResourceKind | (string & {});
