/**
 * Header — shared header component for ImageTransferPanel.
 *
 * Shows a title and an optional close button.
 */

import styles from './ImageTransferPanel.module.css';

export function Header({
  title,
  onClose,
  t,
}: {
  title: string;
  onClose?: () => void;
  t: (k: string, fallback: string) => string;
}) {
  return (
    <header className={styles.header}>
      <h2>{title}</h2>
      {onClose && (
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t('imageTransfer.close', 'Close')}
        >
          ×
        </button>
      )}
    </header>
  );
}
