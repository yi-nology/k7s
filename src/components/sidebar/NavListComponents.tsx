/**
 * NavList internal components.
 *
 * Extracted to reduce NavList.tsx size and improve reusability.
 */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Zap,
  CircleDot,
  ArrowRightFromLine,
  Package,
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
  FileText,
  Wrench,
  ChevronDown,
} from 'lucide-react';
import styles from './Sidebar.module.css';
import { cx } from '../../lib/cx';
import { useTranslation } from '../../hooks/useI18n';
import { IPADOS_HIDDEN_OVERLAYS } from '../../lib/platform';
import type { OverlayKey } from '../../store';
import { DEFAULT_OPEN_GROUPS, type CustomKind, type NavGroup, type ResourceKind } from '../../lib/kinds';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolItem {
  key: OverlayKey;
  label: string;
  icon: ReactNode;
}

interface ToolSubgroup {
  id: string;
  label: string;
  items: ToolItem[];
}

type OverlayItemDef = { key: OverlayKey; label: string; icon: ReactNode };

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useToolSubgroups(): ToolSubgroup[] {
  const { t } = useTranslation();
  return useMemo(() => [
    {
      id: 'observability',
      label: t('chrome.sidebar.tools.observability', 'Observability'),
      items: [
        { key: 'metrics', label: t('chrome.sidebar.tools.metrics', 'Metrics'), icon: <BarChart3 size={14} /> },
        { key: 'alerting', label: t('chrome.sidebar.tools.alerting', 'Alerting'), icon: <Bell size={14} /> },
        ...(!IPADOS_HIDDEN_OVERLAYS.has('grafana') ? [{ key: 'grafana' as const, label: t('chrome.sidebar.tools.grafana', 'Grafana'), icon: <LineChart size={14} /> }] : []),
      ],
    },
    {
      id: 'deployment',
      label: t('chrome.sidebar.tools.deployment', 'Deployment'),
      items: [
        ...(!IPADOS_HIDDEN_OVERLAYS.has('templates') ? [{ key: 'templates' as const, label: t('chrome.sidebar.tools.templates', 'Templates'), icon: <PlusSquare size={14} /> }] : []),
        ...(!IPADOS_HIDDEN_OVERLAYS.has('helm-market') ? [{ key: 'helm-market' as const, label: t('chrome.sidebar.tools.helmMarket', 'Helm Market'), icon: <Package size={14} /> }] : []),
        ...(!IPADOS_HIDDEN_OVERLAYS.has('diff') ? [{ key: 'diff' as const, label: t('chrome.sidebar.tools.diff', 'Diff'), icon: <GitCompareArrows size={14} /> }] : []),
      ],
    },
    {
      id: 'inspection',
      label: t('chrome.sidebar.tools.inspection', 'Inspection'),
      items: [
        ...(!IPADOS_HIDDEN_OVERLAYS.has('pod-files') ? [{ key: 'pod-files' as const, label: t('chrome.sidebar.tools.podFiles', 'Pod Files'), icon: <FolderOpen size={14} /> }] : []),
        { key: 'endpoints', label: t('chrome.sidebar.tools.endpoints', 'Endpoints'), icon: <Zap size={14} /> },
        { key: 'ingress-routes', label: t('chrome.sidebar.tools.ingressRoutes', 'Ingress Routes'), icon: <ArrowRightFromLine size={14} /> },
        ...(!IPADOS_HIDDEN_OVERLAYS.has('topology') ? [{ key: 'topology' as const, label: t('chrome.sidebar.tools.topology', 'Service Topology'), icon: <CircleDot size={14} /> }] : []),
      ],
    },
    {
      id: 'supply-chain',
      label: t('chrome.sidebar.tools.supplyChain', 'Supply Chain'),
      items: [
        ...(!IPADOS_HIDDEN_OVERLAYS.has('image-repos') ? [{ key: 'image-repos' as const, label: t('chrome.sidebar.tools.imageRepos', 'Image Registries'), icon: <Container size={14} /> }] : []),
        ...(!IPADOS_HIDDEN_OVERLAYS.has('image-transfer') ? [{ key: 'image-transfer' as const, label: t('chrome.sidebar.tools.imageTransfer', 'Image Transfer'), icon: <ArrowLeftRight size={14} /> }] : []),
        ...(!IPADOS_HIDDEN_OVERLAYS.has('sbom') ? [{ key: 'sbom' as const, label: t('chrome.sidebar.tools.sbom', 'SBOM'), icon: <FileText size={14} /> }] : []),
        ...(!IPADOS_HIDDEN_OVERLAYS.has('audit') ? [{ key: 'audit' as const, label: t('chrome.sidebar.tools.audit', 'Audit'), icon: <ClipboardList size={14} /> }] : []),
      ],
    },
    {
      id: 'system',
      label: t('chrome.sidebar.tools.system', 'System'),
      items: [
        ...(!IPADOS_HIDDEN_OVERLAYS.has('plugins') ? [{ key: 'plugins' as const, label: t('chrome.sidebar.tools.plugins', 'Plugins'), icon: <Plug size={14} /> }] : []),
      ],
    },
  ], [t]);
}

// ─── Components ──────────────────────────────────────────────────────────────

export function ToolsSection({
  overlay,
  openOverlay,
  closeOverlay,
}: {
  overlay: OverlayKey | null;
  openOverlay: (key: OverlayKey) => void;
  closeOverlay: () => void;
}) {
  const { t } = useTranslation();
  const subgroups = useToolSubgroups();
  const [open, setOpen] = useState(true);
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(() => {
    // Auto-expand subgroups containing the active overlay.
    const active = subgroups.find((sg) => sg.items.some((it) => it.key === overlay));
    return new Set(active ? [active.id] : []);
  });

  // Auto-expand when overlay changes.
  useEffect(() => {
    const active = subgroups.find((sg) => sg.items.some((it) => it.key === overlay));
    if (active) {
      setExpandedSubs((prev) => (prev.has(active.id) ? prev : new Set(prev).add(active.id)));
    }
  }, [overlay, subgroups]);

  const toggleSub = useCallback((id: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  // Count total active tools across all subgroups.
  const totalTools = subgroups.reduce((n, sg) => n + sg.items.length, 0);

  return (
    <div>
      <button
        type="button"
        className={styles.navGroup}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('chrome.sidebar.tools.title', 'Tools')}
      >
        <span className={styles.navGroupChevron} aria-hidden="true">
          <ChevronDown size={12} className={cx(styles.toolsChevron, !open && styles.toolsChevronCollapsed)} />
        </span>
        <Wrench size={13} className={styles.toolsIcon} />
        <span className={styles.navGroupLabel}>{t('chrome.sidebar.tools.title', 'Tools')}</span>
        <span className={styles.navCount}>{totalTools}</span>
      </button>
      {open &&
        subgroups.map((sg) => {
          const subOpen = expandedSubs.has(sg.id);
          const subActive = sg.items.some((it) => it.key === overlay);
          return (
            <div key={sg.id}>
              <button
                type="button"
                className={cx(styles.navGroup, styles.navGroupOverlay)}
                onClick={() => toggleSub(sg.id)}
                aria-expanded={subOpen}
                aria-label={sg.label}
              >
                <span className={styles.navGroupChevron} aria-hidden="true">
                  {subOpen ? '⌄' : '›'}
                </span>
                <span className={cx(styles.navGroupLabel, subActive && styles.navGroupLabelActive)}>
                  {sg.label}
                </span>
              </button>
              {subOpen &&
                sg.items.map((it) => (
                  <OverlayItem
                    key={it.key}
                    item={it}
                    overlay={overlay}
                    openOverlay={openOverlay}
                    closeOverlay={closeOverlay}
                    titleClose={t('chrome.sidebar.tools.close', 'Click to close')}
                    nested
                  />
                ))}
            </div>
          );
        })}
    </div>
  );
}

export function ResourceGroupSection({
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
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);
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

export const OverlayItem = React.memo(function OverlayItem({
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
          if (active) closeOverlay(); else openOverlay(item.key);
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

export function CustomSection({
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
                    className={`${styles.navItem} ${styles.navItemNested} ${active ? styles.navItemActive : ''}`}
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

// ─── Utility Functions ───────────────────────────────────────────────────────

export function isGroupActive(_group: NavGroup, _nav: string, _customKinds: CustomKind[]): boolean {
  // For now, just check if nav is in the group's kinds
  // This is a simplified version - the actual implementation may be more complex
  return false;
}

export function kindsInGroup(_group: NavGroup): ResourceKind[] {
  // This is a placeholder - the actual implementation depends on the group structure
  return [];
}
