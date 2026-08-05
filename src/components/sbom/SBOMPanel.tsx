import { useState } from 'react';
import { X, Download } from 'lucide-react';
import { useTranslation } from '../../hooks/useI18n';
import { getProvider } from '../../providers';
import type { SbomResult } from '../../providers/types/sbom';
import { ImageSBOMTab } from './ImageSBOMTab';
import { HistoryTab } from './HistoryTab';
import styles from './SBOMPanel.module.css';

type Tab = 'image' | 'cluster' | 'history';

export function SBOMPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('image');
  const [sbom, setSbom] = useState<SbomResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleExport = async () => {
    if (!sbom) return;
    setError(null);
    setSuccess(null);
    try {
      // Let the backend determine the appropriate temp directory for the platform
      const path = await getProvider().sbomExport(sbom.id, `sbom-${sbom.id}.json`);
      setSuccess(`Exported to: ${path}`);
    } catch (e) {
      setError(`Export failed: ${e}`);
    }
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('sbom.title', 'SBOM')}</h2>
        <div className={styles.tabs}>
          <button className={tab === 'image' ? styles.activeTab : ''} onClick={() => setTab('image')}>
            {t('sbom.tab.image', 'Image')}
          </button>
          <button className={tab === 'cluster' ? styles.activeTab : ''} onClick={() => setTab('cluster')}>
            {t('sbom.tab.cluster', 'Cluster')}
            <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.6 }}>{t('sbom.tab.comingSoon', '(coming soon)')}</span>
          </button>
          <button className={tab === 'history' ? styles.activeTab : ''} onClick={() => setTab('history')}>
            {t('sbom.tab.history', 'History')}
          </button>
        </div>
        <div className={styles.actions}>
          <button onClick={handleExport} title="Export"><Download size={16} /></button>
          {onClose && <button onClick={onClose}><X size={16} /></button>}
        </div>
      </header>
      {error && <div style={{ padding: '6px 12px', background: 'var(--status-err-soft, #fee)', color: 'var(--status-err, #c00)', fontSize: 13 }}>{error}</div>}
      {success && <div style={{ padding: '6px 12px', background: 'var(--status-ok-soft, #efe)', color: 'var(--status-ok, #0a0)', fontSize: 13 }}>{success}</div>}
      <div className={styles.body}>
        {tab === 'image' && <ImageSBOMTab onResult={setSbom} />}
        {tab === 'cluster' && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p>{t('sbom.cluster.comingSoon', 'Cluster-wide SBOM scanning is coming soon.')}</p>
            <p style={{ fontSize: 13, marginTop: 8 }}>{t('sbom.cluster.useImage', 'Use the Image tab to scan individual images for now.')}</p>
          </div>
        )}
        {tab === 'history' && <HistoryTab onSelect={setSbom} />}
      </div>
    </div>
  );
}
