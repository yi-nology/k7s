/**
 * Sidebar navigation (Design §1). Renders the built-in groups (Workloads, Network,
 * Config, Cluster) and their kind items with live row counts. Clicking a kind
 * switches the active resource and clears any pod selection.
 *
 * The Custom section (B15) lists CRD-backed kinds discovered on connect, folded
 * under their API group the way Lens does — murphy-yi has 44 CRDs across 10 groups, so
 * a flat list would bury the built-in nav. Groups start collapsed; the one holding
 * the active kind opens automatically.
 *
 * Custom items show no row count: it would read "0" for every unopened kind, since
 * those aren't watched until you open them.
 */

import { useEffect, useMemo, useState } from "react";
import styles from "./Sidebar.module.css";
import { useStore } from "../../store";
import {
  GROUP_ORDER,
  KIND_META,
  KIND_ORDER,
  kindMeta,
  type NavGroup,
  type ResourceKind,
} from "../../lib/kinds";
import { groupLabel, kindLabelFor } from "../../lib/i18n";
import { useTranslation } from "../../hooks/useI18n";
import type { CustomKind } from "../../providers/types";

export function NavList() {
  const nav = useStore((s) => s.nav);
  const rows = useStore((s) => s.rows);
  const setNav = useStore((s) => s.setNav);
  const customKinds = useStore((s) => s.customKinds);
  const { locale, t } = useTranslation();

  return (
    <div className={styles.nav}>
      {GROUP_ORDER.map((group) =>
        group === "custom" ? (
          // Hidden entirely on clusters with no CRDs (and while disconnected).
          customKinds.length === 0 ? null : (
            <CustomSection
              key={group}
              kinds={customKinds}
              nav={nav}
              setNav={setNav}
              filterPlaceholder={t("chrome.sidebar.filterKinds")}
              emptyLabel={t("chrome.sidebar.noKinds")}
              customHeaderLabel={groupLabel("custom", locale)}
            />
          )
        ) : (
          <div key={group}>
            <div className={styles.sectionHeader}>{groupLabel(group, locale)}</div>
            {kindsInGroup(group).map((kind) => {
              const active = nav === kind;
              const meta = kindMeta(kind, customKinds);
              // Localised label (zh ships "Pod" not "Pods", "节点" not "Nodes");
              // falls back to the static KIND_META label and finally to the
              // raw id if neither resolves — same precedence as the topbar
              // breadcrumb, so a Chinese UI reads "工作负载 / Pod" not
              // "Workloads / Pods".
              const label = kindLabelFor(kind, customKinds, locale) ?? meta?.label ?? kind;
              return (
                <div
                  key={kind}
                  className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
                  onClick={() => setNav(kind)}
                >
                  <span className={styles.navIcon}>{meta?.icon}</span>
                  <span className={styles.navLabel}>{label}</span>
                  {/* Live count = number of rows currently in the store for this kind. */}
                  <span className={styles.navCount}>{rows[kind].length}</span>
                </div>
              );
            })}
          </div>
        ),
      )}
      {/* Feature overlays — Phase 1/2/4/5 of KubePi parity. Each one opens
          a full-width panel above the resource table; clicking the table
          again (or pressing Esc) closes it. */}
      <OverlaySection t={t} />
    </div>
  );
}

/** Sidebar entries for the feature overlays. Grouped under a single
 * "Tools" header so they don't pollute the regular kind nav. The Tier-1
 * entries (Helm Market, Pod Files, Image Registries, Templates) are
 * always shown; the Tier-2 entries (Dashboard, Metrics, Grafana,
 * Endpoints, Topology, Alerting) sit below a thin separator. */
function OverlaySection({ t }: { t: (k: string, fallback: string) => string }) {
  const overlay = useStore((s) => s.overlay);
  const openOverlay = useStore((s) => s.openOverlay);
  const closeOverlay = useStore((s) => s.closeOverlay);
  const items: Array<{ key: import("../../store").OverlayKey; label: string; icon: string }> = [
    { key: "helm-market", label: t("chrome.sidebar.tools.helmMarket", "Helm Market"), icon: "⎈" },
    { key: "pod-files", label: t("chrome.sidebar.tools.podFiles", "Pod Files"), icon: "▤" },
    { key: "image-repos", label: t("chrome.sidebar.tools.imageRepos", "Image Registries"), icon: "⬚" },
    { key: "templates", label: t("chrome.sidebar.tools.templates", "Templates"), icon: "✚" },
    { key: "dashboard", label: t("chrome.sidebar.tools.dashboard", "Dashboard"), icon: "◐" },
    { key: "metrics", label: t("chrome.sidebar.tools.metrics", "Metrics"), icon: "≋" },
    { key: "grafana", label: t("chrome.sidebar.tools.grafana", "Grafana"), icon: "▣" },
    { key: "endpoints", label: t("chrome.sidebar.tools.endpoints", "Endpoints"), icon: "⇆" },
    { key: "topology", label: t("chrome.sidebar.tools.topology", "Service Topology"), icon: "◌" },
    { key: "alerting", label: t("chrome.sidebar.tools.alerting", "Alerting"), icon: "△" },
  ];
  return (
    <div>
      <div className={styles.sectionHeader}>
        {t("chrome.sidebar.tools.header", "Tools")}
      </div>
      {items.map((it) => {
        const active = overlay === it.key;
        return (
          <div
            key={it.key}
            className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
            onClick={() => (active ? closeOverlay() : openOverlay(it.key))}
            title={active ? t("chrome.sidebar.tools.close", "Click to close") : it.label}
          >
            <span className={styles.navIcon}>{it.icon}</span>
            <span className={styles.navLabel}>{it.label}</span>
          </div>
        );
      })}
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
  const [filter, setFilter] = useState("");
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

  const toggle = (group: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  // While filtering, show every match: folds would hide the thing being searched for.
  const filtering = filter.trim() !== "";

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
        />
      )}

      {groups.map(([group, groupKinds]) => {
        const open = filtering || expanded.has(group);
        return (
          <div key={group}>
            <div className={styles.navGroup} onClick={() => toggle(group)} title={group}>
              <span className={styles.navGroupChevron}>{open ? "⌄" : "›"}</span>
              <span className={styles.navGroupLabel}>{group}</span>
              <span className={styles.navCount}>{groupKinds.length}</span>
            </div>
            {open &&
              groupKinds.map((ck) => {
                const active = nav === ck.id;
                return (
                  <div
                    key={ck.id}
                    className={`${styles.navItem} ${styles.navItemNested} ${
                      active ? styles.navItemActive : ""
                    }`}
                    onClick={() => setNav(ck.id)}
                    title={`${ck.kind} · ${ck.group}/${ck.version}`}
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
