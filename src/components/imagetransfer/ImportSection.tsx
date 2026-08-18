/**
 * ImportSection — import tab for ImageTransferPanel.
 *
 * Switches between ToNodeSection and ToRegistrySection.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { ToNodeSection } from './ToNodeSection';
import { ToRegistrySection } from './ToRegistrySection';
import styles from './ImageTransferPanel.module.css';

export function ImportSection({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'to-node' | 'to-registry'>('to-node');
  return (
    <>
      <div className={styles.tabBar} role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'to-node'} className={styles.tabBtn} data-active={tab === 'to-node'} onClick={() => setTab('to-node')}>
          {t('imageTransfer.tabToNode', 'To Node')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'to-registry'} className={styles.tabBtn} data-active={tab === 'to-registry'} onClick={() => setTab('to-registry')}>
          {t('imageTransfer.tabToRegistry', 'To Registry')}
        </button>
      </div>
      {tab === 'to-node' ? <ToNodeSection onClose={onClose} /> : <ToRegistrySection onClose={onClose} />}
    </>
  );
}
