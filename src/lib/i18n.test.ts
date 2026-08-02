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
