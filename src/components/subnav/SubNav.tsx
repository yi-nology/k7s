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
  const { locale, t } = useTranslation();

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
            ...(customKinds.length > 0
              ? [{ id: 'custom', label: 'custom', kinds: customKinds.map((ck) => ck.id) }]
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
          {g.label && (
            <span className={styles.groupLabel}>
              {t(`subnav.group.${g.id}`, GROUP_FALLBACK[g.id] ?? g.id)}
            </span>
          )}
          {g.kinds.map((k) => (
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
