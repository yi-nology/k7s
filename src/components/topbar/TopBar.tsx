/**
 * Top bar (Design §2): breadcrumb (cluster / group / Kind) on the left, the
 * language switcher + namespace filter dropdown on the right. The namespace
 * list is live — derived from the Namespaces the backend is watching, plus the
 * "all" option.
 *
 * The language switcher is the most-affordant UI: two-letter code (EN / 中),
 * clicking opens a small menu with every locale. The settings panel has the
 * same control in case the user is in a flow that already has the panel open.
 */

import { useCallback, useMemo, useRef } from 'react';
import styles from './TopBar.module.css';
import { useStore, type OverlayKey } from '../../store';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useTranslation } from '../../hooks/useI18n';
import { isClusterScoped, kindMeta, type KindId } from '../../lib/kinds';
import { groupLabel, kindLabelFor, LOCALES, LOCALE_LABELS, type Locale } from '../../lib/i18n';

/** Human-readable labels for each overlay key, used in the breadcrumb when an
 *  overlay is active.  Keys not listed here fall back to a title-cased version
 *  of the raw key string. */
const OVERLAY_LABELS: Partial<Record<OverlayKey, string>> = {
  'helm-market': 'Helm Market',
  'pod-files': 'Pod Files',
  'image-repos': 'Image Repos',
  'image-transfer': 'Image Transfer',
  templates: 'Templates',
  dashboard: 'Dashboard',
  metrics: 'Metrics Explorer',
  grafana: 'Grafana',
  endpoints: 'Endpoints',
  topology: 'Topology',
  'ingress-routes': 'Ingress Routes',
  alerting: 'Alerting',
  audit: 'Audit',
  'ingress-editor': 'Ingress Editor',
  diff: 'Diff',
  plugins: 'Plugins',
};

function overlayLabel(key: OverlayKey): string {
  return OVERLAY_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export function TopBar() {
  const nav = useStore((s) => s.nav);
  const overlay = useStore((s) => s.overlay);
  const namespace = useStore((s) => s.namespace);
  const connection = useStore((s) => s.connection);
  const nsRows = useStore((s) => s.rows.namespaces);
  const setPaletteOpen = useStore((s) => s.setPaletteOpen);
  const open = useStore((s) => s.openMenu === 'ns');
  const toggleMenu = useStore((s) => s.toggleMenu);
  const closeMenus = useStore((s) => s.closeMenus);
  const setNamespace = useStore((s) => s.setNamespace);
  const customKinds = useStore((s) => s.customKinds);
  const setSettings = useStore((s) => s.setSettings);
  const { locale, t } = useTranslation();

  const nsRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  useClickOutside(nsRef, closeMenus, open);
  // The language switcher closes any open dropdown (including itself) when a
  // locale is picked. useClickOutside handles clicks *outside*; the close here
  // is for when the user picks a value, which is an inside-click.

  const cluster = connection.clusterName ?? connection.context ?? 'k7s';
  // Runtime lookup: custom (CRD-backed) kinds aren't in the static table (B15).
  const meta = kindMeta(nav as KindId, customKinds);
  const group = meta?.group;
  // The group header in the breadcrumb is the localised label when we have one;
  // for custom kinds there's no static group label, so we fall back to the
  // raw group name (which is itself the meaningful identifier).
  const groupText = group === 'custom' ? 'custom' : group ? groupLabel(group, locale) : 'custom';
  // The kind label in the breadcrumb is localised through `kindLabelFor` (zh
  // ships "Pod" not "Pods", "节点" not "Nodes"). Falls back to the static
  // KIND_META label and finally to the raw nav id if neither resolves.
  const kindText = kindLabelFor(nav, customKinds, locale) ?? meta?.label ?? nav;

  // The namespace filter only affects namespaced resource tables. When a tool
  // panel (overlay) is open the table is hidden, and cluster-scoped kinds
  // ignore the filter outright (see ResourceTable). In both cases the dropdown
  // is a no-op that would mislead — disable it with a tooltip explaining why.
  const nsDisabled = overlay !== null || isClusterScoped(nav as KindId, customKinds);
  const nsDisabledTitle = overlay
    ? t('chrome.topbar.nsDisabledOverlay')
    : t('chrome.topbar.nsDisabledScope');

  // "all" plus the live namespace names (sorted for stable display).
  const namespaces = useMemo(() => {
    const names = nsRows.map((r) => r.name).sort();
    return ['all', ...names];
  }, [nsRows]);

  const handleLangPick = useCallback(
    (l: Locale) => {
      closeMenus();
      setSettings({ language: l });
    },
    [closeMenus, setSettings]
  );

  return (
    <div className={styles.topbar}>
      <div className={styles.breadcrumb}>
        {overlay !== null ? (
          <>
            {cluster} <span className={styles.sep}>/</span>{' '}
            <span className={styles.kind}>{overlayLabel(overlay)}</span>
          </>
        ) : (
          <>
            {cluster} <span className={styles.sep}>/</span> {groupText}{' '}
            <span className={styles.sep}>/</span> <span className={styles.kind}>{kindText}</span>
          </>
        )}
      </div>

      <div className={styles.spacer} />

      {/* Quick search affordance — opens the command palette (B28) when focused.
          We render a static <div> rather than an <input> to avoid stealing
          focus from the table on every refresh; clicking the box dispatches a
          keyboard event the palette already listens for. */}
      <div
        className={styles.cmdBar}
        role="button"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setPaletteOpen(true);
        }}
        tabIndex={0}
        onClick={() => setPaletteOpen(true)}
      >
        <span className={styles.cmdIcon} aria-hidden="true">
          ⌕
        </span>
        <span className={styles.cmdPlaceholder}>{t('chrome.topbar.searchPlaceholder')}</span>
        <span className={styles.cmdKbd}>⌘</span>
        <span className={styles.cmdKbd}>K</span>
      </div>

      {/* Language switcher: the current locale's short code, with a dropdown of
          every supported language on click. Lives next to the namespace picker
          because both are "set the working context" controls. */}
      <LanguageSwitcher ref={langRef} current={locale} onPick={handleLangPick} />

      <div className={styles.nsWrap} ref={nsRef}>
        <button
          type="button"
          className={styles.nsButton}
          onClick={() => {
            if (nsDisabled) return;
            toggleMenu('ns');
          }}
          disabled={nsDisabled}
          title={nsDisabled ? nsDisabledTitle : undefined}
        >
          <span className={styles.nsPrefix}>{t('chrome.topbar.nsPrefix')}</span>
          <span className={styles.nsValue}>{namespace}</span>
          <span className={styles.nsChevron}>▼</span>
        </button>

        {open && (
          <div className={styles.nsMenu}>
            {namespaces.map((ns) => {
              const selected = ns === namespace;
              return (
                <button
                  key={ns}
                  type="button"
                  className={`${styles.nsRow} ${selected ? styles.nsRowSelected : ''}`}
                  onClick={() => setNamespace(ns)}
                >
                  <span className={styles.nsCheck}>{selected ? '✓' : ''}</span>
                  {ns}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The compact language switcher. Renders a button with the current locale's
 * short label ("EN" / "中"), opening a menu of every supported locale.
 */
function LanguageSwitcher({
  current,
  onPick,
  ref,
}: {
  current: Locale;
  onPick: (l: Locale) => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  const open = useStore((s) => s.openMenu === 'lang');
  const toggleMenu = useStore((s) => s.toggleMenu);

  return (
    <div className={styles.langWrap} ref={ref}>
      <button
        type="button"
        className={styles.langButton}
        onClick={() => toggleMenu('lang')}
        title={LOCALE_LABELS[current]}
      >
        <span className={styles.langGlyph}>{shortLabel(current)}</span>
      </button>
      {open && (
        <div className={styles.langMenu}>
          {LOCALES.map((l) => {
            const selected = l === current;
            return (
              <button
                key={l}
                type="button"
                className={`${styles.langRow} ${selected ? styles.langRowSelected : ''}`}
                onClick={() => onPick(l)}
              >
                <span className={styles.langCheck}>{selected ? '✓' : ''}</span>
                {LOCALE_LABELS[l]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Compact label for the language button. Each locale picks its own glyph. */
function shortLabel(locale: Locale): string {
  switch (locale) {
    case 'zh':
      return '中';
    case 'en':
      return 'EN';
  }
}
