import { useState } from 'react';
import { X, Download } from 'lucide-react';
import { useTranslation } from '../../hooks/useI18n';
import { getProvider } from '../../providers';
import type { SbomResult } from '../../providers/types/sbom';
import { ImageSBOMTab } from './ImageSBOMTab';
import { ClusterSBOMTab } from './ClusterSBOMTab';
import { HistoryTab } from './HistoryTab';
import styles from './SBOMPanel.module.css';

type Tab = 'image' | 'cluster' | 'history';

export function SBOMPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('image');
  const [sbom, setSbom] = useState<SbomResult | null>(null);

  const handleExport = async () => {
    if (!sbom) return;
    try {
      const path = await getProvider().sbomExport(sbom.id, `/tmp/sbom-${sbom.id}.json`);
      alert(`Exported to: ${path}`);
    } catch (e) {
      alert(`Export failed: ${e}`);
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
      <div className={styles.body}>
        {tab === 'image' && <ImageSBOMTab onResult={setSbom} />}
        {tab === 'cluster' && <ClusterSBOMTab onResult={setSbom} />}
        {tab === 'history' && <HistoryTab onSelect={setSbom} />}
      </div>
    </div>
  );
}
