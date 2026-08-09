/**
 * AiStatusBar — compact status line at the bottom of the AI panel.
 * Shows: model name, connection status, permission mode.
 */
import type { AiConfigView } from '../../lib/ai/types';
import styles from './AiChat.module.css';

interface Props {
  config: AiConfigView | null;
  connected: boolean;
  contextName: string;
}

const PERMISSION_LABELS: Record<string, string> = {
  readOnly: 'Read only',
  readConfirmWrite: 'Writes need approval',
  fullAuto: 'Full auto',
};

export function AiStatusBar({ config, connected, contextName }: Props) {
  const model = config?.provider?.model || 'Not configured';
  const permission = config ? PERMISSION_LABELS[config.permission] || config.permission : '';

  return (
    <div className={styles.statusBar}>
      <span className={styles.statusDot} data-connected={connected} />
      <span className={styles.statusModel}>{model}</span>
      {connected && contextName && (
        <span className={styles.statusContext}>· {contextName}</span>
      )}
      {permission && (
        <span className={styles.statusPermission}>· {permission}</span>
      )}
    </div>
  );
}
