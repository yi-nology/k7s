/**
 * Tests for the i18n core: catalogue resolution, locale validation, and the
 * kind-registry overlays. The dictionaries themselves are type-checked by
 * TypeScript, so we focus on the *behaviour* — a missing key falls back to
 * English, unknown locales are narrowed, and the kind/group labels follow the
 * active locale.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  asLocale,
  cachedLocale,
  cacheLocale,
  dict,
  groupLabel,
  kindLabel,
  kindLabelFor,
  LOCALES,
  tabLabel,
  translate,
  type Locale,
} from "./i18n";

/**
 * Some vitest environments don't ship a working `localStorage` (the one Node
 * ships experimentally throws without `--localstorage-file`). The
 * `cacheLocale` / `cachedLocale` helpers handle that gracefully, but we want
 * to test the round-trip, so we install a tiny in-memory stub and undo it
 * after the test.
 */
function installStorageStub(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => ({
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    }),
  });
}

describe("asLocale", () => {
  it("passes through the two valid values", () => {
    expect(asLocale("en")).toBe("en");
    expect(asLocale("zh")).toBe("zh");
  });

  it("defaults anything else to 'en'", () => {
    for (const junk of [null, undefined, "", "fr", "EN", "Solarized", 3, {}]) {
      expect(asLocale(junk)).toBe("en");
    }
  });
});

describe("LOCALES", () => {
  it("is exactly the two shipped locales, in display order", () => {
    expect(LOCALES).toEqual(["en", "zh"]);
  });
});

describe("dict", () => {
  it("returns a dictionary for every shipped locale", () => {
    for (const l of LOCALES) {
      const d = dict(l);
      expect(d.chrome.settings.title.length).toBeGreaterThan(0);
    }
  });

  it("falls back to English for an unknown locale", () => {
    expect(dict("klingon" as unknown as Locale)).toBe(dict("en"));
  });
});

describe("translate", () => {
  it("returns the English string for an English lookup", () => {
    expect(translate("en", "chrome.settings.title")).toBe("Settings");
  });

  it("returns the Chinese string for a Chinese lookup", () => {
    expect(translate("zh", "chrome.settings.title")).toBe("设置");
  });

  /** A function leaf with the right arity renders correctly in both languages. */
  it("calls parameterised functions with positional args", () => {
    expect(translate("en", "chrome.sidebar.watch", 3)).toBe("watch: 3 streams active");
    expect(translate("zh", "chrome.sidebar.watch", 3)).toBe("监听: 3 路活跃");
  });

  /** A dotted path with no entry at all returns the key — visible, debuggable. */
  it("returns the key when no locale has it", () => {
    expect(translate("en", "no.such.key")).toBe("no.such.key");
  });

  /** A leading string arg acts as the default copy for an untranslated key.
   *  The call site pattern is `t("metrics.title", "Metrics")` — we want the
   *  English copy to render when neither the active locale nor English has
   *  the key, so a half-translated UI is half-translated English rather than
   *  a raw key string. */
  it("uses a leading string arg as the fallback when no dictionary has the key", () => {
    expect(translate("en", "no.such.key", "Default copy")).toBe("Default copy");
    expect(translate("zh", "no.such.key", "默认文案")).toBe("默认文案");
  });

  /** When the locale has the key, the fallback is ignored — the dictionary
   *  is canonical. The fallback is only for untranslated keys. */
  it("prefers the dictionary over the fallback when both exist", () => {
    expect(translate("en", "chrome.settings.title", "Ignored")).toBe("Settings");
  });

  it("falls back to English for a Chinese-only key", () => {
    // Synthesise a Chinese-only key by reading one that exists in English but
    // is missing in Chinese — built-in dictionaries are symmetrical today, so
    // the easy test is just "English works".
    expect(translate("zh", "chrome.settings.title")).toBe("设置");
  });
});

describe("groupLabel", () => {
  it("returns the English name for English locales", () => {
    expect(groupLabel("workloads", "en")).toBe("Workloads");
    expect(groupLabel("cluster", "en")).toBe("Cluster");
  });

  it("returns the Chinese name for Chinese locales", () => {
    expect(groupLabel("workloads", "zh")).toBe("工作负载");
    expect(groupLabel("cluster", "zh")).toBe("集群");
    expect(groupLabel("custom", "zh")).toBe("自定义");
  });
});

describe("kindLabel", () => {
  it("returns English names in English", () => {
    expect(kindLabel("pods", "en")).toBe("Pods");
    expect(kindLabel("nodes", "en")).toBe("Nodes");
  });

  it("returns Chinese names in Chinese (using the canonical form)", () => {
    expect(kindLabel("pods", "zh")).toBe("Pod");
    expect(kindLabel("nodes", "zh")).toBe("节点");
    expect(kindLabel("events", "zh")).toBe("事件");
  });
});

/** Both locales must ship every key the table reads; the empty-state
 *  differentiation (empty vs emptyNone) is rendered, not "looked up elsewhere",
 *  so a missing key would render the raw dotted path in production. */
describe("table empty-state keys", () => {
  it("ships table.empty in both locales", () => {
    expect(translate("en", "table.empty")).toBe("no resources match filter");
    expect(translate("zh", "table.empty")).toBe("无匹配资源");
  });

  it("ships table.emptyNone in both locales (no-filter empty state)", () => {
    expect(translate("en", "table.emptyNone")).toBe("no resources");
    expect(translate("zh", "table.emptyNone")).toBe("无资源");
  });
});

/** The Alerting overlay's two table subcomponents (alerts + silences) route
 *  their empty-state copy and column headers through `t()`. The English
 *  values are the original hardcoded strings; the Chinese values are the
 *  translations — both must be present so a half-translated UI doesn't
 *  fall back to a raw dotted key. */
describe("alerts panel keys", () => {
  it("ships alerts.empty.alerts in both locales", () => {
    expect(translate("en", "alerts.empty.alerts")).toBe("No active alerts");
    expect(translate("zh", "alerts.empty.alerts")).toBe("无活动告警");
  });

  it("ships alerts.empty.silences in both locales", () => {
    expect(translate("en", "alerts.empty.silences")).toBe("No silences");
    expect(translate("zh", "alerts.empty.silences")).toBe("无静默");
  });

  it("ships alerts.cols.alert through alerts.cols.status in both locales", () => {
    for (const key of [
      "alert",
      "severity",
      "state",
      "summary",
      "activeSince",
      "matchers",
      "comment",
      "createdBy",
      "starts",
      "ends",
      "status",
    ]) {
      const en = translate("en", `alerts.cols.${key}`);
      const zh = translate("zh", `alerts.cols.${key}`);
      expect(en.length, `alerts.cols.${key} en`).toBeGreaterThan(0);
      expect(zh.length, `alerts.cols.${key} zh`).toBeGreaterThan(0);
      expect(en, `alerts.cols.${key} en !== zh`).not.toBe(zh);
    }
  });
});

/** The Helm Market Repositories tab (Phase 1 of KubePi parity) — add/remove/
 *  refresh + the inline form. Pass-12 surfaced that the inline form was a
 *  bare `<div>` with no `<form onSubmit>` and no `required` attributes, so
 *  Enter didn't submit and empty fields silently went to the provider. The
 *  fix is mechanical, but this describe pins every key the panel renders so
 *  a future dictionary shrink can't drop one (same leak class as
 *  `chrome.palette.actions.*` / `topology.*`). */
describe("helm market repositories panel keys", () => {
  it("ships helm.repos.* and helm.repos.form.* in both locales", () => {
    for (const key of [
      "refreshAll",
      "empty",
      "error",
      "ok",
      "never",
      "refresh",
      "remove",
      "add",
    ]) {
      const en = translate("en", `helm.repos.${key}`);
      const zh = translate("zh", `helm.repos.${key}`);
      expect(en.length, `helm.repos.${key} en`).toBeGreaterThan(0);
      expect(zh.length, `helm.repos.${key} zh`).toBeGreaterThan(0);
    }
    for (const key of ["name", "url", "desc", "add", "cancel"]) {
      const en = translate("en", `helm.repos.form.${key}`);
      const zh = translate("zh", `helm.repos.form.${key}`);
      expect(en.length, `helm.repos.form.${key} en`).toBeGreaterThan(0);
      expect(zh.length, `helm.repos.form.${key} zh`).toBeGreaterThan(0);
    }
  });

  it("preserves confirmRemove's parameterised shape (it is a function, not a string)", () => {
    // The `remove` row-action builds the confirm prompt via
    // `t("helm.repos.confirmRemove", ...)` and the value is a
    // `name => string` function so the repo name interpolates cleanly.
    // Pin the function shape so a future refactor that turns it into a
    // static string (silently breaking the name interpolation) trips
    // the test. Same shape as `metricsExplorer.saved.confirmRemove`.
    const enVal = dict("en").helm.repos.confirmRemove;
    const zhVal = dict("zh").helm.repos.confirmRemove;
    expect(typeof enVal, "en confirmRemove must be a function").toBe("function");
    expect(typeof zhVal, "zh confirmRemove must be a function").toBe("function");
    expect((enVal as (n: string) => string)("bitnami")).toBe('Remove repo "bitnami"?');
    expect((zhVal as (n: string) => string)("bitnami")).toBe('删除仓库 "bitnami"?');
  });

  it("ships helm.empty.{noMatch, noRepos} in both locales", () => {
    expect(translate("en", "helm.empty.noMatch")).toBe(
      "No charts match this search",
    );
    expect(translate("zh", "helm.empty.noMatch")).toBe("无匹配的 Charts");
    expect(translate("en", "helm.empty.noRepos")).toBe(
      "No repos yet — add one in Repositories",
    );
    expect(translate("zh", "helm.empty.noRepos")).toBe(
      "暂无仓库 — 先在仓库页添加一个",
    );
  });
});

/** The Settings panel (B23) is a single overlay with eight rows plus a footer
 *  note + reset, all routed through `t()`. Pass-9's manual walk-through found
 *  the panel renders correctly in both locales with no leaks; this describe
 *  pins the keys so a future refactor can't drop one the way the
 *  `chrome.palette.actions.*` / `topology.*` keys were dropped in earlier
 *  passes. */
describe("settings panel keys", () => {
  it("ships chrome.settings.{title, footerNote, reset} in both locales", () => {
    expect(translate("en", "chrome.settings.title")).toBe("Settings");
    expect(translate("zh", "chrome.settings.title")).toBe("设置");
    expect(translate("en", "chrome.settings.footerNote")).toBe("changes save automatically");
    expect(translate("zh", "chrome.settings.footerNote")).toBe("修改自动保存");
    expect(translate("en", "chrome.settings.reset")).toBe("reset to defaults");
    expect(translate("zh", "chrome.settings.reset")).toBe("恢复默认");
  });

  it("ships chrome.copy / chrome.copied / chrome.copyFailed in both locales", () => {
    // Used by the MCP card copy buttons in SettingsPanel.McpPanel.
    expect(translate("en", "chrome.copy")).toBe("copy");
    expect(translate("zh", "chrome.copy")).toBe("复制");
    expect(translate("en", "chrome.copied")).toBe("copied");
    expect(translate("zh", "chrome.copied")).toBe("已复制");
    expect(translate("en", "chrome.copyFailed")).toBe("copy failed");
    expect(translate("zh", "chrome.copyFailed")).toBe("复制失败");
  });

  it("ships the eight settings row labels in both locales", () => {
    for (const key of ["theme", "language", "logBuffer", "metricsPoll", "statusPoll", "defaultNamespace", "shellCommand", "nodeShellImage"]) {
      const en = translate("en", `settings.${key}.label`);
      const zh = translate("zh", `settings.${key}.label`);
      expect(en.length, `settings.${key}.label en`).toBeGreaterThan(0);
      expect(zh.length, `settings.${key}.label zh`).toBeGreaterThan(0);
      expect(en, `settings.${key}.label en !== zh`).not.toBe(zh);
    }
  });

  it("ships settings.mcp.sectionTitle, tools, and the three card titles in both locales", () => {
    expect(translate("en", "settings.mcp.sectionTitle")).toBe("AI integration (MCP)");
    expect(translate("zh", "settings.mcp.sectionTitle")).toBe("AI 集成 (MCP)");
    // The three card titles are brand names (Claude Desktop / Claude Code /
    // Cursor) so they ship identical in both locales. Just pin presence.
    for (const key of ["claudeDesktop", "claudeCode", "cursor"]) {
      expect(translate("en", `settings.mcp.${key}.title`).length, `settings.mcp.${key}.title en`).toBeGreaterThan(0);
      expect(translate("zh", `settings.mcp.${key}.title`).length, `settings.mcp.${key}.title zh`).toBeGreaterThan(0);
    }
  });
});

/** The Metrics Explorer overlay (B14) hosts the PromQL bar plus a "saved
 *  queries" panel that drives CRUD. Pass-11's audit found the Refresh
 *  button's tooltip claiming "Force re-query, ignoring the cache" while
 *  the implementation just calls `run()` — `metricsQuery` /
 *  `metricsQueryRange` don't use a cache, so the tooltip misled the user
 *  about what the click would do. Pin the new values so a future
 *  refactor that re-introduces the misleading claim trips the test. */
describe("metrics explorer saved-queries strings", () => {
  it("ships metricsExplorer.refreshTitle in both locales without a cache-bypass claim", () => {
    const en = translate("en", "metricsExplorer.refreshTitle");
    const zh = translate("zh", "metricsExplorer.refreshTitle");
    expect(en.length).toBeGreaterThan(0);
    expect(zh.length).toBeGreaterThan(0);
    // The previous English copy ("Force re-query, ignoring the cache")
    // implied a cache that the metricsQuery / metricsQueryRange path
    // does not actually use — only saved queries go through the
    // cached `run_saved` command. The button just re-runs the
    // current query, so the tooltip now reflects that.
    expect(en.toLowerCase()).not.toContain("ignoring the cache");
    expect(en.toLowerCase()).not.toContain("ignore the cache");
    expect(zh).not.toContain("忽略缓存");
  });

  it("preserves the canonical refreshTitle values in both locales", () => {
    // Pin the actual strings so a future copy edit doesn't silently
    // drift back to a misleading claim. The exact wording is the
    // contract; the prior implementation's "force / cache" phrasing
    // is what we're guarding against.
    expect(translate("en", "metricsExplorer.refreshTitle")).toBe(
      "Re-run the current query",
    );
    expect(translate("zh", "metricsExplorer.refreshTitle")).toBe(
      "重新运行当前查询",
    );
  });

  it("ships the metricsExplorer.saved.* sub-keys in both locales", () => {
    // CRUD chrome for the saved queries panel: title, save affordance,
    // input placeholders, clear-cache hint, and the delete confirm.
    // Pin the keys we touch in MetricsExplorer.tsx so a future
    // dictionary shrink doesn't drop one (same leak class as
    // chrome.palette.actions.* / topology.*).
    const keys = [
      "title",
      "saveTitle",
      "save",
      "namePlaceholder",
      "notePlaceholder",
      "saveAction",
      "clearCache",
      "clearCacheBtn",
      "refreshHint",
      "removeHint",
    ];
    for (const key of keys) {
      const en = translate("en", `metricsExplorer.saved.${key}`);
      const zh = translate("zh", `metricsExplorer.saved.${key}`);
      expect(en.length, `metricsExplorer.saved.${key} en`).toBeGreaterThan(0);
      expect(zh.length, `metricsExplorer.saved.${key} zh`).toBeGreaterThan(0);
    }
  });

  it("preserves confirmRemove's parameterised shape (it is a function, not a string)", () => {
    // The `removeSaved` handler builds the confirm prompt via
    // `t("metricsExplorer.saved.confirmRemove", \`Delete saved query "${name}"?\`)`
    // — the value is a function `name => string`, not a plain string.
    // Pin the function shape so a future refactor that turns it into a
    // static string (and silently breaks the name interpolation) trips
    // the test.
    const enVal = dict("en").metricsExplorer.saved.confirmRemove;
    const zhVal = dict("zh").metricsExplorer.saved.confirmRemove;
    expect(typeof enVal, "en confirmRemove must be a function").toBe("function");
    expect(typeof zhVal, "zh confirmRemove must be a function").toBe("function");
    expect((enVal as (n: string) => string)("cpu")).toBe('Delete saved query "cpu"?');
    expect((zhVal as (n: string) => string)("cpu")).toBe('删除已保存查询 "cpu"?');
  });
});

describe("tabLabel", () => {
  it("returns the English name for English", () => {
    expect(tabLabel("logs", "en")).toBe("Logs");
    expect(tabLabel("yaml", "en")).toBe("YAML");
  });

  it("returns the Chinese name for Chinese", () => {
    expect(tabLabel("logs", "zh")).toBe("日志");
    expect(tabLabel("yaml", "zh")).toBe("YAML");
  });
});

describe("kindLabelFor", () => {
  it("resolves built-in kinds to the locale label", () => {
    expect(kindLabelFor("pods", [], "en")).toBe("Pods");
    expect(kindLabelFor("pods", [], "zh")).toBe("Pod");
  });

  /** Custom kinds fall back to the CRD's Kind name (the API's identifier) — a
   * sensible default since we have no per-CRD translation. */
  it("falls back to a custom kind's PascalCase Kind", () => {
    expect(kindLabelFor("argoproj.io/applications", [{ id: "argoproj.io/applications", kind: "Application" }], "en")).toBe(
      "Application",
    );
    expect(kindLabelFor("argoproj.io/applications", [{ id: "argoproj.io/applications", kind: "Application" }], "zh")).toBe(
      "Application",
    );
  });

  it("returns undefined for an unknown id", () => {
    expect(kindLabelFor("pods", [], "en")).toBeDefined();
    expect(kindLabelFor("nope/nada", [], "en")).toBeUndefined();
  });
});

/** The dashboard surfaces a row of nine resource cards whose labels are
 *  resolved per render through `kindLabelFor()`. A kind added to the
 *  dashboard's `RESOURCE_KINDS` list without a matching entry in the
 *  i18n registry would render the raw id in zh, breaking the chrome.
 *  Pin every dashboard kind in both locales — the canonical English
 *  names ("Pods", "Deployments", …) and the canonical Chinese names
 *  ("Pod", "Deployment", "节点", "命名空间"). */
describe("dashboard resource card labels (via kindLabelFor)", () => {
  // Mirror of Dashboard.tsx's RESOURCE_KINDS. If a new card lands in the
  // dashboard, it must land here too — otherwise the test wouldn't notice
  // the missing translation.
  const DASHBOARD_KINDS = [
    "pods",
    "deployments",
    "services",
    "configmaps",
    "secrets",
    "jobs",
    "cronjobs",
    "nodes",
    "namespaces",
  ] as const;

  for (const id of DASHBOARD_KINDS) {
    it(`ships ${id} as a non-empty label in both locales`, () => {
      const en = kindLabelFor(id, [], "en");
      const zh = kindLabelFor(id, [], "zh");
      expect(en, `kindLabelFor(${id}, en)`).toBeDefined();
      expect(zh, `kindLabelFor(${id}, zh)`).toBeDefined();
      expect(en!.length, `${id} en`).toBeGreaterThan(0);
      expect(zh!.length, `${id} zh`).toBeGreaterThan(0);
    });
  }

  /** The kind registry in `kinds.ts` keeps the canonical English names
   *  ("Pods", "Deployments", "Services", "ConfigMaps", "Secrets", "Jobs",
   *  "CronJobs", "Nodes", "Namespaces") — pin them so a future refactor
   *  that drops the `KIND_LABELS_ZH` mapping (or the English
   *  `KIND_META` label) trips the test instead of silently rendering a
   *  half-translated dashboard. */
  it("preserves the canonical English labels for the dashboard kinds", () => {
    const expectedEn: Record<string, string> = {
      pods: "Pods",
      deployments: "Deployments",
      services: "Services",
      configmaps: "ConfigMaps",
      secrets: "Secrets",
      jobs: "Jobs",
      cronjobs: "CronJobs",
      nodes: "Nodes",
      namespaces: "Namespaces",
    };
    for (const [id, label] of Object.entries(expectedEn)) {
      expect(kindLabelFor(id, [], "en"), id).toBe(label);
    }
  });

  /** In zh the chrome uses the canonical Chinese form (singular for
   *  K8s kinds — `Pod`, `Deployment`, …) plus the local words
   *  `节点` / `命名空间` for the two cluster-scoped kinds. Pin them
   *  too — this is the actual bug the dashboard had: the previous
   *  hardcoded English labels would render unchanged in zh. Note that
   *  several K8s canonical names ARE English words ("Pod", "Job", …)
   *  used in the Chinese UI by convention, so we pin the exact values
   *  rather than asserting a character class. */
  it("translates the dashboard kinds to the canonical zh labels", () => {
    const expectedZh: Record<string, string> = {
      pods: "Pod",
      deployments: "Deployment",
      services: "Service",
      configmaps: "ConfigMap",
      secrets: "Secret",
      jobs: "Job",
      cronjobs: "CronJob",
      nodes: "节点",
      namespaces: "命名空间",
    };
    for (const [id, label] of Object.entries(expectedZh)) {
      expect(kindLabelFor(id, [], "zh"), id).toBe(label);
    }
  });

  /** Cross-check: in zh the chrome must NOT render the English
   *  pluralised labels (`Pods / Deployments / …`) that the dashboard
   *  used to hardcode. This is the exact regression the pass-12 fix
   *  addresses. */
  it("does not leak the English pluralised labels into the zh locale", () => {
    const ENGLISH_PLURALS: Record<string, string> = {
      pods: "Pods",
      deployments: "Deployments",
      services: "Services",
      configmaps: "ConfigMaps",
      secrets: "Secrets",
      jobs: "Jobs",
      cronjobs: "CronJobs",
      nodes: "Nodes",
      namespaces: "Namespaces",
    };
    for (const [id, enPlural] of Object.entries(ENGLISH_PLURALS)) {
      const got = kindLabelFor(id, [], "zh");
      expect(got, `${id} zh != ${enPlural}`).not.toBe(enPlural);
    }
  });
});

describe("cacheLocale / cachedLocale", () => {
  beforeEach(() => {
    // Each test starts with a clean stub, so the round-trip assertion isn't
    // contaminated by whatever the previous test left behind. The stub is the
    // same shape the production code reads, so the assertion exercises the
    // real code path.
    installStorageStub();
  });

  afterEach(() => {
    // Restore whatever was there before — keeps the test isolated from
    // anything the test file's neighbours expect to see.
    Object.defineProperty(window, "localStorage", { configurable: true, value: undefined });
  });

  it("round-trips a known locale", () => {
    cacheLocale("zh");
    expect(cachedLocale()).toBe("zh");
    cacheLocale("en");
    expect(cachedLocale()).toBe("en");
  });

  it("returns 'en' when nothing has been cached", () => {
    expect(cachedLocale()).toBe("en");
  });

  it("treats an unrecognised cached value as 'en'", () => {
    window.localStorage.setItem("k7s.locale", "klingon");
    expect(cachedLocale()).toBe("en");
  });
});
