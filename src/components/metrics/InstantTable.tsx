/**
 * InstantTable — displays instant query results in a table format.
 */

import { useTranslation } from '../../hooks/useI18n';
import type { PromQueryResult } from '../../providers/types';
import styles from './MetricsExplorer.module.css';

export function InstantTable({ series }: { series: PromQueryResult['series'] }) {
  const { t } = useTranslation();
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>{t('metricsExplorer.instantTable.series')}</th>
          <th>{t('metricsExplorer.instantTable.value')}</th>
        </tr>
      </thead>
      <tbody>
        {series.map((s, i) => {
          const label = Object.entries(s.metric)
            .filter(([k]) => k !== '__name__')
            .map(([k, v]) => `${k}=${v}`)
            .join(', ');
          const value = s.samples.at(-1)?.value ?? 0;
          return (
            <tr key={i}>
              <td className={styles.mono}>
                {s.metric.__name__ ?? ''}
                {label ? ` {${label}}` : ''}
              </td>
              <td className={styles.mono}>{value}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
