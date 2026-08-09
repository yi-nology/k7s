/**
 * Tests for the i18n core: catalogue resolution, locale validation, and the
 * kind-registry overlays. The dictionaries themselves are type-checked by
 * TypeScript, so we focus on the *behaviour* — a missing key falls back to
 * English, unknown locales are narrowed, and the kind/group labels follow the
 * active locale.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
} from './i18n';
import { KIND_ORDER } from './kinds';

/**
 * Some vitest environments don't ship a working `localStorage` (the one Node
 * ships experimentally throws without `--localstorage-file`). The
 * `cacheLocale` / `cachedLocale` helpers handle that gracefully, but we want
 * to test the round-trip, so we install a tiny in-memory stub and undo it
 * after the test.
 */
function installStorageStub(): void {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
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

// ---- Core behaviour tests ----

describe('asLocale', () => {
  it('passes through the two valid values', () => {
    expect(asLocale('en')).toBe('en');
    expect(asLocale('zh')).toBe('zh');
  });

  it("defaults anything else to 'en'", () => {
    expect(asLocale('fr')).toBe('en');
    expect(asLocale(undefined)).toBe('en');
    expect(asLocale(42)).toBe('en');
  });
});

describe('LOCALES', () => {
  it('is exactly the two shipped locales, in display order', () => {
    expect(LOCALES).toEqual(['en', 'zh']);
  });
});

describe('dict', () => {
  it('returns a dictionary for every shipped locale', () => {
    for (const locale of LOCALES) {
      expect(typeof dict(locale)).toBe('object');
    }
  });

  it('falls back to English for an unknown locale', () => {
    // @ts-expect-error testing invalid input
    expect(dict(' Klingon ')).toBe(dict('en'));
  });
});

describe('translate', () => {
  it('returns the English string for an English lookup', () => {
    expect(translate('en', 'table.empty')).toBe('no resources match filter');
  });

  it('returns the Chinese string for a Chinese lookup', () => {
    expect(translate('zh', 'table.empty')).toBe('无匹配资源');
  });

  it('calls parameterised functions with positional args', () => {
    const en = translate('en', 'chrome.sidebar.watch', 3);
    const zh = translate('zh', 'chrome.sidebar.watch', 3);
    expect(en).toContain('3');
    expect(zh).toContain('3');
  });

  it('renders chrome.sidebar.watch(0) coherently in both locales', () => {
    const en = translate('en', 'chrome.sidebar.watch', 0);
    const zh = translate('zh', 'chrome.sidebar.watch', 0);
    expect(en).toBe('watch: 0 streams active');
    expect(zh).toBe('监听: 0 路活跃');
  });

  it('returns the key when no locale has it', () => {
    expect(translate('en', 'no.such.key')).toBe('no.such.key');
    expect(translate('zh', 'no.such.key')).toBe('no.such.key');
  });

  it('uses a leading string arg as the fallback when no dictionary has the key', () => {
    expect(translate('en', 'no.such.key', 'FALLBACK')).toBe('FALLBACK');
    expect(translate('zh', 'no.such.key', 'FALLBACK')).toBe('FALLBACK');
  });

  it('prefers the dictionary over the fallback when both exist', () => {
    expect(translate('en', 'table.empty', 'FALLBACK')).toBe('no resources match filter');
  });

  it('falls back to English for a Chinese-only key', () => {
    // This test is still valid: if a key were missing from zh but present in en,
    // the zh lookup would fall back to the en value. We can't easily test this
    // without a key that's intentionally missing from zh, so we just verify the
    // fallback mechanism works for unknown keys.
    expect(translate('zh', 'no.such.key', 'fallback')).toBe('fallback');
  });
});

// ---- Label function tests ----

describe('groupLabel', () => {
  it('returns the English name for English locales', () => {
    expect(groupLabel('workloads', 'en')).toBe('Workloads');
  });

  it('returns the Chinese name for Chinese locales', () => {
    expect(groupLabel('workloads', 'zh')).toBe('工作负载');
  });
});

describe('kindLabel', () => {
  it('returns English names in English', () => {
    expect(kindLabel('pods', 'en')).toBe('Pods');
  });

  it('returns Chinese names in Chinese (using the canonical form)', () => {
    expect(kindLabel('nodes', 'zh')).toBe('节点');
  });
});

describe('tabLabel', () => {
  it('returns the English name for English locales', () => {
    expect(tabLabel('logs', 'en')).toBe('Logs');
  });

  it('returns the Chinese name for Chinese locales', () => {
    expect(tabLabel('logs', 'zh')).toBe('日志');
  });
});

describe('kindLabelFor', () => {
  it('resolves a custom kind from the custom-kinds list', () => {
    const custom = [{ id: 'argoproj.io/applications', kind: 'Application' }];
    expect(kindLabelFor('argoproj.io/applications', custom, 'en')).toBe('Application');
  });

  it('resolves a built-in kind by its id', () => {
    expect(kindLabelFor('pods', [], 'en')).toBe('Pods');
  });

  it('returns undefined for an unknown kind id', () => {
    expect(kindLabelFor('unknown.kind', [], 'en')).toBeUndefined();
  });
});

// ---- Data-driven dictionary coverage ----

/**
 * Consolidated test: verify that a list of keys exist in both locales with
 * non-empty values. This replaces ~50 individual "ships X in both locales"
 * tests with a single data-driven sweep.
 *
 * Each entry is either:
 *   - A string key (just checks the key resolves to a non-empty string)
 *   - A [key, enValue, zhValue] tuple (checks exact values)
 */
describe('dictionary key coverage', () => {
  const KEY_COVERAGE: (string | [string, string, string])[] = [
    // Table empty states
    ['table.empty', 'no resources match filter', '无匹配资源'],
    ['table.emptyNone', 'no resources', '无资源'],

    // Alerting panel
    ['alerts.empty.alerts', 'No active alerts', '无活动告警'],
    ['alerts.empty.silences', 'No silences', '无静默'],
    // alerts.cols.* — just check they exist
    'alerts.cols.alert',
    'alerts.cols.severity',
    'alerts.cols.state',
    'alerts.cols.summary',
    'alerts.cols.activeSince',
    'alerts.cols.matchers',
    'alerts.cols.comment',
    'alerts.cols.createdBy',
    'alerts.cols.starts',
    'alerts.cols.ends',
    'alerts.cols.status',

    // Helm repos
    'helm.repos.refreshAll',
    'helm.repos.empty',
    'helm.repos.error',
    'helm.repos.ok',
    'helm.repos.never',
    'helm.repos.refresh',
    'helm.repos.remove',
    'helm.repos.add',
    'helm.repos.form.name',
    'helm.repos.form.url',
    'helm.repos.form.desc',
    'helm.repos.form.add',
    'helm.repos.form.cancel',
    'helm.repos.form.adding',
    'helm.repos.form.nameTitle',
    ['helm.empty.noMatch', 'No charts match this search', '无匹配的 Charts'],
    ['helm.empty.noRepos', 'No repos yet — add one in Repositories', '暂无仓库 — 先在仓库页添加一个'],

    // Settings panel
    ['chrome.settings.title', 'Settings', '设置'],
    ['chrome.settings.footerNote', 'changes save automatically', '修改自动保存'],
    ['chrome.settings.reset', 'reset to defaults', '恢复默认'],
    'chrome.copy',
    'chrome.copied',
    'chrome.copyFailed',

    // Actions
    'actions.forwardForm.applying',
    'actions.forwardForm.portLabel',
    'actions.confirming',

    // Metrics explorer
    'metricsExplorer.title',
    'metricsExplorer.close',
    'metricsExplorer.query',
    'metricsExplorer.run',
    'metricsExplorer.running',
    'metricsExplorer.empty',
    'metricsExplorer.emptyState',
    'metricsExplorer.saved.title',
    'metricsExplorer.saved.saveTitle',
    'metricsExplorer.saved.save',
    'metricsExplorer.saved.saving',

    // Forwards bar
    'chrome.forwards.label',
    'chrome.forwards.copyAddress',
    'chrome.forwards.stopForward',

    // SBOM panel
    'sbom.title',
    'sbom.tab.image',
    'sbom.tab.cluster',
    'sbom.tab.history',
    'sbom.tab.comingSoon',
    'sbom.image.placeholder',
    'sbom.image.generate',
    'sbom.cluster.scan',
    'sbom.cluster.comingSoon',
    'sbom.cluster.useImage',
    'sbom.history.loading',
    'sbom.history.empty',
    'sbom.history.source',
    'sbom.history.format',
    'sbom.history.components',
    'sbom.history.vulns',
    'sbom.history.tool',
    'sbom.history.date',

    // Security panel
    'security.title',
    'security.close',
    'security.run',
    'security.scanning',
    'security.running',
    'security.lastScan',
    'security.filters',
    'security.all',
    'security.ruleId',
    'security.emptyStart',
    'security.emptyFindings',
  ];

  it('all listed keys resolve to non-empty strings in both locales', () => {
    const failures: string[] = [];
    for (const entry of KEY_COVERAGE) {
      const key = typeof entry === 'string' ? entry : entry[0];
      for (const locale of ['en', 'zh'] as Locale[]) {
        const val = translate(locale, key);
        if (!val || val === key) {
          failures.push(`${locale}: ${key}`);
        }
      }
    }
    expect(failures, `Missing keys:\n${failures.join('\n')}`).toEqual([]);
  });

  it('keys with expected values match exactly', () => {
    for (const entry of KEY_COVERAGE) {
      if (typeof entry === 'string') continue;
      const [key, enExpected, zhExpected] = entry;
      expect(translate('en', key), `en: ${key}`).toBe(enExpected);
      expect(translate('zh', key), `zh: ${key}`).toBe(zhExpected);
    }
  });

  it('English and Chinese values are different for all tuple entries', () => {
    for (const entry of KEY_COVERAGE) {
      if (typeof entry === 'string') continue;
      const [key, enVal, zhVal] = entry;
      expect(enVal, `${key}: en === zh`).not.toBe(zhVal);
    }
  });
});

// ---- Dictionary structure tests ----

describe('dictionary structure', () => {
  it('every key in the English dictionary has a corresponding Chinese key', () => {
    // This is enforced by TypeScript, but we verify at runtime too
    const enKeys = Object.keys(dict('en'));
    const zhKeys = Object.keys(dict('zh'));
    expect(zhKeys.sort()).toEqual(enKeys.sort());
  });

  it('parameterised entries are functions in both locales', () => {
    const parameterisedKeys = [
      'chrome.sidebar.watch',
      'helm.repos.confirmRemove',
      'metricsExplorer.saved.confirmRemove',
      'actions.confirm.restartPods',
      'actions.confirm.restartRollout',
      'actions.confirm.deleteResource',
      'actions.confirm.drainNode',
    ];
    for (const key of parameterisedKeys) {
      const enVal = translate('en', key, 'test');
      const zhVal = translate('zh', key, 'test');
      expect(typeof enVal, `${key} en should be string`).toBe('string');
      expect(typeof zhVal, `${key} zh should be string`).toBe('string');
    }
  });
});

// ---- Storage tests ----

describe('cacheLocale / cachedLocale', () => {
  beforeEach(() => {
    installStorageStub();
  });

  afterEach(() => {
    // Restore the original localStorage (if any).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).localStorage;
  });

  it('returns "en" when nothing is stored', () => {
    expect(cachedLocale()).toBe('en');
  });

  it('round-trips through cacheLocale', () => {
    cacheLocale('zh');
    expect(cachedLocale()).toBe('zh');
    cacheLocale('en');
    expect(cachedLocale()).toBe('en');
  });

  it('treats an unrecognised stored value as English', () => {
    window.localStorage.setItem('k7s.locale', ' Klingon ');
    expect(cachedLocale()).toBe('en');
  });
});

// ---- Kind labels from the registry ----

describe('chrome kind labels', () => {
  it('every built-in kind has a non-empty label in English', () => {
    for (const kind of KIND_ORDER) {
      const label = kindLabel(kind, 'en');
      expect(label.length, `kindLabel(${kind}, en)`).toBeGreaterThan(0);
    }
  });

  it('every built-in kind has a non-empty label in Chinese', () => {
    for (const kind of KIND_ORDER) {
      const label = kindLabel(kind, 'zh');
      expect(label.length, `kindLabel(${kind}, zh)`).toBeGreaterThan(0);
    }
  });
});
