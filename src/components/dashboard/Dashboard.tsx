/**
 * Dashboard — the cluster overview page.
 *
 * The first thing the user sees when they connect: a glanceable summary
 * of the active cluster. The pieces:
 *
 *   - Cluster info card (name, version, context, server).
 *   - CPU / memory utilisation bars fed by the live poller in the
 *     backend (already published as `node-metrics` events).
 *   - A row of resource-count cards (one per kind) that link to the
 *     corresponding table.
 *   - The cluster's recent events, so a `CrashLoopBackOff` or a
 *     `FailedScheduling` doesn't get missed.
 *
 * Why a separate route rather than a sidebar entry: the dashboard
 * *is* the home view, set as the default `nav` when the app boots.
 */
import { useMemo, useState } from "react";
import { useStore } from "../../store";
import { useTranslation } from "../../hooks/useI18n";
import { kindLabelFor } from "../../lib/i18n";
import styles from "./Dashboard.module.css";

/**
 * The nine resource cards the dashboard surfaces. Order is intentional — it
 * matches the sidebar's group order (workloads, network, config, cluster) so a
 * user who's been clicking around the sidebar lands on the dashboard and sees
 * the same row they just left.
 *
 * The label is *not* stored here. It's resolved per render through
 * `kindLabelFor()` so a Chinese UI shows `Pod / Deployment / Service / …` and
 * the English UI shows `Pods / Deployments / Services / …` — the canonical
 * kind names the rest of the chrome uses. A new kind added to this list still
 * shows up correctly (the helper falls back to the static `KIND_META` label
 * when the i18n registry doesn't have one yet).
 */
const RESOURCE_KINDS: Array<{
  id:
    | "pods"
    | "deployments"
    | "services"
    | "configmaps"
    | "secrets"
    | "jobs"
    | "cronjobs"
    | "nodes"
    | "namespaces";
  color: string;
}> = [
  { id: "pods", color: "var(--accent)" },
  { id: "deployments", color: "#5cc8ff" },
  { id: "services", color: "#f7c948" },
  { id: "configmaps", color: "#a78bfa" },
  { id: "secrets", color: "#fb7185" },
  { id: "jobs", color: "#34d399" },
  { id: "cronjobs", color: "#fb923c" },
  { id: "nodes", color: "#22d3ee" },
  { id: "namespaces", color: "#e879f9" },
];

export function Dashboard({ onClose }: { onClose?: () => void } = {}) {
  const { t, locale } = useTranslation();
  const connection = useStore((s) => s.connection);
  const rows = useStore((s) => s.rows);
  const nodeMetrics = useStore((s) => s.nodeMetrics);
  const setNav = useStore((s) => s.setNav);
  const closeOverlay = useStore((s) => s.closeOverlay);

  // Recent events come straight from the live watcher snapshot in the store
  // (the same feed the Cluster → Events table renders), not from a one-shot
  // get_events fetch. The fetch path queried `involvedObject.name=""` which
  // matches nothing, so the panel was always empty; the watcher already has
  // the cluster-wide, newest-first, cap-500 list, so reusing it is both
  // correct and real-time.
  const events = rows.events ?? [];

  // Pagination over the events list. The watcher caps at 500 and the panel
  // showed only the first 12; paging lets you reach the rest without leaving
  // the dashboard. State resets to 0 when the event count shrinks below the
  // current page's window (events expire, a new watch snapshot arrives) so the
  // viewport never points past the end.
  const PAGE_SIZE = 12;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageEvents = useMemo(
    () => events.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [events, safePage],
  );

  // Aggregate node CPU/MEM across all known nodes.
  const cpuPercent = aggregatePercent(
    Object.values(nodeMetrics).map((n) => n.cpuPercent),
  );
  const memPercent = aggregatePercent(
    Object.values(nodeMetrics).map((n) => n.memPercent),
  );

  return (
    <div className={styles.dashboard}>
      {onClose && (
        <header className={styles.header}>
          <h2>{t("dashboard.title", "Dashboard")}</h2>
          <button className={styles.close} onClick={onClose}>
            {t("dashboard.close", "Close")}
          </button>
        </header>
      )}
      <div className={styles.infoCard}>
        <div>
          <div className={styles.infoLabel}>{t("dashboard.cluster", "Cluster")}</div>
          <div className={styles.infoValue}>
            {connection.context ?? "—"}
          </div>
        </div>
        <div>
          <div className={styles.infoLabel}>{t("dashboard.phase", "Status")}</div>
          <div className={styles.infoValue}>{connection.phase}</div>
        </div>
        <div>
          <div className={styles.infoLabel}>{t("dashboard.nodes", "Nodes")}</div>
          <div className={styles.infoValue}>
            {Object.keys(nodeMetrics).length || rows.nodes.length}
          </div>
        </div>
      </div>

      <div className={styles.utilisation}>
        <div className={styles.meter}>
          <div className={styles.meterHeader}>
            <span>{t("dashboard.cpu", "CPU")}</span>
            <span>{cpuPercent.toFixed(0)}%</span>
          </div>
          <div className={styles.barOuter}>
            <div
              className={styles.barInner}
              style={{
                width: `${Math.min(100, cpuPercent)}%`,
                background: meterColor(cpuPercent),
              }}
            />
          </div>
        </div>
        <div className={styles.meter}>
          <div className={styles.meterHeader}>
            <span>{t("dashboard.mem", "Memory")}</span>
            <span>{memPercent.toFixed(0)}%</span>
          </div>
          <div className={styles.barOuter}>
            <div
              className={styles.barInner}
              style={{
                width: `${Math.min(100, memPercent)}%`,
                background: meterColor(memPercent),
              }}
            />
          </div>
        </div>
      </div>

      <div className={styles.resourceGrid}>
        {RESOURCE_KINDS.map((k) => {
          // kindLabelFor falls back to the static KIND_META label if the
          // i18n registry ever drops a kind, so a future refactor that
          // adds a kind here without adding it to the registry still
          // renders something readable (the canonical English name) — not
          // a blank tile.
          const label = kindLabelFor(k.id, [], locale) ?? k.id;
          return (
            <div
              key={k.id}
              className={styles.resourceCard}
              onClick={() => {
                // Jump to the kind's table — closing the overlay so the
                // table is actually visible behind it. setNav alone would
                // change the active kind but leave the dashboard covering
                // everything, which was the point of the audit fix.
                setNav(k.id);
                if (onClose) onClose();
                else closeOverlay();
              }}
            >
              <div className={styles.resourceCount}>
                {rows[k.id]?.length ?? 0}
              </div>
              <div
                className={styles.resourceLabel}
                style={{ color: k.color }}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>

      <div className={styles.eventsPanel}>
        <h3 className={styles.panelTitle}>
          {t("dashboard.events", "Recent events")}
        </h3>
        {events.length === 0 ? (
          <div className={styles.empty}>
            {t("dashboard.eventsEmpty", "No recent events")}
          </div>
        ) : (
          <>
            <ul className={styles.eventList}>
              {pageEvents.map((e) => {
                // Row cells from map_event: [TYPE, REASON, OBJECT, NS, AGE, COUNT, MESSAGE].
                const cells = e.cells;
                const type = cells[0]?.text ?? "Normal";
                const reason = cells[1]?.text ?? "";
                const message = cells[6]?.text ?? "";
                const age = cells[4]?.text ?? "";
                return (
                  <li
                    key={e.uid ?? `${reason}-${message}`}
                    className={
                      type === "Warning"
                        ? styles.eventWarn
                        : styles.eventNormal
                    }
                  >
                    <span className={styles.eventReason}>{reason}</span>
                    <span className={styles.eventMessage}>{message}</span>
                    <span className={styles.eventTime}>{age}</span>
                  </li>
                );
              })}
            </ul>
            {pageCount > 1 && (
              <div className={styles.pager}>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                >
                  {t("dashboard.eventsPrev", "‹ Prev")}
                </button>
                <span className={styles.pagerInfo}>
                  {safePage + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  className={styles.pagerBtn}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage === pageCount - 1}
                >
                  {t("dashboard.eventsNext", "Next ›")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function aggregatePercent(perNode: number[]): number {
  if (perNode.length === 0) return 0;
  const sum = perNode.reduce((a, b) => a + b, 0);
  return sum / perNode.length;
}

function meterColor(p: number): string {
  if (p < 60) return "var(--status-ok)";
  if (p < 85) return "var(--status-warn)";
  return "var(--status-err)";
}
