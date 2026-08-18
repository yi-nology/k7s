/**
 * RuleList — displays alerting rules from Prometheus /api/v1/rules.
 */

import { useTranslation } from '../../hooks/useI18n';
import type { RuleGroup } from '../../providers/types';
import styles from './AlertsPanel.module.css';

export function RuleList({ groups }: { groups: RuleGroup[] }) {
  const { t } = useTranslation();
  if (groups.length === 0) {
    return <div className={styles.empty}>{t('alerts.rules.empty', 'No alerting rules found')}</div>;
  }
  return (
    <div>
      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--text-muted)',
              marginBottom: 4,
            }}
          >
            {g.name}
            {g.file && <span style={{ fontWeight: 400, marginLeft: 8 }}>{g.file}</span>}
          </div>
          {g.rules.length === 0 ? (
            <div className={styles.empty} style={{ fontSize: 11 }}>
              {t('alerts.rules.noRules', 'No alerting rules in this group')}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('alerts.rules.cols.name', 'Name')}</th>
                  <th>{t('alerts.rules.cols.severity', 'Severity')}</th>
                  <th>{t('alerts.rules.cols.state', 'State')}</th>
                  <th>{t('alerts.rules.cols.for', 'For')}</th>
                  <th>{t('alerts.rules.cols.query', 'Query')}</th>
                </tr>
              </thead>
              <tbody>
                {g.rules.map((r) => (
                  <tr key={r.name}>
                    <td>{r.name}</td>
                    <td>
                      <span
                        className={
                          r.severity === 'critical'
                            ? styles.critical
                            : r.severity === 'warning'
                              ? styles.warning
                              : styles.info
                        }
                      >
                        {r.severity || '—'}
                      </span>
                    </td>
                    <td>{r.state}</td>
                    <td>{r.duration > 0 ? `${r.duration}s` : '—'}</td>
                    <td
                      className={styles.mono}
                      style={{
                        maxWidth: 300,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={r.query}
                    >
                      {r.query}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
