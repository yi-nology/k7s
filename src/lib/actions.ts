/**
 * The object-action model (B39) — what can be done to a resource, as data.
 *
 * This exists because the same actions are now reachable from two places: the
 * detail panel's "…" menu and the table's row context menu. Those had to agree
 * about *everything* — which kinds can be deleted, which need a confirmation,
 * what the confirmation says — and two copies of that would drift into a menu
 * offering an action the other refuses.
 *
 * Data, not closures, following lib/palette.ts: the predicates and the
 * confirmation wording are the part worth testing, and they stay testable
 * without a provider, a store, or a DOM. Execution lives with the components
 * (see runAction), because it needs the provider and the store.
 *
 * The one concept the old single-row menu didn't have is `bulk`. An action that
 * takes a parameter (scale, forward) or streams progress for one object at a
 * time (drain) cannot sensibly apply to a selection, so a multi-row menu must
 * hide it rather than silently act on only the first row.
 *
 * Localised: the menu labels and confirmations live in the i18n dictionaries;
 * the render-side call passes a translator (`t`). The functions default to a
 * built-in English translator so existing tests and non-React callers still
 * work without ceremony.
 */

import { translate, type Locale } from "./i18n";
import type { KindId, Row } from "../providers/types";

export type ActionId =
  | "view-pods"
  | "forward"
  | "scale"
  | "restart"
  | "rollback"
  | "cordon"
  | "uncordon"
  | "drain"
  | "delete"
  | "download-yaml"
  | "modify-image"
  | "files";

export interface ActionDef {
  id: ActionId;
  /** Menu label. A trailing "…" means another step follows, as in the rest of the app. */
  label: string;
  /** Rendered in the danger colour, and grouped at the bottom. */
  danger?: boolean;
  /**
   * "immediate" runs on click; "confirm" needs a yes; "form" collects a
   * parameter first. Only "form" actions have bespoke UI.
   */
  mode: "immediate" | "confirm" | "form";
  /** Whether this can act on a whole selection at once. */
  bulk: boolean;
}

/** A translator: a locale plus a `(key, ...args) => string` shim. */
export type Translator = (locale: Locale, key: string, ...args: unknown[]) => string;

/** The default translator: every catalogue, English by default. */
const enTranslator: Translator = (locale, key, ...args) => translate(locale, key, ...args);

/**
 * The label key into the i18n dictionary, one per ActionId. Lives in this file
 * so the action list below is the single source of truth — adding an action
 * means adding one line here and one entry in the dictionary.
 */
const LABEL_KEYS: Record<ActionId, string> = {
  "view-pods": "actions.labels.viewPods",
  forward: "actions.labels.forward",
  scale: "actions.labels.scale",
  restart: "actions.labels.restart",
  rollback: "actions.labels.rollback",
  cordon: "actions.labels.cordon",
  uncordon: "actions.labels.uncordon",
  drain: "actions.labels.drain",
  delete: "actions.labels.delete",
  "download-yaml": "actions.labels.downloadYaml",
  "modify-image": "actions.labels.modifyImage",
  files: "actions.labels.files",
};

/** The mode/danger/bulk metadata, in menu order. Order is display order: safe things first. */
const META: Record<ActionId, Omit<ActionDef, "id" | "label">> = {
  "view-pods": { mode: "immediate", bulk: false },
  forward: { mode: "form", bulk: false },
  scale: { mode: "form", bulk: false },
  restart: { mode: "confirm", bulk: true },
  // Rollback is confirm-gated: it changes the running workload. Not bulk — a
  // multi-row selection rolling every workload back at once has no real use
  // case, and a one-shot "previous revision" is the action's whole meaning.
  rollback: { mode: "confirm", bulk: false },
  cordon: { mode: "immediate", bulk: true },
  uncordon: { mode: "immediate", bulk: true },
  // Not bulk: a drain streams progress for one node and can take minutes, and
  // draining several nodes at once is how you accidentally evict everything with
  // nowhere left to reschedule it.
  drain: { mode: "confirm", bulk: false, danger: true },
  delete: { mode: "confirm", bulk: true, danger: true },
  // Download is read-only and works for any kind, including synthetic rows
  // (events). Safe + bulk so the user can grab a hundred pods' YAML in one
  // zip-less flow.
  "download-yaml": { mode: "immediate", bulk: true },
  // Modify-image: a form dialog that re-writes the workload's container
  // `image:` values and applies the result. Not bulk — a multi-row
  // selection would have to fetch+rewrite N manifests and show N dialogs,
  // and there's no real use case for that.
  "modify-image": { mode: "form", bulk: false },
  // Pod Files: opens the file browser overlay for a single pod. Not bulk —
  // browsing files from multiple pods simultaneously has no meaning.
  files: { mode: "immediate", bulk: false },
};

/** Every action id, in menu order. The metadata + label key together define the action. */
const ORDER: ActionId[] = [
  "files",
  "view-pods",
  "forward",
  "scale",
  "restart",
  "rollback",
  "modify-image",
  "cordon",
  "uncordon",
  "drain",
  "download-yaml",
  "delete",
];

/** Build the action list with localised labels. */
export function allActions(locale: Locale, t: Translator = enTranslator): ActionDef[] {
  return ORDER.map((id) => {
    const meta = META[id];
    const label = t(locale, LABEL_KEYS[id]);
    return { id, label, ...meta };
  });
}

/** Does this action apply to a single row of this kind? */
function applies(id: ActionId, kind: KindId, row: Row): boolean {
  switch (id) {
    case "delete":
      // Nodes and namespaces are deleted through their own lifecycle, and a Helm
      // release "row" is a synthetic view over a storage Secret — deleting that
      // corrupts the release rather than uninstalling it.
      return kind !== "nodes" && kind !== "namespaces" && kind !== "helm";
    case "scale":
      return kind === "deployments" || kind === "statefulsets";
    case "cordon":
    case "uncordon":
    case "drain":
      return kind === "nodes";
    case "restart":
      return isRestartable(kind);
    case "rollback":
      // Only workloads with retained revision history can roll back — the same
      // rollout-kind family restart uses, minus pods (a pod has no history).
      return isRolloutKind(kind);
    case "view-pods":
      // Needs a selector to build the filter from; a workload without one would
      // navigate to an empty table.
      return isRolloutKind(kind) && !!row.selector && Object.keys(row.selector).length > 0;
    case "forward":
      return kind === "pods" || kind === "services";
    case "download-yaml":
      // Any row whose provider can fetch its YAML is fair game. Events and the
      // Helm synthetic rows both expose `getYaml`, so we let them through
      // here; the provider does the actual work and the file picker still
      // comes out as a sensible `kind-name.yaml`.
      return true;
    case "files":
      // Pod file browser — only meaningful for pods with a running filesystem.
      return kind === "pods";
    case "modify-image":
      // Only meaningful for workloads that own a `spec.template.spec` with
      // `containers:` — a Service, ConfigMap, or PVC has nothing to swap.
      // ReplicaSets are included for symmetry with the rollout kind family
      // even though users rarely change their image directly.
      return (
        kind === "deployments" ||
        kind === "statefulsets" ||
        kind === "daemonsets" ||
        kind === "jobs" ||
        kind === "cronjobs" ||
        kind === "replicasets"
      );
  }
}

/** Kinds whose restart is a `kubectl rollout restart` template patch. */
export function isRolloutKind(kind: KindId): boolean {
  return kind === "deployments" || kind === "statefulsets" || kind === "daemonsets";
}

/** Anything that can be restarted at all — a pod, or a rollout-capable workload. */
export function isRestartable(kind: KindId): boolean {
  return kind === "pods" || isRolloutKind(kind);
}

/**
 * The actions available for `rows` of `kind`.
 *
 * With more than one row, only bulk-capable actions survive — and an action must
 * apply to *every* row, not merely one of them, so a menu can never offer
 * something that would fail partway through the selection.
 *
 * `locale` and `t` are required for the labels; the default English translator
 * keeps the test-only call site working.
 */
export function actionsFor(
  kind: KindId,
  rows: Row[],
  locale: Locale = "en",
  t: Translator = enTranslator,
): ActionDef[] {
  if (rows.length === 0) return [];
  const bulk = rows.length > 1;
  return allActions(locale, t).filter((a) => {
    if (bulk && !a.bulk) return false;
    return rows.every((row) => applies(a.id, kind, row));
  });
}

/** Names, truncated — a confirmation listing 200 pods is not a confirmation. */
const MAX_LISTED = 8;

/** A name disambiguated by its namespace when the selection spans them. */
function formatName(r: Row): string {
  return r.namespace ? `${r.namespace}/${r.name}` : r.name;
}

/**
 * True if every row has the same namespace, treating "no namespace" (cluster-
 * scoped kinds) as a value that has to match itself.
 */
function sameNamespace(rows: Row[]): boolean {
  if (rows.length === 0) return true;
  const first = rows[0].namespace ?? "";
  return rows.every((r) => (r.namespace ?? "") === first);
}

/**
 * Names, truncated — a confirmation listing 200 pods is not a confirmation.
 *
 * When the selection spans multiple namespaces, each name is prefixed with its
 * namespace (`default/api, kube-system/worker`) so the confirmation reveals
 * which objects the user is about to delete. The whole risk of a bulk action is
 * that the selection isn't what the user thinks — two pods with the same name
 * in different namespaces would otherwise look identical in the dialog, and
 * "Delete 3 pods? (api, api, api)" gives the user no way to tell.
 *
 * When every row is in the same namespace (the common case), the bare names
 * are returned unchanged so the existing UX doesn't shift.
 */
export function listNames(rows: Row[]): string {
  const formatted = sameNamespace(rows) ? rows.map((r) => r.name) : rows.map(formatName);
  if (formatted.length <= MAX_LISTED) return formatted.join(", ");
  const rest = formatted.length - MAX_LISTED;
  return `${formatted.slice(0, MAX_LISTED).join(", ")} and ${rest} more`;
}

/**
 * What the confirmation says.
 *
 * It always enumerates what is about to happen — the count *and* the names.
 * "Delete 3 pods?" is not enough to act on safely: the whole risk of bulk
 * actions is that the selection isn't what you think it is, and the names are
 * the only thing that reveals that. When the selection spans namespaces, each
 * name is prefixed with its namespace so the user can tell which objects they
 * are about to delete (see `listNames`).
 */
export function confirmText(
  id: ActionId,
  kind: KindId,
  rows: Row[],
  locale: Locale = "en",
  t: Translator = enTranslator,
): string {
  const n = rows.length;
  const what = n === 1 ? rows[0].name : `${n} ${plural(kind, n)}`;
  const names = n === 1 ? "" : ` (${listNames(rows)})`;

  switch (id) {
    case "delete":
      return t(locale, "actions.confirm.delete", what, names);
    case "restart":
      return kind === "pods"
        ? t(locale, "actions.confirm.restartPods", what, names)
        : t(locale, "actions.confirm.restartWorkload", what, names);
    case "rollback":
      return t(locale, "actions.confirm.rollback", what);
    case "drain":
      return t(locale, "actions.confirm.drain", what);
    case "cordon":
      return t(locale, "actions.confirm.cordon", what, names);
    case "uncordon":
      return t(locale, "actions.confirm.uncordon", what, names);
    default:
      return t(locale, "actions.confirm.generic", id, what, names);
  }
}

/** A readable noun for a kind, singular or plural. */
export function plural(kind: KindId, n: number): string {
  const singular: Record<string, string> = {
    pods: "pod",
    deployments: "deployment",
    replicasets: "replicaset",
    statefulsets: "statefulset",
    daemonsets: "daemonset",
    jobs: "job",
    cronjobs: "cronjob",
    services: "service",
    nodes: "node",
    configmaps: "configmap",
    secrets: "secret",
    ingresses: "ingress",
  };
  // Custom kinds are "group/plural" ids; the plural half is the readable part.
  const base = singular[kind] ?? kind.split("/").pop() ?? String(kind);
  if (n === 1) return base;
  // "ingress" → "ingresses", everything else takes a plain -s. The map above is
  // already plural-derived, so this only has to handle the sibilant case.
  return /(s|x|z|ch|sh)$/.test(base) ? `${base}es` : `${base}s`;
}

/**
 * How a bulk run went. Reported rather than swallowed: a partial failure is the
 * normal outcome when a selection spans objects with different owners or
 * permissions, and "some of them worked" is exactly what the user needs to know.
 */
export interface BulkOutcome {
  ok: number;
  failures: { name: string; error: string }[];
}

/**
 * Run `fn` once per row, collecting per-object outcomes.
 *
 * Concurrent and `allSettled` rather than `all`: one object failing — a different
 * owner, a stricter RBAC rule, something already gone — must not abandon the rest
 * half-done, and the user needs to know exactly which ones failed rather than
 * just that "it" errored.
 *
 * Lives here rather than in the component so "N selected rows issues N calls"
 * is provable without a DOM.
 */
export async function runBulk<T extends { name: string }>(
  rows: T[],
  fn: (row: T) => Promise<void>,
): Promise<BulkOutcome> {
  const results = await Promise.allSettled(rows.map(fn));
  const failures: BulkOutcome["failures"] = [];
  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") ok += 1;
    else {
      const reason: unknown = r.reason;
      failures.push({
        name: rows[i].name,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });
  return { ok, failures };
}

/** Turn a bulk outcome into the sentence shown in the error banner, or null. */
export function bulkErrorText(
  outcome: BulkOutcome,
  locale: Locale = "en",
  t: Translator = enTranslator,
): string | null {
  if (outcome.failures.length === 0) return null;
  const list = outcome.failures.map((f) => `${f.name}: ${f.error}`).join("; ");
  if (outcome.ok === 0) return t(locale, "actions.bulk.allFailed", outcome.failures.length, list);
  return t(
    locale,
    "actions.bulk.partial",
    outcome.ok,
    outcome.failures.length,
    list,
  );
}
