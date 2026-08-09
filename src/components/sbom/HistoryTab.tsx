import { useState, useEffect } from 'react';
import { formatError, getProvider } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import type { SbomSummary, SbomResult } from '../../providers/types/sbom';

interface Props {
  onSelect: (sbom: SbomResult) => void;
}

export function HistoryTab({ onSelect }: Props) {
  const { t } = useTranslation();
  const [history, setHistory] = useState<SbomSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getProvider()
      .sbomListHistory()
      .then(setHistory)
      .catch((e) => setError(formatError(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = async (id: string) => {
    try {
      setError('');
      const sbom = await getProvider().sbomGet(id);
      onSelect(sbom);
    } catch (e) {
      setError(t('sbom.historyLoadFailed', String(e)));
    }
  };

  if (loading) return <div>{t('sbom.history.loading', 'Loading...')}</div>;

  return (
    <div>
      {error && (
        <div
          style={{
            padding: 8,
            background: 'var(--status-err-soft)',
            color: 'var(--status-err)',
            borderRadius: 4,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}
      {history.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: 32 }}>
          {t('sbom.history.empty', 'No SBOM history yet')}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 12px' }}>{t('sbom.history.source', 'Source')}</th>
              <th style={{ padding: '8px 12px' }}>{t('sbom.history.format', 'Format')}</th>
              <th style={{ padding: '8px 12px' }}>{t('sbom.history.components', 'Components')}</th>
              <th style={{ padding: '8px 12px' }}>{t('sbom.history.vulns', 'Vulns')}</th>
              <th style={{ padding: '8px 12px' }}>{t('sbom.history.tool', 'Tool')}</th>
              <th style={{ padding: '8px 12px' }}>{t('sbom.history.date', 'Date')}</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr
                key={item.id}
                onClick={() => handleSelect(item.id)}
                style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
              >
                <td style={{ padding: '8px 12px' }}>
                  {item.source.kind === 'image'
                    ? item.source.imageRef
                    : `Cluster: ${item.source.context}`}
                </td>
                <td style={{ padding: '8px 12px' }}>{item.format.toUpperCase()}</td>
                <td style={{ padding: '8px 12px' }}>{item.componentCount}</td>
                <td style={{ padding: '8px 12px' }}>{item.vulnerabilityCount}</td>
                <td style={{ padding: '8px 12px' }}>{item.tool}</td>
                <td style={{ padding: '8px 12px' }}>{new Date(item.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
