/**
 * Sidebar navigation (Design §1). Renders the built-in resource groups and their
 * kind items with live row counts. Clicking a kind switches the active resource
 * and clears any pod selection.
 *
 * Some resource groups carry overlay entries alongside their kinds:
 *   - Network: Endpoints, Service Topology, Ingress Routes (networking views)
 *   - Helm: Helm Market (action wizard alongside releases)
 *
 * Below a "Tools" section header, the remaining overlays are grouped:
 *   - Dashboard (pinned at the very top, above the resource groups)
 *   - Observability: Metrics, Alerting, Grafana
 *   - Security: Audit, SBOM
 *   - Images: Registries, Transfer
 *   - Tooling: Templates, Diff, Pod Files
 *   - System: Plugins
 *
 * The Custom section (B15) lists CRD-backed kinds discovered on connect, folded
 * under their API group the way Lens does — murphy-yi has 44 CRDs across 10 groups, so
 * a flat list would bury the built-in nav. Groups start collapsed; the one holding
 * the active kind opens automatically.
 *
 * Custom items show no row count: it would read "0" for every unopened kind, since
 * those aren't watched until you open them.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Zap,
  CircleDot,
  ArrowRightFromLine,
  Package,
  LayoutDashboard,
  BarChart3,
  Bell,
  LineChart,
  ClipboardList,
  Container,
  ArrowLeftRight,
  FolderOpen,
  PlusSquare,
  GitCompareArrows,
  Plug,
  Lock,
  FileText,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import { useStore, type OverlayKey, selectKindCounts } from '../../store';
import { useShallow } from 'zustand/react/shallow';
import {
  GROUP_ORDER,
  KIND_META,
  KIND_ORDER,
  DEFAULT_OPEN_GROUPS,
  kindMeta,
  type NavGroup,
  type ResourceKind,
} from '../../lib/kinds';
import { cx } from '../../lib/cx';
import { groupLabel, kindLabelFor } from '../../lib/i18n';
import { useTranslation } from '../../hooks/useI18n';
import type { CustomKind } from '../../providers/types';

export function NavList() {
  const nav = useStore((s) => s.nav);
  // The sidebar only shows per-kind counts, so subscribe to a derived counts
  // map (shallow-compared) instead of the whole rows map — otherwise every
  // pod-metric tick cluster-wide re-renders the entire sidebar.
  const counts = useStore(useShallow((s) => selectKindCounts(s.rows)));
  const setNav = useStore((s) => s.setNav);
  const customKinds = useStore((s) => s.customKinds);
  const watchStatus = useStore((s) => s.watchStatus);
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const { locale, t } = useTranslation();

  return (
    <div className={styles.nav} role="navigation" aria-label="Resource navigation">
      {/* Dashboard — pinned at top, above all resource groups */}
      <OverlayItem
        item={{
          key: 'dashboard',
          label: t('chrome.sidebar.tools.dashboard', 'Dashboard'),
          icon: <LayoutDashboard size={14} />,
        }}
        overlay={overlay}
        openOverlay={openOverlay}
        closeOverlay={closeOverlay}
        titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
      />
      <div className={styles.sectionDivider} />

      {GROUP_ORDER.map((group) =>
        group === 'custom' ? (
          // Hidden entirely on clusters with no CRDs (and while disconnected).
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
            group={group}
            header={groupLabel(group, locale)}
            active={isGroupActive(group, nav, overlay, customKinds)}
          >
            {kindsInGroup(group).map((kind) => {
              const active = nav === kind;
              const meta = kindMeta(kind, customKinds);
              const label = kindLabelFor(kind, customKinds, locale) ?? meta?.label ?? kind;
              return (
                <div
                  key={kind}
                  className={cx(styles.navItem, active && styles.navItemActive)}
                  onClick={() => setNav(kind)}
                  role="link"
                  aria-current={active ? 'page' : undefined}
                  aria-label={label}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setNav(kind);
                    }
                  }}
                >
                  <span className={styles.navIcon}>{meta?.icon}</span>
                  <span className={styles.navLabel}>{label}</span>
                  {watchStatus[kind] === 'forbidden' ? (
                    <span
                      className={styles.navForbidden}
                      title={t('chrome.sidebar.forbidden', 'RBAC: no permission')}
                    >
                      <Lock size={12} />
                    </span>
                  ) : (
                    <span className={styles.navCount}>{counts[kind] ?? 0}</span>
                  )}
                </div>
              );
            })}
            {/* Workloads extras: Pod Files (belongs with Pod resources). */}
            {group === 'workloads' && (
              <>
                <div className={styles.sectionDivider} />
                <OverlayItem
                  item={{
                    key: 'pod-files',
                    label: t('chrome.sidebar.tools.podFiles', 'Pod Files'),
                    icon: <FolderOpen size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
              </>
            )}
            {/* Network extras: Endpoints + Service Topology (overlay views
                that belong with the networking resources). */}
            {group === 'network' && (
              <>
                <div className={styles.sectionDivider} />
                <OverlayItem
                  item={{
                    key: 'endpoints',
                    label: t('chrome.sidebar.tools.endpoints', 'Endpoints'),
                    icon: <Zap size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
                <OverlayItem
                  item={{
                    key: 'topology',
                    label: t('chrome.sidebar.tools.topology', 'Service Topology'),
                    icon: <CircleDot size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
                <OverlayItem
                  item={{
                    key: 'ingress-routes',
                    label: t('chrome.sidebar.tools.ingressRoutes', 'Ingress Routes'),
                    icon: <ArrowRightFromLine size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
              </>
            )}
            {/* Config extras: Templates (belongs with ConfigMap/Secret resources). */}
            {group === 'config' && (
              <>
                <div className={styles.sectionDivider} />
                <OverlayItem
                  item={{
                    key: 'templates',
                    label: t('chrome.sidebar.tools.templates', 'Templates'),
                    icon: <PlusSquare size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
              </>
            )}
            {/* Access extras: Audit (belongs with RBAC/ServiceAccount resources). */}
            {group === 'access' && (
              <>
                <div className={styles.sectionDivider} />
                <OverlayItem
                  item={{
                    key: 'audit',
                    label: t('chrome.sidebar.tools.audit', 'Audit'),
                    icon: <ClipboardList size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
              </>
            )}
            {/* Images group: Image Registries, Image Transfer, SBOM */}
            {group === 'images' && (
              <>
                <OverlayItem
                  item={{
                    key: 'image-repos',
                    label: t('chrome.sidebar.tools.imageRepos', 'Image Registries'),
                    icon: <Container size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
                <OverlayItem
                  item={{
                    key: 'image-transfer',
                    label: t('chrome.sidebar.tools.imageTransfer', 'Image Transfer'),
                    icon: <ArrowLeftRight size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
                <OverlayItem
                  item={{
                    key: 'sbom',
                    label: t('chrome.sidebar.tools.sbom', 'SBOM'),
                    icon: <FileText size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
              </>
            )}
            {/* Helm extras: Helm Market (action wizard that belongs with
                the Helm releases resource). */}
            {group === 'helm' && (
              <OverlayItem
                item={{
                  key: 'helm-market',
                  label: t('chrome.sidebar.tools.helmMarket', 'Helm Market'),
                  icon: <Package size={14} />,
                }}
                overlay={overlay}
                openOverlay={openOverlay}
                closeOverlay={closeOverlay}
                titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
              />
            )}
            {/* Cluster extras: Observability, Diff, Plugins */}
            {group === 'cluster' && (
              <>
                <div className={styles.sectionDivider} />
                <CollapsibleOverlayGroup
                  header={t('chrome.sidebar.tools.observability', 'Observability')}
                  items={[
                    {
                      key: 'metrics',
                      label: t('chrome.sidebar.tools.metrics', 'Metrics'),
                      icon: <BarChart3 size={14} />,
                    },
                    {
                      key: 'alerting',
                      label: t('chrome.sidebar.tools.alerting', 'Alerting'),
                      icon: <Bell size={14} />,
                    },
                    {
                      key: 'grafana',
                      label: t('chrome.sidebar.tools.grafana', 'Grafana'),
                      icon: <LineChart size={14} />,
                    },
                  ]}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
                <OverlayItem
                  item={{
                    key: 'diff',
                    label: t('chrome.sidebar.tools.diff', 'Diff'),
                    icon: <GitCompareArrows size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
                <OverlayItem
                  item={{
                    key: 'plugins',
                    label: t('chrome.sidebar.tools.plugins', 'Plugins'),
                    icon: <Plug size={14} />,
                  }}
                  overlay={overlay}
                  openOverlay={openOverlay}
                  closeOverlay={closeOverlay}
                  titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                />
              </>
            )}
          </ResourceGroupSection>
        )
      )}
    </div>
  );
}

/**
 * Which overlay keys belong to each resource group — used to decide whether a
 * group should auto-expand (when one of its overlays is the active one). Keys
 * not listed here aren't tied to a group. Mirrors the extras rendered inline
 * below; keeping them in sync is what makes "active overlay opens its group"
 * work without the user hunting inside a fold.
 */
const GROUP_OVERLAYS: Partial<Record<NavGroup, OverlayKey[]>> = {
  workloads: ['pod-files'],
  network: ['endpoints', 'topology', 'ingress-routes'],
  config: ['templates'],
  access: ['audit'],
  images: ['image-repos', 'image-transfer', 'sbom'],
  helm: ['helm-market'],
  cluster: ['metrics', 'alerting', 'grafana', 'diff', 'plugins'],
};

/** Whether any kind or overlay in this group is currently active. */
function isGroupActive(
  group: NavGroup,
  nav: string,
  overlay: OverlayKey | null,
  customKinds: CustomKind[]
): boolean {
  if (kindsInGroup(group).some((k) => k === nav)) return true;
  const overlays = GROUP_OVERLAYS[group] ?? [];
  if (overlay && overlays.includes(overlay)) return true;
  // Custom kinds live under 'custom', handled separately.
  void customKinds;
  return false;
}

/**
 * A collapsible resource group — a chevron + localised header that reveals its
 * kinds and tool overlays. High-frequency groups (DEFAULT_OPEN_GROUPS) start
 * open; the rest fold to keep the first view focused. A group holding the
 * active nav/overlay opens itself regardless of the default, so a restored
 * selection or a freshly opened tool is never hidden inside a fold.
 */
function ResourceGroupSection({
  group,
  header,
  active,
  children,
}: {
  group: NavGroup;
  header: string;
  active: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(DEFAULT_OPEN_GROUPS.has(group));
  // Auto-expand when something inside becomes active; never auto-collapse, so
  // the user's manual "leave this open" choice is respected.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
  void group;
  return (
    <div>
      <button
        type="button"
        className={styles.navGroup}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={header}
      >
        <span className={styles.navGroupChevron} aria-hidden="true">
          {open ? '⌄' : '›'}
        </span>
        <span className={styles.navGroupLabel}>{header}</span>
      </button>
      {open && children}
    </div>
  );
}

/** A single overlay sidebar entry — reusable across groups and sections.
 *  Memoized: the sidebar renders many OverlayItems and their props are stable. */
type OverlayItemDef = { key: OverlayKey; label: string; icon: ReactNode };

const OverlayItem = React.memo(function OverlayItem({
  item,
  overlay,
  openOverlay,
  closeOverlay,
  titleClose,
  nested,
}: {
  item: OverlayItemDef;
  overlay: OverlayKey | null;
  openOverlay: (key: OverlayKey) => void;
  closeOverlay: () => void;
  titleClose?: string;
  /** When true, indent the item (for entries inside a collapsible group). */
  nested?: boolean;
}) {
  const active = overlay === item.key;
  return (
    <div
      className={cx(styles.navItem, nested && styles.navItemNested, active && styles.navItemActive)}
      onClick={() => (active ? closeOverlay() : openOverlay(item.key))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          active ? closeOverlay() : openOverlay(item.key);
        }
      }}
      title={active ? titleClose : item.label}
      role="button"
      aria-pressed={active}
      aria-label={item.label}
      tabIndex={0}
    >
      <span className={styles.navIcon}>{item.icon}</span>
      <span className={styles.navLabel}>{item.label}</span>
    </div>
  );
});

/** A collapsible group of overlay entries (e.g. Observability, Images). */
function CollapsibleOverlayGroup({
  header,
  items,
  overlay,
  openOverlay,
  closeOverlay,
  titleClose,
}: {
  header: string;
  items: OverlayItemDef[];
  overlay: OverlayKey | null;
  openOverlay: (key: OverlayKey) => void;
  closeOverlay: () => void;
  titleClose?: string;
}) {
  // Auto-expand when one of the group's items is active.
  const groupActive = items.some((it) => it.key === overlay);
  const [open, setOpen] = useState(groupActive);
  useEffect(() => {
    if (groupActive) setOpen(true);
  }, [groupActive]);

  return (
    <div>
      <button
        type="button"
        className={`${styles.navGroup} ${styles.navGroupOverlay}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={header}
      >
        <span className={styles.navGroupChevron} aria-hidden="true">
          {open ? '⌄' : '›'}
        </span>
        <span className={styles.navGroupLabel}>{header}</span>
      </button>
      {open &&
        items.map((it) => (
          <OverlayItem
            key={it.key}
            item={it}
            overlay={overlay}
            openOverlay={openOverlay}
            closeOverlay={closeOverlay}
            titleClose={titleClose}
            nested
          />
        ))}
    </div>
  );
}

/** The Custom section: a filter box plus one collapsible row per API group. */
function CustomSection({
  kinds,
  nav,
  setNav,
  filterPlaceholder,
  emptyLabel,
  customHeaderLabel,
}: {
  kinds: CustomKind[];
  nav: string;
  setNav: (id: string) => void;
  filterPlaceholder: string;
  emptyLabel: string;
  customHeaderLabel: string;
}) {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Match on the whole id so both "argo" (group) and "application" (kind) hit.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return kinds;
    return kinds.filter((k) => k.id.toLowerCase().includes(q) || k.kind.toLowerCase().includes(q));
  }, [kinds, filter]);

  // Bucket by API group, preserving the discovered order (sorted by id, so groups
  // come out alphabetically and kinds are sorted within each).
  const groups = useMemo(() => {
    const byGroup = new Map<string, CustomKind[]>();
    for (const k of visible) {
      const list = byGroup.get(k.group);
      if (list) list.push(k);
      else byGroup.set(k.group, [k]);
    }
    return [...byGroup];
  }, [visible]);

  // Open the group holding the active kind, so a selection restored from prefs
  // (or made before a reconnect) is visible rather than hidden inside a fold.
  const activeGroup = kinds.find((k) => k.id === nav)?.group;
  useEffect(() => {
    if (!activeGroup) return;
    setExpanded((prev) => (prev.has(activeGroup) ? prev : new Set(prev).add(activeGroup)));
  }, [activeGroup]);

  const toggle = useCallback(
    (group: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (!next.delete(group)) next.add(group);
        return next;
      }),
    []
  );

  // While filtering, show every match: folds would hide the thing being searched for.
  const filtering = filter.trim() !== '';

  return (
    <div>
      <div className={styles.sectionHeader}>
        {customHeaderLabel}
        <span className={styles.sectionCount}>{kinds.length}</span>
      </div>

      {/* Only worth a filter box once the list is long enough to hunt through. */}
      {kinds.length > 8 && (
        <input
          className={styles.navFilter}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={filterPlaceholder}
          aria-label={filterPlaceholder}
        />
      )}

      {groups.map(([group, groupKinds]) => {
        const open = filtering || expanded.has(group);
        return (
          <div key={group}>
            <button
              type="button"
              className={styles.navGroup}
              onClick={() => toggle(group)}
              title={group}
              aria-expanded={open}
              aria-label={group}
            >
              <span className={styles.navGroupChevron} aria-hidden="true">
                {open ? '⌄' : '›'}
              </span>
              <span className={styles.navGroupLabel}>{group}</span>
              <span className={styles.navCount}>{groupKinds.length}</span>
            </button>
            {open &&
              groupKinds.map((ck) => {
                const active = nav === ck.id;
                return (
                  <div
                    key={ck.id}
                    className={`${styles.navItem} ${styles.navItemNested} ${
                      active ? styles.navItemActive : ''
                    }`}
                    onClick={() => setNav(ck.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setNav(ck.id);
                      }
                    }}
                    title={`${ck.kind} · ${ck.group}/${ck.version}`}
                    role="link"
                    aria-current={active ? 'page' : undefined}
                    aria-label={ck.kind}
                    tabIndex={0}
                  >
                    <span className={styles.navLabel}>{ck.kind}</span>
                  </div>
                );
              })}
          </div>
        );
      })}

      {groups.length === 0 && <div className={styles.navEmpty}>{emptyLabel}</div>}
    </div>
  );
}

/** Built-in kinds belonging to a group, in sidebar order. */
function kindsInGroup(group: NavGroup): ResourceKind[] {
  return KIND_ORDER.filter((k) => KIND_META[k].group === group);
}
