/**
 * EditGuardDialog — shown when the user tries to navigate away while YAML is dirty.
 *
 * Reads `pendingDetail` from the store; when non-null, renders a ConfirmDialog.
 * Confirm replays the pending intent; Cancel stays in edit mode.
 */

import { useStore } from '../../store';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { useTranslation } from '../../hooks/useI18n';

export function EditGuardDialog() {
  const pending = useStore((s) => s.pendingDetail);
  const confirm = useStore((s) => s.confirmPendingDetail);
  const cancel = useStore((s) => s.cancelPendingDetail);
  const { t } = useTranslation();

  if (!pending) return null;

  return (
    <ConfirmDialog
      open
      onClose={cancel}
      onConfirm={confirm}
      title={t('yaml.unsavedTitle', 'Unsaved changes')}
      body={t(
        'yaml.unsavedBody',
        'You have unsaved YAML changes. Discard them and continue?'
      )}
      confirmLabel={t('yaml.discardAndContinue', 'Discard and continue')}
      cancelLabel={t('yaml.keepEditing', 'Keep editing')}
      danger
    />
  );
}
