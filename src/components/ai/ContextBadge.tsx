/**
 * ContextBadge — context injection badge for AI chat.
 *
 * Shows what context was injected into the AI prompt.
 */

import styles from './AiChat.module.css';

export function ContextBadge({
  blockType,
  summary,
}: {
  blockType: string;
  summary: string;
}) {
  const icons: Record<string, string> = {
    skill: '⚡',
    memory: '🧠',
    evolution: '📈',
    sandbox: '🔒',
    preferences: '⚙️',
  };
  return (
    <div className={styles.contextBadge}>
      <span>{icons[blockType] || '📋'}</span>
      <span>{summary}</span>
    </div>
  );
}
