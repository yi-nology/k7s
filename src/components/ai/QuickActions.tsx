/**
 * QuickActions — context-sensitive action pills above the chat input.
 *
 * Shows different actions based on whether the user has a resource selected:
 * - No selection: cluster-level actions (health check, list nodes, etc.)
 * - Resource selected: resource-level actions (diagnose, events, logs, etc.)
 */
import type { SelectedContext } from '../../lib/ai/types';
import styles from './AiChat.module.css';

interface Props {
  selectedContext?: SelectedContext;
  onAction: (message: string) => void;
  disabled: boolean;
}

const CLUSTER_ACTIONS = [
  { label: '🏥 Cluster health', message: 'Check the overall cluster health and list any problems.' },
  { label: '📋 List nodes', message: 'List all nodes in the cluster with their status.' },
  { label: '🔍 Find CrashLoop pods', message: 'Find all pods in CrashLoopBackOff or ImagePullBackOff across all namespaces.' },
  { label: '📊 Resource pressure', message: 'Which namespaces are using the most CPU and memory?' },
];

const RESOURCE_ACTIONS = [
  { label: '🔍 Diagnose', message: '' },  // filled dynamically
  { label: '📋 Events', message: '' },
  { label: '📄 Logs', message: '' },
  { label: '📝 Describe', message: '' },
];

export function QuickActions({ selectedContext, onAction, disabled }: Props) {
  const hasContext = selectedContext?.kind && selectedContext?.name;

  if (!hasContext) {
    return (
      <div className={styles.quickActions}>
        {CLUSTER_ACTIONS.map((a) => (
          <button
            key={a.label}
            type="button"
            className={styles.quickActionBtn}
            onClick={() => onAction(a.message)}
            disabled={disabled}
            title={disabled ? 'Enable AI in Settings first' : a.message}
          >
            {a.label}
          </button>
        ))}
      </div>
    );
  }

  const kind = selectedContext!.kind!;
  const ns = selectedContext!.namespace || 'default';
  const name = selectedContext!.name!;

  const actions = RESOURCE_ACTIONS.map((a) => {
    switch (a.label) {
      case '🔍 Diagnose':
        return { ...a, message: `Diagnose ${kind}/${name} in namespace ${ns}. Check events, conditions, and logs to find the root cause of any issues.` };
      case '📋 Events':
        return { ...a, message: `Show the recent events for ${kind}/${name} in namespace ${ns}.` };
      case '📄 Logs':
        return { ...a, message: `Get the logs for ${kind}/${name} in namespace ${ns}. Show the last 50 lines.` };
      case '📝 Describe':
        return { ...a, message: `Describe ${kind}/${name} in namespace ${ns}. Show the full status and conditions.` };
      default:
        return a;
    }
  });

  return (
    <div className={styles.quickActions}>
      <div className={styles.contextBadge}>
        {kind}/{name}
        {selectedContext!.namespace && <span className={styles.contextNs}> in {selectedContext!.namespace}</span>}
      </div>
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          className={styles.quickActionBtn}
          onClick={() => onAction(a.message)}
          disabled={disabled}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
