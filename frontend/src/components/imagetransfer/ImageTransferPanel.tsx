/**
 * ImageTransferPanel — get images into an air-gapped (intranet, no public
 * internet) cluster. Two complementary paths, picked by a top tab bar:
 *
 *   • **To Node** — load a local `.tar` directly into a node's container runtime
 *     via a temporary privileged pod. For clusters with no internal registry.
 *   • **To Registry** — copy an image into a configured private registry via
 *     skopeo. For clusters that DO have an internal registry (Harbor/Nexus);
 *     all nodes then pull from it.
 *
 * The two paths exist because real air-gapped clusters fall into both camps.
 * See `docs/superpowers/specs/2026-08-06-image-transfer-design.md` §1 for why
 * they're complementary, not redundant.
 *
 * Desktop (Tauri) only — the web shell has no local-disk access. On web the
 * panel shows a notice instead of the form.
 */
import { useState } from 'react';
import { IS_TAURI } from '../../providers';
import { useTranslation } from '../../hooks/useI18n';
import styles from './ImageTransferPanel.module.css';
import { Header } from './Header';
import { ImportSection } from './ImportSection';
import { ExportSection } from './ExportSection';

type TopTab = 'import' | 'export';

export function ImageTransferPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [topTab, setTopTab] = useState<TopTab>('import');

  // Web shell: no local-disk access. Show a notice instead of the form.
  if (!IS_TAURI) {
    return (
      <div className={styles.panel}>
        <Header onClose={onClose} title={t('imageTransfer.title', 'Image Transfer')} t={t} />
        <div className={styles.notice}>
          {t('imageTransfer.desktopOnly', 'Image transfer is only available in the desktop app.')}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <Header onClose={onClose} title={t('imageTransfer.title', 'Image Transfer')} t={t} />

      <div className={styles.tabBar} role="tablist">
        <button type="button" role="tab" aria-selected={topTab === 'import'} className={styles.tabBtn} data-active={topTab === 'import'} onClick={() => setTopTab('import')}>
          {t('imageTransfer.tabImport', 'Import')}
        </button>
        <button type="button" role="tab" aria-selected={topTab === 'export'} className={styles.tabBtn} data-active={topTab === 'export'} onClick={() => setTopTab('export')}>
          {t('imageTransfer.tabExport', 'Export')}
        </button>
      </div>

      {topTab === 'import' ? <ImportSection onClose={onClose} /> : <ExportSection onClose={onClose} />}
    </div>
  );
}
