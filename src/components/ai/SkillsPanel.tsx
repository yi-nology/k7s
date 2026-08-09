/**
 * SkillsPanel — displays the k8s skill market inside the AI assistant panel.
 * Each skill card shows the name, description, and category; clicking one
 * activates it for the next chat message (injects prompt + filters tools).
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Skill } from '../../lib/ai/types';
import styles from './AiAssistantPanel.module.css';

interface Props {
  /** Currently-active skill id (highlighted). */
  activeId?: string;
  /** Called when the user selects a skill. Pass `undefined` to deactivate. */
  onSelect: (skillId: string | undefined) => void;
}

export function SkillsPanel({ activeId, onSelect }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<Skill[]>('ai_list_skills')
      .then(setSkills)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.empty}>Loading skills…</div>;

  // Group by category.
  const groups = new Map<string, Skill[]>();
  for (const s of skills) {
    const cat = s.category || 'general';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(s);
  }

  return (
    <div className={styles.body}>
      <div className={styles.empty}>
        Select a skill to pre-load its strategy for the next chat message.
      </div>
      {[...groups.entries()].map(([cat, list]) => (
        <div key={cat}>
          <div className={styles.toolHeader}>
            <span className={styles.toolName} style={{ textTransform: 'capitalize' }}>
              {cat}
            </span>
          </div>
          {list.map((skill) => {
            const isActive = skill.id === activeId;
            return (
              <div
                key={skill.id}
                className={`${styles.toolCard} ${isActive ? styles.tool_ok : ''}`}
                style={{ cursor: 'pointer', marginBottom: 6 }}
                onClick={() => onSelect(isActive ? undefined : skill.id)}
              >
                <div className={styles.toolHeader}>
                  <span className={styles.toolName}>{skill.name}</span>
                  {isActive && (
                    <span className={styles.toolState} style={{ color: 'var(--ok, #22c55e)' }}>
                      active
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>{skill.description}</div>
                {skill.toolWhitelist.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                    Tools: {skill.toolWhitelist.join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
