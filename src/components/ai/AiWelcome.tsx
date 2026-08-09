/**
 * AiWelcome — shown when the chat is empty (first open or after clearing).
 * Introduces the AI assistant, lists capabilities, and offers example prompts.
 */
import styles from './AiChat.module.css';
import { useTranslation } from '../../hooks/useI18n';

interface Props {
  onExampleClick: (message: string) => void;
  aiEnabled: boolean;
}

export function AiWelcome({ onExampleClick, aiEnabled }: Props) {
  const { t } = useTranslation();

  const examples = [
    { icon: '🔍', label: t('ai.welcome.diagnose'), message: t('ai.welcome.diagnoseMsg') },
    { icon: '📋', label: t('ai.welcome.listResources'), message: t('ai.welcome.listResourcesMsg') },
    { icon: '🏥', label: t('ai.welcome.healthCheck'), message: t('ai.welcome.healthCheckMsg') },
    { icon: '⚡', label: t('ai.welcome.scaleWorkload'), message: t('ai.welcome.scaleWorkloadMsg') },
  ];

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeIcon}>✦</div>
      <h3 className={styles.welcomeTitle}>{t('ai.welcome.title')}</h3>
      <p className={styles.welcomeDesc}>
        {t('ai.welcome.description')}
      </p>

      {!aiEnabled && (
        <div className={styles.welcomeSetup}>
          <p>{t('ai.welcome.notConfigured')}</p>
        </div>
      )}

      <div className={styles.welcomeExamples}>
        <div className={styles.welcomeExamplesLabel}>{t('ai.welcome.tryAsking')}</div>
        {examples.map((ex) => (
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
