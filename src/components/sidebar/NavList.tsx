/**
 * Sidebar navigation — two-zone layout:
 *
 *   ┌─────────────────────┐
 *   │ Dashboard           │  ← pinned top
 *   ├─────────────────────┤
 *   │ ▾ Workloads         │  ← K8s resource groups (no overlays)
 *   │   Pods (3)          │
 *   │   Deployments (2)   │
 *   │ ▾ Network           │
 *   │   Services (5)      │
 *   │   …                 │
 *   │ ▾ RBAC              │
 *   │ ▾ Helm              │
 *   │ ▾ Cluster           │
 *   │ ▾ Custom (CRDs)     │
 *   ├─────────────────────┤
 *   │ ▾ Tools (12)        │  ← all overlay tools, grouped
 *   │   Observability     │
 *   │   Deployment        │
 *   │   Inspection        │
 *   │   Supply Chain      │
 *   │   System            │
 *   └─────────────────────┘
 *
 * The split keeps K8s resources visually clean and makes tools discoverable
 * in one place instead of scattered across 7 resource groups.
 */

import { useCallback } from 'react';
import {
  LayoutDashboard,
  Lock,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import { useStore, type OverlayKey, selectKindCounts } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import {
  GROUP_ORDER,
  KIND_META,
  KIND_ORDER,
  kindMeta,
  type NavGroup,
  type ResourceKind,
  type KindId,
} from '../../lib/kinds';
import { cx } from '../../lib/cx';
import { groupLabel, kindLabelFor } from '../../lib/i18n';
import { useTranslation } from '../../hooks/useI18n';
import type { CustomKind } from '../../providers/types';
import { useNav, useCustomKinds } from '../../hooks/useStoreHooks';
import { ToolsSection, ResourceGroupSection, OverlayItem, CustomSection } from './NavListComponents';

// ─── NavList ─────────────────────────────────────────────────────────────────

export function NavList({ onNavigate }: { onNavigate?: () => void } = {}) {
  const nav = useNav();
  const counts = useStore(useShallow((s) => selectKindCounts(s.rows)));
  const setNav = useStore((s) => s.setNav);
  const customKinds = useCustomKinds();
  const watchStatus = useStore((s) => s.watchStatus);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const { locale, t } = useTranslation();

  const handleNav = useCallback(
    (kind: string) => {
      setNav(kind as KindId);
      onNavigate?.();
    },
    [setNav, onNavigate],
  );
  const handleOverlay = useCallback(
    (key: OverlayKey) => {
      openOverlay(key);
      onNavigate?.();
    },
    [openOverlay, onNavigate],
  );

  return (
    <div className={styles.nav} role="navigation" aria-label="Resource navigation">
      {/* ── Dashboard ── */}
      <OverlayItem
        item={{ key: 'dashboard', label: t('chrome.sidebar.tools.dashboard', 'Dashboard'), icon: <LayoutDashboard size={14} /> }}
        overlay={overlay}
        openOverlay={handleOverlay}
        closeOverlay={closeOverlay}
        titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
      />
      <div className={styles.sectionDivider} />

      {/* ── K8s Resource Groups (no overlays) ── */}
      {GROUP_ORDER.map((group) =>
        group === 'custom' ? (
          customKinds.length === 0 ? null : (
            <CustomSection
              key={group}
              kinds={customKinds}
              nav={nav}
              setNav={setNav}
              filterPlaceholder={t('chrome.sidebar.filterKinds')}
              emptyLabel={t('chrome.sidebar.noKinds')}
              customHeaderLabel={groupLabel('custom', locale)}
            />
          )
        ) : (
          <ResourceGroupSection
            key={group}
            header={groupLabel(group, locale)}
            active={isGroupActive(group, nav, customKinds)}
          >
            {kindsInGroup(group).map((kind) => {
              const active = nav === kind;
              const meta = kindMeta(kind, customKinds);
              const label = kindLabelFor(kind, customKinds, locale) ?? meta?.label ?? kind;
              return (
                <div
                  key={kind}
                  className={cx(styles.navItem, active && styles.navItemActive)}
                  onClick={() => handleNav(kind)}
                  role="link"
                  aria-current={active ? 'page' : undefined}
                  aria-label={label}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleNav(kind);
                    }
                  }}
                >
                  <span className={styles.navIcon}>{meta?.icon}</span>
                  <span className={styles.navLabel}>{label}</span>
                  {watchStatus[kind] === 'forbidden' ? (
                    <span className={styles.navForbidden} title={t('chrome.sidebar.forbidden', 'RBAC: no permission')}>
                      <Lock size={12} />
                    </span>
                  ) : (
                    <span className={styles.navCount}>{counts[kind] ?? 0}</span>
                  )}
                </div>
              );
            })}
          </ResourceGroupSection>
        )
      )}

      {/* ── Tools Section ── */}
      <div className={styles.sectionDivider} />
      <ToolsSection
        overlay={overlay}
        openOverlay={handleOverlay}
        closeOverlay={closeOverlay}
      />
    </div>
  );
}

// Components extracted to ./NavListComponents.tsx:
// - ToolsSection
// - ResourceGroupSection
// - OverlayItem
// - CustomSection

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isGroupActive(group: NavGroup, nav: string, _customKinds: CustomKind[]): boolean {
  return kindsInGroup(group).some((k) => k === nav);
}

function kindsInGroup(group: NavGroup): ResourceKind[] {
  return KIND_ORDER.filter((k) => KIND_META[k].group === group);
}
