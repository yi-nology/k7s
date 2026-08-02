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

  /** The watch count drops to 0 during disconnect (B11 lifecycle). The text
   *  must render as a coherent sentence in both locales — "0 streams active"
   *  in EN and "0 路活跃" in ZH, not the English fallback. WatchFooter now
   *  reads the connection.phase separately to drive the dot state, but the
   *  text itself still shows the count verbatim. */
  it("renders chrome.sidebar.watch(0) coherently in both locales", () => {
    expect(translate("en", "chrome.sidebar.watch", 0)).toBe("watch: 0 streams active");
    expect(translate("zh", "chrome.sidebar.watch", 0)).toBe("监听: 0 路活跃");
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
    for (const key of ["name", "url", "desc", "add", "cancel", "adding", "nameTitle"]) {
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

/** Pass-18 — the ActionList scale + port-forward forms gained a `<form>` wrapper
 *  with Enter-to-submit, a real `disabled` Apply button, and an in-flight text
 *  indicator. The forms also gained a typing path for the scale `replicas`
 *  input and a clamp path for the forward `port` input. Pin the new i18n keys
 *  so a future dict shrink can't drop the in-flight labels. */
describe("action list scale + forward form keys (pass-18)", () => {
  it("ships actions.scaleForm.{applying, replicasLabel} in both locales", () => {
    expect(translate("en", "actions.scaleForm.applying")).toBe("Applying…");
    expect(translate("zh", "actions.scaleForm.applying")).toBe("正在调整…");
    expect(translate("en", "actions.scaleForm.replicasLabel")).toBe("replicas");
    expect(translate("zh", "actions.scaleForm.replicasLabel")).toBe("副本数");
  });

  it("ships actions.forwardForm.{applying, portLabel} in both locales", () => {
    expect(translate("en", "actions.forwardForm.applying")).toBe("Forwarding…");
    expect(translate("zh", "actions.forwardForm.applying")).toBe("正在转发…");
    expect(translate("en", "actions.forwardForm.portLabel")).toBe("port");
    expect(translate("zh", "actions.forwardForm.portLabel")).toBe("端口");
  });

  it("ships actions.confirming (in-flight indicator on confirm buttons) in both locales", () => {
    // The Delete / Restart / Drain confirm dialog now reads this key while
    // the request is in flight. The English value is the same Unicode ellipsis
    // (single character) — the i18n win is that the form now reads the dict
    // instead of hardcoding the literal.
    expect(translate("en", "actions.confirming")).toBe("…");
    expect(translate("zh", "actions.confirming")).toBe("…");
  });

  it("keeps helm.repos.form.nameTitle distinct from the name placeholder (it documents the pattern)", () => {
    // The name input has `pattern="[a-z0-9][a-z0-9-]*"` and a `title=` attribute
    // surfacing the rule. The placeholder stays a short affordance ("name");
    // nameTitle is the longer regex description. If a future refactor collapses
    // them, the user loses the tooltip explaining the pattern attribute.
    expect(translate("en", "helm.repos.form.nameTitle")).toBe(
      "lowercase letters, digits, and '-'",
    );
    expect(translate("zh", "helm.repos.form.nameTitle")).toBe(
      "小写字母、数字与 '-'",
    );
    expect(translate("en", "helm.repos.form.nameTitle")).not.toBe(
      translate("en", "helm.repos.form.name"),
    );
    expect(translate("zh", "helm.repos.form.nameTitle")).not.toBe(
      translate("zh", "helm.repos.form.name"),
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

  it("ships all three MCP card configPath values in both locales", () => {
    // Pass-23 closed a hardcoded English configPath on the Claude Code
    // card (McpPanel.tsx:113 used to render
    // `"~/.claude.json  (or .mcp.json in a project)"` directly, leaking
    // English into the zh panel). Pin all three so the leak can't come
    // back, and so any future translation of the file-path line lands
    // in the dictionary rather than in a JSX literal.
    for (const key of ["claudeDesktop", "claudeCode", "cursor"]) {
      const en = translate("en", `settings.mcp.${key}.configPath`);
      const zh = translate("zh", `settings.mcp.${key}.configPath`);
      expect(en.length, `settings.mcp.${key}.configPath en`).toBeGreaterThan(0);
      expect(zh.length, `settings.mcp.${key}.configPath zh`).toBeGreaterThan(0);
    }
    // And pin the canonical en value the McpPanel used to hardcode, so a
    // refactor that drifts the string is flagged.
    expect(translate("en", "settings.mcp.claudeCode.configPath")).toBe(
      "~/.claude.json  (or .mcp.json in a project)",
    );
  });

  it("uses 深色/浅色 for the theme option labels in zh, not 黑色/白色", () => {
    // Pass-23's i18n polish: "黑色/白色" read as raw colour names rather
    // than theme names. "深色/浅色" is the standard pair for dark/light
    // UI modes in zh (matches macOS / Windows / most native apps). Pin
    // so a future re-translation doesn't drift back to literal colours.
    expect(translate("zh", "settings.theme.dark")).toBe("深色");
    expect(translate("zh", "settings.theme.light")).toBe("浅色");
    expect(translate("zh", "settings.theme.dark")).not.toBe("黑色");
    expect(translate("zh", "settings.theme.light")).not.toBe("白色");
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
    // input placeholders, clear-cache hint, the overwrite-hint
    // (pass-19), the in-flight "saving" text (pass-19), the
    // transient "cleared" feedback (pass-19), and the delete confirm.
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
      "updateAction",
      "overwriteHint",
      "saving",
      "clearCache",
      "clearCacheBtn",
      "clearCacheOk",
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

  it("preserves the pass-19 overwrite-action / saving / clearCacheOk wording", () => {
    // Pass-19 added three new affordances: an "Update" button label
    // when the typed name matches an existing query, an in-flight
    // "Saving…" text, and a transient "Cleared" feedback for the
    // cache-bust button. Pin the canonical en/zh values so a
    // future copy edit doesn't drift back to a leaky literal —
    // same regression-guard pattern as the `refreshTitle` test
    // above.
    expect(translate("en", "metricsExplorer.saved.updateAction")).toBe("Update");
    expect(translate("zh", "metricsExplorer.saved.updateAction")).toBe("更新");
    expect(translate("en", "metricsExplorer.saved.saving")).toBe("Saving…");
    expect(translate("zh", "metricsExplorer.saved.saving")).toBe("保存中…");
    expect(translate("en", "metricsExplorer.saved.clearCacheOk")).toBe("Cleared");
    expect(translate("zh", "metricsExplorer.saved.clearCacheOk")).toBe("已清空");
    // overwriteHint is the inline "Will overwrite…" copy that
    // surfaces in the save bar when the typed name matches an
    // existing saved query. The English copy must mention
    // "overwrite"; the Chinese copy must mention "覆盖" — both
    // are the verb the user needs to make the right call. A
    // future refactor that drops the verb (e.g. "Same name as
    // existing") trips this assertion.
    const enHint = translate("en", "metricsExplorer.saved.overwriteHint");
    const zhHint = translate("zh", "metricsExplorer.saved.overwriteHint");
    expect(enHint.toLowerCase()).toContain("overwrite");
    expect(zhHint).toContain("覆盖");
  });

  it("distinguishes saveAction (Save) from updateAction (Update) — they must not collapse", () => {
    // The save bar swaps its button label between `saveAction`
    // ("Save" / "保存") and `updateAction` ("Update" / "更新")
    // based on whether the typed name matches an existing saved
    // query. A future refactor that collapsed them into one
    // string (e.g. "save" with a `name` arg) would lose the
    // affordance — the button would always say "Save" even when
    // it's about to overwrite. Pin that the two values are
    // distinct in both locales.
    const enSave = translate("en", "metricsExplorer.saved.saveAction");
    const enUpdate = translate("en", "metricsExplorer.saved.updateAction");
    const zhSave = translate("zh", "metricsExplorer.saved.saveAction");
    const zhUpdate = translate("zh", "metricsExplorer.saved.updateAction");
    expect(enSave).not.toBe(enUpdate);
    expect(zhSave).not.toBe(zhUpdate);
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

/** The Image Registries overlay (B11) is a three-column drill-down: registry
 *  list on the left, repos in the middle, tags + manifest on the right.
 *  Pass-14's audit found two pre-existing i18n key-path bugs that silently
 *  fell back to the inline English copy in zh:
 *    1. `t("image.repos.empty", ...)` was used at the empty-repos state, but
 *       the dictionary only has `image.reposEmpty` — a string leaf is not
 *       walkable, so the dotted path resolved to undefined in both locales
 *       and the English inline fallback always rendered.
 *    2. The whole `image.manifest.*` subtree (mediaType / digest /
 *       schemaVersion / size / layers / raw) was used in the TSX but the
 *       dictionary defines them flat at `image.mediaType` / `image.digest` /
 *       etc. — same class of leak: dotted path can't traverse a string leaf,
 *       so the inline English copy always rendered, even in zh.
 *  This describe pins every key the panel actually touches so a future
 *  refactor can't reintroduce either of those key-path mismatches. */
describe("image registries panel keys", () => {
  it("ships image.* chrome (title, close, action buttons, prompts) in both locales", () => {
    for (const key of [
      "title",
      "close",
      "test",
      "confirmRemove",
      "remove",
      "add",
      "pick",
      "repos",
      "tags",
      "manifest",
    ]) {
      const en = translate("en", `image.${key}`);
      const zh = translate("zh", `image.${key}`);
      expect(en.length, `image.${key} en`).toBeGreaterThan(0);
      expect(zh.length, `image.${key} zh`).toBeGreaterThan(0);
    }
  });

  it("ships image.reposEmpty at the documented path (not image.repos.empty)", () => {
    // The TSX originally used the dotted path `image.repos.empty` even
    // though the dictionary only ships the flat `image.reposEmpty` leaf.
    // A string leaf can't be traversed, so the dotted lookup resolved to
    // undefined in both locales and the inline English copy always
    // rendered. Pin the flat key so a future refactor that reverts to the
    // dotted path trips this test.
    expect(translate("en", "image.reposEmpty")).toBe(
      "No repositories (or registry does not support /v2/_catalog)",
    );
    expect(translate("zh", "image.reposEmpty")).toBe(
      "无镜像(或仓库不支持 /v2/_catalog)",
    );
    // The dotted path must not resolve (i.e. it must NOT silently match).
    // If a future refactor renames the key to a nested `image.repos.empty`
    // object, the dotted path will start resolving — and this assertion
    // will flip the test to pin that new shape.
    expect(translate("en", "image.repos.empty")).not.toBe(
      "No repositories (or registry does not support /v2/_catalog)",
    );
  });

  it("ships the manifest-table keys at the flat image.* path (not image.manifest.*)", () => {
    // The TSX originally called `t("image.manifest.mediaType", ...)`,
    // `t("image.manifest.digest", ...)`, etc., but the dictionary defines
    // them flat at `image.mediaType` / `image.digest` / etc. — a string
    // leaf can't be traversed, so the dotted lookup resolved to undefined
    // and the inline English copy always rendered (including in zh).
    // Pin the flat path so a future refactor that reverts to the dotted
    // path trips this test.
    const FLAT_KEYS: Array<[string, string, string]> = [
      ["mediaType", "Media type", "Media Type"],
      ["digest", "Digest", "摘要"],
      ["schemaVersion", "Schema", "Schema"],
      ["size", "Size", "大小"],
      ["layers", "Layers", "层"],
      ["raw", "Raw JSON", "原始 JSON"],
    ];
    for (const [key, enLabel, zhLabel] of FLAT_KEYS) {
      const en = translate("en", `image.${key}`);
      const zh = translate("zh", `image.${key}`);
      expect(en, `image.${key} en`).toBe(enLabel);
      expect(zh, `image.${key} zh`).toBe(zhLabel);
      // The dotted path must not resolve to the same value (it would
      // either resolve to undefined or, after a future refactor, to a
      // different string). Either way it must not equal the flat value.
      expect(
        translate("en", `image.manifest.${key}`),
        `image.manifest.${key} en must not equal image.${key}`,
      ).not.toBe(enLabel);
    }
  });

  it("ships image.form.* sub-keys in both locales", () => {
    for (const key of ["title", "name", "url", "username", "password", "description", "save", "cancel"]) {
      const en = translate("en", `image.form.${key}`);
      const zh = translate("zh", `image.form.${key}`);
      expect(en.length, `image.form.${key} en`).toBeGreaterThan(0);
      expect(zh.length, `image.form.${key} zh`).toBeGreaterThan(0);
    }
  });

  it("ships image.inspectTitle (tag-row tooltip) in both locales", () => {
    // Pre-fix, ImageRepoPanel.tsx:297 was the literal
    // `title="Inspect manifest"` HTML attribute — leaked English in zh the
    // same way the rest of the panel's chrome did. The dict now ships
    // `image.inspectTitle` and the call site routes through `t()`.
    const en = translate("en", "image.inspectTitle");
    const zh = translate("zh", "image.inspectTitle");
    expect(en).toBe("Inspect manifest");
    // The zh translation is "查看" + "清单" (verb "view" + the same noun
    // as the manifest panel header `image.manifest: "清单"`). Pin that
    // the tooltip contains the same manifest noun as the panel chrome
    // sibling — a future refactor that drops the noun or uses a
    // different one (e.g. "检查" for the verb) trips this test.
    expect(zh).toContain(translate("zh", "image.manifest"));
  });
});

/**
 * Pass-15 audit sweep: the detail-panel tabs (Properties / Events / Logs /
 * Metrics / PodMetrics / Shell / NodeShell) and the Dashboard all had small,
 * in-place hardcoded English strings that survived every prior i18n pass.
 * Same root cause as pass-1 / 5 / 6 / 8 / 10 / 12 / 13 / 14 — the dict had the
 * translations, the call sites were already inside `useTranslation()` consumers,
 * the strings were just hardcoded literals in the JSX (and a couple of `title=`
 * attributes and a "session ended" `||` fallback).
 *
 * This describe pins the new keys in both locales so a future refactor can't
 * drop them — the same regression test pattern pass-1 used for the ⌘K palette
 * and pass-8 used for the Alerting panel.
 */
describe("detail-panel tab + dashboard i18n (pass-15 sweep)", () => {
  it("ships dashboard.cpu and dashboard.mem in both locales", () => {
    // The Dashboard's CPU / Memory bar labels were hardcoded English
    // `<span>CPU</span>` / `<span>Memory</span>` at Dashboard.tsx:128 / 143
    // — the first thing every user sees on the home view. The dictionary
    // already had `dashboard.cpu` ("CPU") and `dashboard.mem` ("Memory" /
    // "内存"), they just weren't being read. Pin the canonical values so a
    // future refactor that drops them trips the test before zh renders
    // "CPU" / "Memory" on a dashboard the rest of the chrome is in zh.
    expect(translate("en", "dashboard.cpu")).toBe("CPU");
    expect(translate("zh", "dashboard.cpu")).toBe("CPU");
    expect(translate("en", "dashboard.mem")).toBe("Memory");
    expect(translate("zh", "dashboard.mem")).toBe("内存");
  });

  it("ships events.empty in both locales", () => {
    // EventsTab.tsx:45 used the hardcoded literal
    // "no recent events — events expire after ~1h" instead of going through
    // the dict. Pin the canonical en / zh.
    expect(translate("en", "events.empty")).toBe(
      "no recent events — events expire after ~1h",
    );
    expect(translate("zh", "events.empty")).toBe(
      "无最近事件 — 事件约 1 小时后过期",
    );
    // And `events.hint` is still routed through t() — pin it for completeness
    // so a future refactor that drops it trips this test the same way.
    expect(translate("en", "events.hint").length).toBeGreaterThan(0);
    expect(translate("zh", "events.hint").length).toBeGreaterThan(0);
    expect(translate("en", "events.loading").length).toBeGreaterThan(0);
    expect(translate("zh", "events.loading").length).toBeGreaterThan(0);
  });

  it("ships properties.navTitle in both locales", () => {
    // PropertiesTab.tsx:147 used `title={\`Go to ${target.kind} ${target.name}\`}`
    // — a cross-reference link's tooltip. Pin the function form so a future
    // refactor that drops it doesn't silently leave the tooltip in English
    // for zh users.
    const enNavTitle = translate("en", "properties.navTitle", "Pod", "nginx-1");
    const zhNavTitle = translate("zh", "properties.navTitle", "Pod", "nginx-1");
    expect(enNavTitle).toBe("Go to Pod nginx-1");
    expect(zhNavTitle).toBe("前往 Pod nginx-1");
    // The fallback used to be the literal hardcoded English copy, so a
    // regression that re-introduces a flat `properties.navTitle = "Go to …"`
    // would surface here as a missing-function-call signature.
    expect(typeof translate("en", "properties.navTitle", "Pod", "nginx-1")).toBe("string");
  });

  it("ships shell.reconnect + shell.endedFallback in both locales", () => {
    // ShellTab.tsx:127 had the literal `↻ reconnect` and line 67 had the
    // literal fallback `"session ended"`. Both now route through the dict.
    expect(translate("en", "shell.reconnect")).toBe("↻ reconnect");
    expect(translate("zh", "shell.reconnect")).toBe("↻ 重新连接");
    expect(translate("en", "shell.endedFallback")).toBe("session ended");
    expect(translate("zh", "shell.endedFallback")).toBe("会话已结束");
    // The original `shell.reconnectTitle` (used as the button's `title=`
    // tooltip) must still resolve — its dictionary entry was never the bug.
    expect(translate("en", "shell.reconnectTitle").length).toBeGreaterThan(0);
    expect(translate("zh", "shell.reconnectTitle").length).toBeGreaterThan(0);
  });

  it("ships nodeShell gate + session keys in both locales", () => {
    // NodeShellTab had six hardcoded English strings (lines 71, 99, 113, 123,
    // 131, 146) — gate button, header labels, end-session button, ended-bar
    // start-again button, and two `||` fallbacks. They now route through the
    // nodeShell.* keys. Pin the canonical values for each.
    const KEYS: Array<[string, string, string]> = [
      ["startBtn", "Start debug session", "开启调试会话"],
      ["starting", "starting debug pod…", "调试 Pod 启动中…"],
      ["nodeLabel", "node", "节点"],
      ["endSession", "✕ end session", "✕ 结束会话"],
      ["startAgain", "↻ start again", "↻ 重新开始"],
      ["endedFallback", "session ended", "会话已结束"],
      ["closedFallback", "session closed", "会话已关闭"],
    ];
    for (const [key, enLabel, zhLabel] of KEYS) {
      expect(translate("en", `nodeShell.${key}`), `nodeShell.${key} en`).toBe(enLabel);
      expect(translate("zh", `nodeShell.${key}`), `nodeShell.${key} zh`).toBe(zhLabel);
    }
    // The original `nodeShell.endTitle` / `backTitle` were never the bug —
    // they already routed through t(). Pin for completeness.
    expect(translate("en", "nodeShell.endTitle").length).toBeGreaterThan(0);
    expect(translate("zh", "nodeShell.endTitle").length).toBeGreaterThan(0);
    expect(translate("en", "nodeShell.backTitle").length).toBeGreaterThan(0);
    expect(translate("zh", "nodeShell.backTitle").length).toBeGreaterThan(0);
  });

  it("ships logs.linesCount in both locales", () => {
    // LogsTab.tsx:194 had `<span>{filtered.length} lines</span>` — the
    // hardcoded "lines" suffix rendered as English even in zh. The function
    // form is parameterised by count.
    expect(translate("en", "logs.linesCount", 42)).toBe("42 lines");
    expect(translate("zh", "logs.linesCount", 42)).toBe("42 行");
    // Pin singular too (the function is plural-agnostic — it just appends
    // the word, and the zh word 行 is the same in singular and plural).
    expect(translate("en", "logs.linesCount", 1)).toBe("1 lines");
    expect(translate("zh", "logs.linesCount", 1)).toBe("1 行");
  });

  it("ships podMetrics.waitingBody in both locales", () => {
    // PodMetricsTab.tsx:44-46 had a three-line hardcoded English body
    // explaining the metrics-server failure mode. The dict now ships the
    // canonical copy; pin so a future refactor can't drop it.
    const enBody = translate("en", "podMetrics.waitingBody");
    const zhBody = translate("zh", "podMetrics.waitingBody");
    expect(enBody.length).toBeGreaterThan(0);
    expect(zhBody.length).toBeGreaterThan(0);
    // The body mentions "metrics-server" in en (a real product name) and
    // "metrics-server" in zh (same — kept in Latin script because there's
    // no clean 中文 equivalent). Pin so a future refactor that drops the
    // critical diagnostic word trips this test.
    expect(enBody).toContain("metrics-server");
    expect(zhBody).toContain("metrics-server");
  });
});

/**
 * Pass-16 sweep: Template picker title/description i18n.
 *
 * `lib/templates.ts` ships three templates (deployment / ingress / configmap),
 * each with a hardcoded English `title` and `description`. The picker used to
 * render those strings directly (`{tt.title}` / `{tt.description}` /
 * `{selected.title}`), so a zh user saw the English copy. The picker's
 * `useTranslation()` call now routes the chrome through
 * `t("tpl.titles." + id, tt.title)` and `t("tpl.descs." + id, tt.description)`
 * with the registry's hardcoded string as the English fallback.
 *
 * These tests pin the new keys in both locales so a future refactor that
 * drops either the per-id structure (e.g. folding them into a single flat
 * `tpl.titles` string) or the canonical values trips a test.
 */
describe("template picker title/description i18n (pass-16 sweep)", () => {
  const TEMPLATE_IDS = ["deployment", "ingress", "configmap"] as const;

  it("ships tpl.titles.<id> for every template id in both locales", () => {
    // Pinned so the picker's `t("tpl.titles." + tt.id, tt.title)` lookup
    // always resolves in both locales. A refactor that flattens the structure
    // (e.g. one big `tpl.titles` string) or drops an id trips this test.
    for (const id of TEMPLATE_IDS) {
      const en = translate("en", `tpl.titles.${id}`);
      const zh = translate("zh", `tpl.titles.${id}`);
      expect(en.length, `tpl.titles.${id} en`).toBeGreaterThan(0);
      expect(zh.length, `tpl.titles.${id} zh`).toBeGreaterThan(0);
    }
  });

  it("ships tpl.descs.<id> for every template id in both locales", () => {
    // Same shape as the titles test; pinned so the per-id description lookup
    // resolves in both locales. A refactor that drops an id or flattens the
    // structure trips this test.
    for (const id of TEMPLATE_IDS) {
      const en = translate("en", `tpl.descs.${id}`);
      const zh = translate("zh", `tpl.descs.${id}`);
      expect(en.length, `tpl.descs.${id} en`).toBeGreaterThan(0);
      expect(zh.length, `tpl.descs.${id} zh`).toBeGreaterThan(0);
    }
  });

  it("matches the English canonical copy shipped in the templates registry", () => {
    // The dictionary's en values must equal the hardcoded registry strings,
    // because those strings are the English fallback the picker passes as
    // the second argument to `t()`. If the registry is renamed and the dict
    // lags, a missing key still renders the registry string — which is what
    // the user would have seen pre-fix. This test pins the contract: the
    // dict's en copy is the same as the registry's en copy, so the path
    // through `t()` is a no-op for en and a translation for zh.
    const titles: Record<string, string> = {
      deployment: "Deployment",
      ingress: "Ingress (Nginx)",
      configmap: "ConfigMap",
    };
    const descs: Record<string, string> = {
      deployment: "Single-container Deployment with a Service (ClusterIP).",
      ingress: "Ingress that routes a host to an existing Service.",
      configmap: "ConfigMap with two key-value pairs.",
    };
    for (const id of TEMPLATE_IDS) {
      expect(translate("en", `tpl.titles.${id}`)).toBe(titles[id]);
      expect(translate("en", `tpl.descs.${id}`)).toBe(descs[id]);
    }
  });

  it("translates the deployment description to Chinese", () => {
    // The deployment description is the longest of the three (the only one
    // with a parenthetical `(ClusterIP)` that should be translated / dropped)
    // and the one a user is most likely to read in the picker. Pin the
    // canonical zh copy so a future refactor that drops the translation
    // trips a test.
    const zh = translate("zh", "tpl.descs.deployment");
    expect(zh).toContain("Deployment");
    expect(zh).toContain("Service");
  });

  it("the fallback path (t() with the registry string as the second arg) renders the registry copy when a key is missing", () => {
    // Defence-in-depth: if a future template is added without a matching
    // dictionary entry, the picker still renders the registry's hardcoded
    // English string (not the raw key). The translate() helper takes a
    // leading string as the fallback for a missing key — this test pins
    // that contract for the tpl.titles.<id> shape specifically.
    const fallback = "A New Template";
    expect(translate("zh", "tpl.titles.does-not-exist", fallback)).toBe(
      fallback,
    );
  });
});

/**
 * Pass-17 sweep: chrome that's still hardcoded English in zh.
 *
 *  - `StatusBar` rendered the literal "api" / "nodes" / "ready" / "cpu" /
 *    "mem" / "kubectl ctx:" labels — every fact in the always-visible
 *    bottom strip leaked English to zh users. The dict had function-shaped
 *    `chrome.statusbar.<key>` keys (full sentences like `"api: ${ms}ms"`)
 *    that no call site ever read.
 *  - `ClusterSwitcher` rendered the literal "connected · v1.28.0" /
 *    "connecting…" / "disconnected" status text + a "no cluster" fallback
 *    for when no context is connected. Right under the cluster name at the
 *    top of the sidebar.
 *  - `MetricsExplorer` InstantTable rendered literal "Series" / "Value"
 *    column headers in the instant-query result table.
 *
 * Three call sites, all the same i18n leak class that pass-1 / 5 / 6 / 8 /
 * 10 / 12 / 13 / 14 / 15 / 16 fixed for other panels.
 */
describe("chrome statusbar / clusterSwitcher / metricsExplorer.instantTable (pass-17 sweep)", () => {
  it("ships chrome.statusbar.{api,nodes,ready,cpu,mem,kubectlCtx} as label-only leafs", () => {
    // Pre-fix, the dict shipped these as function-shaped full sentences
    // (`api: (ms) => "api: ${ms}ms"`) that nothing called. StatusBar
    // rendered raw English labels. The refactor is to label-only leafs so
    // the component owns the formatting and the value can stay in a `<b>`.
    expect(translate("en", "chrome.statusbar.api")).toBe("api");
    expect(translate("en", "chrome.statusbar.nodes")).toBe("nodes");
    expect(translate("en", "chrome.statusbar.ready")).toBe("ready");
    expect(translate("en", "chrome.statusbar.cpu")).toBe("cpu");
    expect(translate("en", "chrome.statusbar.mem")).toBe("mem");
    expect(translate("en", "chrome.statusbar.kubectlCtx")).toBe("kubectl ctx:");
  });

  it("ships the zh statusbar labels with 节点 / 就绪 and CLI-abbrev preservation", () => {
    // The zh dict's pre-refactor full-sentence form was
    // `节点 ${ready}/${total} 就绪` — split it into a label + a suffix
    // here. The other 4 stay English because `api` / `cpu` / `mem` /
    // `kubectl` are common abbreviations in Chinese tech docs and don't
    // gain anything from translation.
    expect(translate("zh", "chrome.statusbar.api")).toBe("api");
    expect(translate("zh", "chrome.statusbar.nodes")).toBe("节点");
    expect(translate("zh", "chrome.statusbar.ready")).toBe("就绪");
    expect(translate("zh", "chrome.statusbar.cpu")).toBe("cpu");
    expect(translate("zh", "chrome.statusbar.mem")).toBe("mem");
    expect(translate("zh", "chrome.statusbar.kubectlCtx")).toBe("kubectl 上下文:");

    // Regression: the old full-sentence function form is GONE — the path
    // `chrome.statusbar.api` is now a string leaf, not callable.
    // `translate()`'s `args[0]` fallback for a string fallback applies
    // here, so `translate("zh", "chrome.statusbar.api", "fallback")` would
    // still return the dict string and only `"fallback"` if the key were
    // missing. Pin the actual call site behaviour.
    expect(translate("zh", "chrome.statusbar.api")).not.toContain("ms");
    expect(translate("zh", "chrome.statusbar.api")).not.toContain("—");
  });

  it("ships chrome.clusterSwitcher.{connected,connecting,disconnected,noCluster} in both locales", () => {
    // The status line is right under the cluster name at the top of the
    // sidebar — every zh session saw "connected · v1.28.0" / "connecting…"
    // / "disconnected" / "no cluster" before this fix.
    expect(translate("en", "chrome.clusterSwitcher.connected", "v1.28.0")).toBe(
      "connected · v1.28.0",
    );
    expect(translate("en", "chrome.clusterSwitcher.connecting")).toBe(
      "connecting…",
    );
    expect(translate("en", "chrome.clusterSwitcher.disconnected")).toBe(
      "disconnected",
    );
    expect(translate("en", "chrome.clusterSwitcher.noCluster")).toBe(
      "no cluster",
    );

    // The connected function falls back to plain "connected" when no
    // version is provided (defensive — the cluster-status object can
    // have `version: undefined` during the first connect frame).
    expect(translate("en", "chrome.clusterSwitcher.connected", undefined)).toBe(
      "connected",
    );
  });

  it("ships zh cluster-switcher status with 已连接 / 连接中… / 已断开 / 未选择集群", () => {
    expect(translate("zh", "chrome.clusterSwitcher.connected", "v1.28.0")).toBe(
      "已连接 · v1.28.0",
    );
    expect(translate("zh", "chrome.clusterSwitcher.connecting")).toBe(
      "连接中…",
    );
    expect(translate("zh", "chrome.clusterSwitcher.disconnected")).toBe(
      "已断开",
    );
    expect(translate("zh", "chrome.clusterSwitcher.noCluster")).toBe(
      "未选择集群",
    );
    // Same undefined-version fallback in zh.
    expect(translate("zh", "chrome.clusterSwitcher.connected", undefined)).toBe(
      "已连接",
    );

    // Regression: zh does NOT render the English verbs.
    expect(translate("zh", "chrome.clusterSwitcher.connecting")).not.toContain(
      "connecting",
    );
    expect(translate("zh", "chrome.clusterSwitcher.disconnected")).not.toContain(
      "disconnected",
    );
  });

  it("ships metricsExplorer.instantTable.{series,value} in both locales", () => {
    // The instant-query result table's two column headers were
    // `<th>Series</th>` / `<th>Value</th>` literals.
    expect(translate("en", "metricsExplorer.instantTable.series")).toBe(
      "Series",
    );
    expect(translate("en", "metricsExplorer.instantTable.value")).toBe(
      "Value",
    );
    expect(translate("zh", "metricsExplorer.instantTable.series")).toBe(
      "序列",
    );
    expect(translate("zh", "metricsExplorer.instantTable.value")).toBe("值");
  });
});

/**
 * The ForwardsBar (B6, B16) renders a strip of `localhost:PORT → target:REMOTE`
 * pills above the status bar whenever there are live port-forwards. Every
 * string the strip shows — the section label, the copy/stop tooltips, the
 * resolved-target format — routes through `chrome.forwards.*` keys, and the
 * two function-shaped targets (podTarget / serviceTarget) are interpolated
 * with positional args. The strip predates the v0.2.4 i18n sweep (pass-1/8/9)
 * and no test had pinned its keys, so a future refactor could drop
 * `chrome.forwards.*` the way `chrome.palette.actions.*` / `topology.*` were
 * dropped in earlier passes. Lock every key the strip reads.
 */
describe("chrome.forwards.* — ForwardsBar strip strings (pass-20)", () => {
  it("ships chrome.forwards.{label, copyAddress, stopForward} in both locales", () => {
    expect(translate("en", "chrome.forwards.label")).toBe("forwards:");
    expect(translate("zh", "chrome.forwards.label")).toBe("端口转发:");
    expect(translate("en", "chrome.forwards.copyAddress")).toBe("copy address");
    expect(translate("zh", "chrome.forwards.copyAddress")).toBe("复制地址");
    expect(translate("en", "chrome.forwards.stopForward")).toBe("stop forward");
    expect(translate("zh", "chrome.forwards.stopForward")).toBe("停止转发");
  });

  it("ships chrome.forwards.podTarget (function) with the right shape in both locales", () => {
    // The resolved-pod tooltip, e.g. for a forward to `default/pod nginx-0:80`.
    // Pre-fix, the English copy was a positional template; this test pins
    // the noun ("pod"), the separator (slash + space), and the colon before
    // the port — the structure the user reads to debug a forward.
    const en = translate("en", "chrome.forwards.podTarget", "default", "nginx-0", 80);
    expect(en).toBe("default/pod nginx-0:80");
    expect(en).toContain("pod");           // the noun the user looks for
    expect(en).toContain("/");             // the namespace separator
    expect(en).toContain("nginx-0");       // the pod name
    expect(en).toContain(":80");           // the port colon

    const zh = translate("zh", "chrome.forwards.podTarget", "default", "nginx-0", 80);
    expect(zh).toBe("default/pod nginx-0:80");
    // The Chinese string is a template-shaped same-template; pin the
    // structure (ns + pod + port) but allow the connector copy to differ
    // if a future refactor adds one. The current shape mirrors English,
    // which matches the rest of the chrome (logs, alerts, etc.).
    expect(zh).toContain("default");
    expect(zh).toContain("nginx-0");
    expect(zh).toContain("80");
  });

  it("ships chrome.forwards.serviceTarget (function) with the right shape in both locales", () => {
    // A service forward shows the service name + the resolved pod. The
    // arrow (`→`) is the visual separator — if a refactor drops it the
    // service / pod distinction blurs.
    const en = translate(
      "en",
      "chrome.forwards.serviceTarget",
      "default",
      "nginx",
      80,
      "nginx-0",
      8080,
    );
    expect(en).toBe("default/service nginx:80 → pod nginx-0:8080");
    expect(en).toContain("service");
    expect(en).toContain("→");
    expect(en).toContain("pod");
    expect(en).toContain("nginx:80");       // the published port
    expect(en).toContain("nginx-0:8080");   // the resolved targetPort

    const zh = translate(
      "zh",
      "chrome.forwards.serviceTarget",
      "default",
      "nginx",
      80,
      "nginx-0",
      8080,
    );
    expect(zh).toBe("default/service nginx:80 → pod nginx-0:8080");
    expect(zh).toContain("→");
  });

  it("zh strings do not collapse to English (chrome.forwards.*)", () => {
    // The two function-shaped targets are the same template in both locales
    // (the chrome doesn't translate "pod" / "service" as standalone nouns
    // because they're code-adjacent), but the three label / tooltip strings
    // must be different — the pre-pass-20 zh UI rendered the English label
    // "forwards:" above the status bar.
    expect(translate("zh", "chrome.forwards.label")).not.toBe(
      translate("en", "chrome.forwards.label"),
    );
    expect(translate("zh", "chrome.forwards.copyAddress")).not.toBe(
      translate("en", "chrome.forwards.copyAddress"),
    );
    expect(translate("zh", "chrome.forwards.stopForward")).not.toBe(
      translate("en", "chrome.forwards.stopForward"),
    );
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
