/**
 * SilenceList — displays a list of silences with expire and create actions.
 */

import { useTranslation } from '../../hooks/useI18n';
import type { Silence } from '../../providers/types';
import styles from './AlertsPanel.module.css';

export function SilenceList({
  silences,
  onExpire,
  onCreate,
}: {
  silences: Silence[];
  onExpire: (id: string) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <button type="button" className={styles.btn} onClick={onCreate}>
          {t('alerts.silences.create', 'Create Silence…')}
        </button>
      </div>
      {silences.length === 0 ? (
        <div className={styles.empty}>{t('alerts.empty.silences', 'No silences')}</div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('alerts.cols.matchers', 'Matchers')}</th>
              <th>{t('alerts.cols.comment', 'Comment')}</th>
              <th>{t('alerts.cols.createdBy', 'Created by')}</th>
              <th>{t('alerts.cols.starts', 'Starts')}</th>
              <th>{t('alerts.cols.ends', 'Ends')}</th>
              <th>{t('alerts.cols.status', 'Status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {silences.map((s) => (
              <tr key={s.id}>
                <td className={styles.mono}>{s.matchers.join(', ')}</td>
                <td>{s.comment}</td>
                <td>{s.createdBy}</td>
                <td className={styles.mono}>{s.startsAt}</td>
                <td className={styles.mono}>{s.endsAt}</td>
                <td>{s.status}</td>
                <td>
                  {s.status === 'active' && (
                    <button type="button" className={styles.btn} onClick={() => onExpire(s.id)}>
                      {t('alerts.silences.expire', 'Expire')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
