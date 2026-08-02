/**
 * Status bar (Design §5): connection indicator, API latency, nodes ready, cluster
 * CPU/MEM %, and the active kubectl context. Values come from `cluster-status`;
 * CPU/MEM show "—" when metrics are unavailable.
 *
 * v2 — every fact is a labeled "key value" pair with the value in the strong
 * text color, separated by a faint middle dot. Reads as a single row of
 * cluster facts rather than a wall of labels.
 */

import styles from "./StatusBar.module.css";
import { useStore } from "../../store";

export function StatusBar() {
  const connection = useStore((s) => s.connection);
  const status = useStore((s) => s.clusterStatus);

  const connected = connection.phase === "connected";
  const cluster = connection.clusterName ?? connection.context ?? "k7s";
  const ctx = connection.context ?? null;

  // Percent values render "—" when metrics are absent (null).
  const cpu = status?.cpuPercent ?? null;
  const mem = status?.memPercent ?? null;
  const ready = status?.nodesReady ?? 0;
  const total = status?.nodesTotal ?? 0;
  const api = status ? status.apiLatencyMs : null;

  return (
    <div className={styles.statusbar}>
      <span className={styles.cluster}>
        <span
          className={styles.clusterDot}
          style={{ background: connected ? "var(--status-ok)" : "var(--status-err)" }}
        />
        {cluster}
      </span>
      <Sep />
      <span className={styles.fact}>
        api <b>{api == null ? "—" : `${api}ms`}</b>
      </span>
      <Sep />
      <span className={styles.fact}>
        nodes <b>{ready}/{total}</b> ready
      </span>
      <Sep />
      <span className={styles.fact}>
        cpu <b>{cpu == null ? "—" : `${cpu}%`}</b>
      </span>
      <Sep />
      <span className={styles.fact}>
        mem <b>{mem == null ? "—" : `${mem}%`}</b>
      </span>
      <div className={styles.spacer} />
      <span className={styles.ctx}>
        kubectl ctx: <b>{ctx ?? "—"}</b>
      </span>
    </div>
  );
}

/** Middle-dot separator between facts. Plain <span> so it can sit in the flex row. */
function Sep() {
  return <span className={styles.sep}>·</span>;
}
