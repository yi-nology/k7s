/**
 * AlertList — displays a list of active alerts.
 */

import { useTranslation } from '../../hooks/useI18n';
import type { Alert } from '../../providers/types';
import styles from './AlertsPanel.module.css';

export function AlertList({ alerts }: { alerts: Alert[] }) {
  const { t } = useTranslation();
  if (alerts.length === 0) {
    return <div className={styles.empty}>{t('alerts.empty.alerts', 'No active alerts')}</div>;
  }
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('alerts.cols.alert', 'Alert')}</th>
          <th>{t('alerts.cols.severity', 'Severity')}</th>
          <th>{t('alerts.cols.state', 'State')}</th>
          <th>{t('alerts.cols.summary', 'Summary')}</th>
          <th>{t('alerts.cols.activeSince', 'Active since')}</th>
        </tr>
      </thead>
      <tbody>
        {alerts.map((a) => (
          <tr key={a.fingerprint}>
            <td>
              <div className={styles.alertName}>{a.name}</div>
              <div className={styles.alertLabels}>
                {Object.entries(a.labels)
                  .filter(([k]) => k !== 'alertname')
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' ')}
              </div>
            </td>
            <td>
              <span
                className={
                  a.severity === 'critical'
                    ? styles.critical
                    : a.severity === 'warning'
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
