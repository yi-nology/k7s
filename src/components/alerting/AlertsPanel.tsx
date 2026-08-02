/**
 * AlertsPanel — list active alerts and silences from a configured
 * AlertManager (Phase 1 Tier-2 of KubePi parity).
 *
 * Read-only by design: we don't expose "create silence" or "edit rule"
 * because the canonical tools (`amtool`, the AlertManager web UI) are
 * better-suited to that, and a misclick on a "silence 4h" button is
 * the kind of operational footgun we shouldn't invite.
 */
import { useEffect, useState } from "react";
import { getProvider } from "../../providers";
import type { Alert, AlertManager, Silence } from "../../providers/types";
import { useTranslation } from "../../hooks/useI18n";
import styles from "./AlertsPanel.module.css";

export function AlertsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<AlertManager[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [silences, setSilences] = useState<Silence[]>([]);
  const [tab, setTab] = useState<"alerts" | "silences">("alerts");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProvider()
      .alertManagerList()
      .then((rows) => {
        setInstances(rows);
        if (rows.length > 0 && !selected) {
          setSelected(rows[0].name);
        }
      })
      .catch((e: unknown) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    setError(null);
    if (tab === "alerts") {
      getProvider()
        .alertManagerAlerts(selected)
        .then(setAlerts)
        .catch((e: unknown) => setError(String(e)));
    } else {
      getProvider()
        .alertManagerSilences(selected)
        .then(setSilences)
        .catch((e: unknown) => setError(String(e)));
    }
  }, [selected, tab]);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t("alerts.title", "Alerts")}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t("alerts.close", "Close")}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          {instances.length === 0 ? (
            <div className={styles.empty}>
              {t("alerts.none", "No AlertManager instances yet")}
            </div>
          ) : (
            <ul className={styles.list}>
              {instances.map((i) => (
                <li
                  key={i.name}
                  className={
                    selected === i.name ? styles.itemActive : styles.item
                  }
                  onClick={() => setSelected(i.name)}
                >
                  <div className={styles.itemName}>{i.name}</div>
                  <div className={styles.itemUrl}>{i.url}</div>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <main className={styles.main}>
          {selected ? (
            <>
              <div className={styles.tabs}>
                <button
                  className={tab === "alerts" ? styles.activeTab : styles.tab}
                  onClick={() => setTab("alerts")}
                >
                  {t("alerts.tabs.alerts", "Alerts")} ({alerts.length})
                </button>
                <button
                  className={
                    tab === "silences" ? styles.activeTab : styles.tab
                  }
                  onClick={() => setTab("silences")}
                >
                  {t("alerts.tabs.silences", "Silences")} ({silences.length})
                </button>
              </div>
              {tab === "alerts" ? (
                <AlertList alerts={alerts} />
              ) : (
                <SilenceList silences={silences} />
              )}
            </>
          ) : (
            <div className={styles.empty}>
              {t("alerts.pick", "Add an AlertManager instance to get started")}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AlertList({ alerts }: { alerts: Alert[] }) {
  const { t } = useTranslation();
  if (alerts.length === 0) {
    return (
      <div className={styles.empty}>
        {t("alerts.empty.alerts", "No active alerts")}
      </div>
    );
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t("alerts.cols.alert", "Alert")}</th>
          <th>{t("alerts.cols.severity", "Severity")}</th>
          <th>{t("alerts.cols.state", "State")}</th>
          <th>{t("alerts.cols.summary", "Summary")}</th>
          <th>{t("alerts.cols.activeSince", "Active since")}</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((a) => (
          <tr key={a.fingerprint}>
            <td>
              <div className={styles.alertName}>{a.name}</div>
              <div className={styles.alertLabels}>
                {Object.entries(a.labels)
                  .filter(([k]) => k !== "alertname")
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ")}
              </div>
            </td>
            <td>
              <span
                className={
                  a.severity === "critical"
                    ? styles.critical
                    : a.severity === "warning"
                      ? styles.warning
                      : styles.info
                }
              >
                {a.severity}
              </span>
            </td>
            <td>{a.state}</td>
            <td>{a.summary}</td>
            <td className={styles.mono}>{a.activeAt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SilenceList({ silences }: { silences: Silence[] }) {
  const { t } = useTranslation();
  if (silences.length === 0) {
    return (
      <div className={styles.empty}>
        {t("alerts.empty.silences", "No silences")}
      </div>
    );
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t("alerts.cols.matchers", "Matchers")}</th>
          <th>{t("alerts.cols.comment", "Comment")}</th>
          <th>{t("alerts.cols.createdBy", "Created by")}</th>
          <th>{t("alerts.cols.starts", "Starts")}</th>
          <th>{t("alerts.cols.ends", "Ends")}</th>
          <th>{t("alerts.cols.status", "Status")}</th>
        </tr>
      </thead>
      <tbody>
        {silences.map((s) => (
          <tr key={s.id}>
            <td className={styles.mono}>{s.matchers.join(", ")}</td>
            <td>{s.comment}</td>
            <td>{s.createdBy}</td>
            <td className={styles.mono}>{s.startsAt}</td>
            <td className={styles.mono}>{s.endsAt}</td>
            <td>{s.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
