/**
 * AiWelcome — shown when the chat is empty (first open or after clearing).
 * Introduces the AI assistant, lists capabilities, and offers example prompts.
 */
import styles from './AiChat.module.css';

interface Props {
  onExampleClick: (message: string) => void;
  aiEnabled: boolean;
}

const EXAMPLES = [
  { icon: '🔍', label: 'Diagnose a problem', message: 'What pods are in CrashLoopBackOff? Diagnose the root cause.' },
  { icon: '📋', label: 'List resources', message: 'List all deployments in the default namespace.' },
  { icon: '🏥', label: 'Health check', message: 'Check the overall cluster health.' },
  { icon: '⚡', label: 'Scale a workload', message: 'Scale the nginx deployment to 3 replicas.' },
];

export function AiWelcome({ onExampleClick, aiEnabled }: Props) {
  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeIcon}>✦</div>
      <h3 className={styles.welcomeTitle}>k7s AI Assistant</h3>
      <p className={styles.welcomeDesc}>
        Your Kubernetes operations assistant. I can read cluster state, diagnose
        problems, and execute operations — all through natural language.
      </p>

      {!aiEnabled && (
        <div className={styles.welcomeSetup}>
          <p>AI is not configured yet. Open <strong>Settings → AI Assistant</strong> to set up your LLM provider.</p>
        </div>
      )}

      <div className={styles.welcomeExamples}>
        <div className={styles.welcomeExamplesLabel}>Try asking:</div>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            className={styles.welcomeExampleBtn}
            onClick={() => onExampleClick(ex.message)}
            disabled={!aiEnabled}
          >
            <span className={styles.welcomeExampleIcon}>{ex.icon}</span>
            <span>{ex.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
