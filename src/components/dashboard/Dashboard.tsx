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
import { useEffect, useState } from "react";
import { getProvider } from "../../providers";
import type { EventItem } from "../../providers/types";
import { useStore } from "../../store";
import { useTranslation } from "../../hooks/useI18n";
import styles from "./Dashboard.module.css";

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
  label: string;
  color: string;
}> = [
  { id: "pods", label: "Pods", color: "var(--accent)" },
  { id: "deployments", label: "Deployments", color: "#5cc8ff" },
  { id: "services", label: "Services", color: "#f7c948" },
  { id: "configmaps", label: "ConfigMaps", color: "#a78bfa" },
  { id: "secrets", label: "Secrets", color: "#fb7185" },
  { id: "jobs", label: "Jobs", color: "#34d399" },
  { id: "cronjobs", label: "CronJobs", color: "#fb923c" },
  { id: "nodes", label: "Nodes", color: "#22d3ee" },
  { id: "namespaces", label: "Namespaces", color: "#e879f9" },
];

export function Dashboard({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useTranslation();
  const connection = useStore((s) => s.connection);
  const rows = useStore((s) => s.rows);
  const nodeMetrics = useStore((s) => s.nodeMetrics);
  const setNav = useStore((s) => s.setNav);
  const [events, setEvents] = useState<EventItem[]>([]);

  // Pull a few recent events on mount. We don't subscribe — events arrive
  // often, and a dashboard that re-renders on every change is more noise
  // than signal here.
  useEffect(() => {
    getProvider()
      .getEvents({
        kind: "events",
        namespace: "all",
        name: "",
      })
      .then((es) => setEvents(es.slice(0, 12)))
      .catch(() => {
        // Service-unavailable in demo mode; ignore.
      });
  }, []);

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
            <span>CPU</span>
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
            <span>Memory</span>
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
        {RESOURCE_KINDS.map((k) => (
          <div
            key={k.id}
            className={styles.resourceCard}
            onClick={() => setNav(k.id)}
          >
            <div className={styles.resourceCount}>
              {rows[k.id]?.length ?? 0}
            </div>
            <div
              className={styles.resourceLabel}
              style={{ color: k.color }}
            >
              {k.label}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.eventsPanel}>
        <h3 className={styles.panelTitle}>
          {t("dashboard.events", "Recent events")}
        </h3>
        {events.length === 0 ? (
          <div className={styles.empty}>
            {t("dashboard.events.empty", "No recent events")}
          </div>
        ) : (
          <ul className={styles.eventList}>
            {events.map((e, i) => (
              <li
                key={i}
                className={
                  e.type === "Warning"
                    ? styles.eventWarn
                    : styles.eventNormal
                }
              >
                <span className={styles.eventReason}>{e.reason}</span>
                <span className={styles.eventMessage}>{e.message}</span>
                <span className={styles.eventTime}>{e.age}</span>
              </li>
            ))}
          </ul>
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
