/**
 * Status bar (Design §5): connection indicator, API latency, nodes ready, cluster
 * CPU/MEM %, and the active kubectl context. Values come from `cluster-status`;
 * CPU/MEM show "—" when metrics are unavailable.
 */

import styles from "./StatusBar.module.css";
import { useStore } from "../../store";
import { useTranslation } from "../../hooks/useI18n";

export function StatusBar() {
  const connection = useStore((s) => s.connection);
  const status = useStore((s) => s.clusterStatus);
  const { t } = useTranslation();

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
      <span
        className={styles.cluster}
        style={{ color: connected ? "var(--status-ok)" : "var(--status-err)" }}
      >
        ● {cluster}
      </span>
      <span>{t("chrome.statusbar.api", api)}</span>
      <span>{t("chrome.statusbar.nodes", ready, total)}</span>
      <span>{t("chrome.statusbar.cpu", cpu)}</span>
      <span>{t("chrome.statusbar.mem", mem)}</span>
      <div className={styles.spacer} />
      <span>{t("chrome.statusbar.kubectlCtx", ctx)}</span>
    </div>
  );
}
