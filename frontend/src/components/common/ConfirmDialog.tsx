/**
 * Confirmation dialog — replaces native confirm() throughout the app.
 *
 * Two variants:
 * - danger: red confirm button (destructive actions like delete, discard)
 * - default: accent-colored confirm button
 */

import { Dialog } from './Dialog';
import styles from './ConfirmDialog.module.css';
import { useTranslation } from '../../hooks/useI18n';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm">
      <p className={styles.body}>{body}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.cancelBtn} onClick={onClose}>
          {cancelLabel ?? t('common.cancel', 'Cancel')}
        </button>
        <button
          type="button"
          className={danger ? styles.dangerBtn : styles.confirmBtn}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel ?? t('common.confirm', 'Confirm')}
        </button>
      </div>
    </Dialog>
  );
}
