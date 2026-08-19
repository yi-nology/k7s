/**
 * SubNav — 资源分区内的页内副导航(P1 IA 重构)。
 *
 * workloads 是平铺 tab(无分组标题);config/storage 按 SECTION_SUBGROUPS
 * 分组渲染,集群上发现的 CRD kind(useCustomKinds)动态追加到 config 末尾的
 * 「自定义资源」组(分组 id 'custom',无 CRD 时整组不渲染)。
 *
 * 点击 tab 走 setNav(kind):store 会自动带出对应分区(sectionForKind)并按
 * 导航语义重置选中行/筛选/排序 —— 与旧 NavList 点击行为一致,本组件不写
 * section。Task 4 由 App.tsx 在各资源分区内容区顶部渲染本组件。
 */

import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { useCustomKinds } from '../../hooks/useStoreHooks';
import { kindLabelFor } from '../../lib/i18n';
import { kindMeta } from '../../lib/kinds';
import { kindsForSection, SECTION_SUBGROUPS } from '../../lib/sections';
import type { SectionId } from '../../lib/sections';
import type { KindId } from '../../providers/types';
import { cx } from '../../lib/cx';
import styles from './SubNav.module.css';

interface SubNavGroup {
  id: string;
  /** Empty for the flat workloads strip — no group heading is rendered. */
  label: string;
  kinds: KindId[];
}

/** English fallbacks for `subnav.group.*` — used only if a dictionary somehow
 *  lacks the key (both shipped dictionaries are Dictionary-typed, so a missing
 *  key is a compile error; this keeps `t()` from ever rendering the raw id). */
const GROUP_FALLBACK: Record<string, string> = {
  config: 'Configuration',
  network: 'Network',
  access: 'Access Control',
  cluster: 'Cluster',
  custom: 'Custom Resources',
  storage: 'Storage',
};

export function SubNav({ section }: { section: SectionId }) {
  const nav = useStore((s) => s.nav);
  const setNav = useStore((s) => s.setNav);
  const customKinds = useCustomKinds();
  const customKindCounts = useStore((s) => s.customKindCounts);
  const { locale, t } = useTranslation();

  // The Custom Resources group starts collapsed: operator-installed CRD
  // *definitions* (Envoy Gateway, cert-manager, …) are noise next to
  // ConfigMap/Secret unless the user opts in — or is already viewing one
  // (palette/deep-link navigation must not hide the active tab).
  const [customOpen, setCustomOpen] = useState(false);
  const activeIsCustom = customKinds.some((ck) => ck.id === nav);
  const customExpanded = customOpen || activeIsCustom;

  // Filter custom kinds: hide those with 0 instances when counts are available.
  // The active kind is never hidden (deep-link reachable).
  // When counts are undefined (not yet loaded or provider error), show all.
  const visibleCustomKinds = useMemo(() => {
    if (!customKindCounts) return customKinds;
    return customKinds.filter(
      (ck) => customKindCounts[ck.id] > 0 || ck.id === nav
    );
  }, [customKinds, customKindCounts, nav]);

  const hiddenCount = customKinds.length - visibleCustomKinds.length;

  const groups: SubNavGroup[] =
    section === 'workloads'
      ? [{ id: 'workloads', label: '', kinds: kindsForSection('workloads') }]
      : section === 'config'
        ? [
            ...SECTION_SUBGROUPS.config.map((g) => ({
              id: g.id,
              label: g.id,
              kinds: [...g.kinds] as KindId[],
            })),
            // Discovered CRD kinds get their own trailing group; the heading is
            // skipped entirely on clusters with none (no dangling label).
            ...(visibleCustomKinds.length > 0
              ? [{ id: 'custom', label: 'custom', kinds: visibleCustomKinds.map((ck) => ck.id) }]
              : []),
          ]
        : SECTION_SUBGROUPS.storage.map((g) => ({
            id: g.id,
            label: g.id,
            kinds: [...g.kinds] as KindId[],
          }));

  return (
    <div className={styles.subnav} role="tablist">
      {groups.map((g) => (
        <div key={g.id} className={styles.group}>
          {g.id === 'custom' ? (
            <button
              type="button"
              className={styles.groupToggle}
              aria-expanded={customExpanded}
              onClick={() => setCustomOpen((v) => !v)}
              title={
                hiddenCount > 0
                  ? t('subnav.group.customTooltip', `${hiddenCount} empty type${hiddenCount > 1 ? 's' : ''} hidden`)
                  : undefined
              }
            >
              <span className={styles.chevron} aria-hidden="true">
                {customExpanded ? '▾' : '▸'}
              </span>
              {t(`subnav.group.custom`, GROUP_FALLBACK.custom)}
              <span className={styles.count}>{visibleCustomKinds.length}</span>
            </button>
          ) : (
            g.label && (
              <span className={styles.groupLabel}>
                {t(`subnav.group.${g.id}`, GROUP_FALLBACK[g.id] ?? g.id)}
              </span>
            )
          )}
          {(g.id !== 'custom' || customExpanded) &&
            g.kinds.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={nav === k}
                className={cx(styles.tab, nav === k && styles.active)}
                onClick={() => setNav(k)}
              >
                {/* Localised label where the locale has one (TopBar breadcrumb
              parity); custom kinds show their CRD Kind name; the last
              resort is the static English registry label, then the id. */}
                {kindLabelFor(k, customKinds, locale) ?? kindMeta(k, customKinds)?.label ?? k}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
