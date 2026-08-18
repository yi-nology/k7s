/**
 * ExportSection — export tab for ImageTransferPanel.
 *
 * Switches between FromNodeSection and FromRegistrySection.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { FromNodeSection } from './FromNodeSection';
import { FromRegistrySection } from './FromRegistrySection';
import styles from './ImageTransferPanel.module.css';

export function ExportSection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'from-node' | 'from-registry'>('from-node');
  return (
    <>
      <div className={styles.tabBar} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'from-node'} className={styles.tabBtn} data-active={tab === 'from-node'} onClick={() => setTab('from-node')}>
          {t('imageTransfer.tabFromNode', 'From Node')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'from-registry'} className={styles.tabBtn} data-active={tab === 'from-registry'} onClick={() => setTab('from-registry')}>
          {t('imageTransfer.tabFromRegistry', 'From Registry')}
        </button>
      </div>
      {tab === 'from-node' ? <FromNodeSection onClose={onClose} /> : <FromRegistrySection onClose={onClose} />}
    </>
  );
}
