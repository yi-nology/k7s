/**
 * ReasoningBlock — collapsible reasoning block for AI chat.
 *
 * Shows the AI's thinking process in a collapsible section.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import styles from './AiChat.module.css';

export function ReasoningBlock({
  text,
  defaultExpanded = false,
}: {
  text: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { t } = useTranslation();
  return (
    <div className={styles.reasoningBlock}>
      <button
        type="button"
        className={styles.reasoningToggle}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>💭 {t('ai.chat.thinking')}</span>
        <span className={styles.reasoningLen}>{text.length} chars</span>
      </button>
      {expanded && <div className={styles.reasoningContent}>{text}</div>}
    </div>
  );
}
