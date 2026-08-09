/**
 * MemoryPanel — shows the cluster memory / knowledge base for the active
 * kubeconfig context. Users can browse, search, add, and delete memories.
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { MemoryEntry } from '../../lib/ai/types';
import styles from './AiAssistantPanel.module.css';

interface Props {
  /** Current kubeconfig context name (for scoping memories). */
  kubeContext: string;
}

export function MemoryPanel({ kubeContext }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      if (query.trim()) {
        setEntries(
          await invoke<MemoryEntry[]>('ai_memory_search', {
            kubeContext,
            query: query.trim(),
          })
        );
      } else {
        setEntries(
          await invoke<MemoryEntry[]>('ai_memory_list', { kubeContext })
        );
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kubeContext, query]);

  const addNote = async () => {
    const text = newNote.trim();
    if (!text) return;
    try {
      await invoke('ai_memory_add', {
        kubeContext,
        content: text,
        tags: [],
      });
      setNewNote('');
      await load();
    } catch {
      /* ignore */
    }
  };

  const deleteEntry = async (id: string) => {
    try {
      await invoke('ai_memory_delete', { kubeContext, id });
      await load();
    } catch {
      /* ignore */
    }
  };

  if (loading) return <div className={styles.empty}>Loading memory…</div>;

  return (
    <div className={styles.body}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          className={styles.input}
          placeholder="Search memories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          className={styles.input}
          placeholder="Add a note (e.g. 'frontend uses image v2.3.1')"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addNote();
          }}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className={styles.sendBtn}
          onClick={addNote}
          disabled={!newNote.trim()}
          style={{ padding: '0 12px' }}
        >
          Add
        </button>
      </div>
      {entries.length === 0 && (
        <div className={styles.empty}>
          No memories yet. Add a note or the AI will auto-extract summaries from
          conversations.
        </div>
      )}
      {entries.map((entry) => (
        <div key={entry.id} className={styles.toolCard} style={{ marginBottom: 6 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}>{entry.source === 'ai' ? '✦' : '📝'}</span>
            <span className={styles.toolState}>
              {entry.createdAt.slice(0, 10)}
            </span>
            <button
              type="button"
              className={styles.close}
              onClick={() => deleteEntry(entry.id)}
              title="Delete"
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--fg)' }}>{entry.content}</div>
          {entry.tags.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
              {entry.tags.map((t) => `#${t}`).join(' ')}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
