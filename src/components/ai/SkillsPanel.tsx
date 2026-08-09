/**
 * SkillsPanel — displays the k8s skill market inside the AI assistant panel.
 * Each skill card shows the name, description, and category; clicking one
 * activates it for the next chat message (injects prompt + filters tools).
 */
import { useEffect, useState } from 'react';
import { getProvider } from '../../providers';
import type { Skill } from '../../lib/ai/types';
import styles from './AiChat.module.css';

interface Props {
  activeId?: string;
  onSelect: (skillId: string | undefined) => void;
}

export function SkillsPanel({ activeId, onSelect }: Props) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProvider()
      .aiListSkills()
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
                className={`${styles.toolCard} ${isActive ? styles.toolOk : ''}`}
                style={{ cursor: 'pointer', marginBottom: 6 }}
                onClick={() => onSelect(isActive ? undefined : skill.id)}
              >
                <div className={styles.toolHeader}>
                  <span className={styles.toolName}>{skill.name}</span>
                  {isActive && (
                    <span className={styles.toolStatusPill} style={{ color: 'var(--status-ok)' }}>
                      active
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{skill.description}</div>
                {skill.toolWhitelist && skill.toolWhitelist.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
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
