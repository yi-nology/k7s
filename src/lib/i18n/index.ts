/**
 * i18n core (language switching, translation lookup).
 *
 * Two locales ship: English (the source of truth) and Simplified Chinese. The
 * shape is fixed: adding a third language is a new dictionary in `dictionaries.ts`
 * and a one-line entry below. Unknown locales fall back to English rather than
 * rendering blanks.
 *
 * `translate()` is a pure function over a locale and a key — it doesn't read the
 * store, so it's safe in tests, in render guards, and during the synchronous
 * boot that runs before React has asked for prefs. The store-aware hook lives
 * next door in `useI18n.ts`.
 *
 * `kindLabel()`, `groupLabel()`, and `tabLabel()` translate the static kind
 * registry. The English names stay in `kinds.ts` (the canonical names — what
 * `kubectl get` would print), and the i18n layer adds a localised label on top.
 * That keeps parser-facing names pure while letting the chrome show
 * "工作负载 / Pod" in a Chinese UI.
 */

import type { NavGroup, ResourceKind, KindMeta, DetailTabId } from "../kinds";
import { GROUP_LABELS as EN_GROUP_LABELS, KIND_META as EN_KIND_META, DETAIL_TABS as EN_DETAIL_TABS } from "../kinds";
import { en, zh, type Dictionary, type Parameters } from "./dictionaries";

/** The two locales the app ships. */
export type Locale = "en" | "zh";
export const LOCALES: Locale[] = ["en", "zh"];

/** Human-readable label for a locale — used by the language switcher UI. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

/**
 * Cache for the paint-time boot — see `index.html`. Read synchronously, so the
 * HTML's inline script can set `<html lang>` before the first paint and React's
 * first render already agrees with what the user picked.
 */
export const LOCALE_STORAGE_KEY = "k7s.locale";

/** Narrow arbitrary persisted junk to a Locale, defaulting to English. */
export function asLocale(value: unknown): Locale {
  return LOCALES.includes(value as Locale) ? (value as Locale) : "en";
}

/**
 * Read the cached locale for the paint-time boot. Falls back to "en" if the
 * stored value is unrecognised or the storage API throws — this is the same
 * shape as `cachedTheme`, mirroring the inline script in `index.html`.
 */
export function cachedLocale(): Locale {
  // `window.localStorage` first: that's the one the browser actually uses, and
  // it's the same one the inline script in index.html writes to. Plain
  // `localStorage` falls back to a (possibly experimental) Node global in tests,
  // which is not what we want — we want to read the same key the page would.
  const store = typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  if (!store) return "en";
  try {
    const v = store.getItem(LOCALE_STORAGE_KEY);
    return v === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

/** Persist the choice for the paint-time cache. Prefs remain canonical. */
export function cacheLocale(locale: Locale): void {
  const store = typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  if (!store) return;
  try {
    store.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* storage disabled — the cache is an optimisation, not state. */
  }
}

/** Look up the bundled dictionary for a locale. Always defined; unknown → en. */
export function dict(locale: Locale): Dictionary {
  return locale === "zh" ? zh : en;
}

// ---- message lookup ----

/**
 * Fetch a message at a dotted path. Function leaves are called with `args` (the
 * tail of the parameters, in order). Unknown keys fall back to the English
 * version, and finally to the key itself, so a half-translated language is a
 * half-translated UI rather than a blank one.
 *
 * The return type is `string` — every dictionary leaf is either a string or a
 * function returning a string. A function returning anything else would not be
 * type-checked against this signature, which is the point.
 */
export function translate(locale: Locale, key: string, ...args: unknown[]): string {
  const fromLocale = resolve(locale, key, args);
  if (fromLocale !== undefined) return fromLocale;
  const fromEnglish = resolve("en", key, args);
  if (fromEnglish !== undefined) return fromEnglish;
  return key;
}

/** Walk a dotted path, invoking a function leaf when found. */
function resolve(locale: Locale, path: string, args: unknown[]): string | undefined {
  let cur: unknown = dict(locale);
  for (const seg of path.split(".")) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  if (typeof cur === "function") {
    try {
      const out = cur(...args);
      return typeof out === "string" ? out : undefined;
    } catch {
      // A function with the wrong arity is a dictionary bug, not a runtime
      // problem to surface to the user. Return undefined so the fallback fires.
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

// ---- labels that decorate the static kind registry ----

/**
 * Localised labels for the sidebar's group headers (Workloads, Network, …).
 *
 * The registry in `kinds.ts` keeps the English names — those are the canonical
 * kinds, and they appear in `kubectl get` output. The sidebar shows whatever
 * the locale says, so the chrome adapts without forking the registry.
 */
const GROUP_LABELS_ZH: Record<NavGroup, string> = {
  workloads: "工作负载",
  network: "网络",
  config: "配置",
  storage: "存储",
  cluster: "集群",
  helm: "Helm",
  custom: "自定义",
};

const KIND_LABELS_ZH: Record<ResourceKind, string> = {
  pods: "Pod",
  deployments: "Deployment",
  replicasets: "ReplicaSet",
  statefulsets: "StatefulSet",
  daemonsets: "DaemonSet",
  jobs: "Job",
  cronjobs: "CronJob",
  services: "Service",
  ingresses: "Ingress",
  ingressclasses: "IngressClass",
  configmaps: "ConfigMap",
  secrets: "Secret",
  serviceaccounts: "ServiceAccount",
  persistentvolumeclaims: "PersistentVolumeClaim",
  persistentvolumes: "PersistentVolume",
  storageclasses: "StorageClass",
  nodes: "节点",
  namespaces: "命名空间",
  events: "事件",
  helm: "发布",
};

const TAB_LABELS_ZH: Record<DetailTabId, string> = {
  logs: "日志",
  properties: "属性",
  metrics: "指标",
  shell: "终端",
  yaml: "YAML",
  events: "事件",
};

/** Translated group header (or English on en/unknown). */
export function groupLabel(group: NavGroup, locale: Locale): string {
  if (locale === "zh") return GROUP_LABELS_ZH[group];
  return EN_GROUP_LABELS[group];
}

/** Translated kind label for built-in kinds. Custom kinds should use kindMeta(). */
export function kindLabel(kind: ResourceKind, locale: Locale): string {
  if (locale === "zh") return KIND_LABELS_ZH[kind];
  return EN_KIND_META[kind].label;
}

/** Translated detail-tab label, falling back to the English registry. */
export function tabLabel(tab: DetailTabId, locale: Locale): string {
  if (locale === "zh") return TAB_LABELS_ZH[tab];
  return EN_DETAIL_TABS.find((t) => t.id === tab)?.label ?? tab;
}

/** Localised kind meta (label only — columns stay English by design). */
export function localizedKindMeta(kind: ResourceKind, locale: Locale): KindMeta {
  const base = EN_KIND_META[kind];
  if (locale === "zh") {
    return { ...base, label: KIND_LABELS_ZH[kind] };
  }
  return base;
}

// ---- label lookup that resolves custom kinds too ----

/**
 * Resolve a kind's display label for a locale: built-in kinds use the locale's
 * registry, custom (CRD) kinds fall back to their own `Kind` (the PascalCase
 * name returned by the API — a sensible default for a label since we have no
 * locale-specific string for an arbitrary CRD).
 *
 * Returns `undefined` only for a built-in id that isn't in the registry, which
 * the existing `kindMeta()` already guards against — this is the same answer
 * a caller would get there.
 */
export function kindLabelFor(
  id: string,
  customKinds: { id: string; kind: string }[],
  locale: Locale,
): string | undefined {
  if (id.includes("/")) {
    const ck = customKinds.find((k) => k.id === id);
    return ck ? ck.kind : undefined;
  }
  if (id in EN_KIND_META) {
    return kindLabel(id as ResourceKind, locale);
  }
  return undefined;
}

/**
 * Localised `kindMeta()`: same as `kindMeta()` in `lib/kinds.ts` but with the
 * label translated. Custom kinds' labels stay as the CRD's own Kind name; the
 * columns stay English by design (they are short, uppercase headers, and the
 * table is data-dense — translating every column would be a larger refactor
 * and is left for when a request for it actually lands).
 */
export function localizedKindMetaFor(
  id: string,
  customKinds: { id: string; kind: string; namespaced: boolean; group: string }[],
  locale: Locale,
): KindMeta | undefined {
  if (id.includes("/")) {
    const ck = customKinds.find((k) => k.id === id);
    if (!ck) return undefined;
    return {
      group: "custom",
      label: ck.kind,
      icon: "◈",
      columns: ck.namespaced ? ["NAME", "NAMESPACE", "AGE"] : ["NAME", "AGE"],
    };
  }
  if (id in EN_KIND_META) {
    return localizedKindMeta(id as ResourceKind, locale);
  }
  return undefined;
}

// ---- re-exports for convenience ----
export type { Dictionary, Parameters };
export { en, zh };
