/**
 * MemoryPanel — shows the four-tier cluster memory / knowledge base.
 */
import { useEffect, useState } from 'react';
import { getProvider } from '../../providers';
import type { MemoryEntry, MemoryTier, UserPreference } from '../../lib/ai/types';
import styles from './AiChat.module.css';

interface Props {
  kubeContext: string;
}

type TierFilter = 'all' | MemoryTier;

const TIER_LABELS: Record<TierFilter, string> = {
  all: 'All',
  shortTerm: 'Recent',
  longTerm: 'Long-term',
  knowledgeVault: 'Vault',
};

export function MemoryPanel({ kubeContext }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [prefs, setPrefs] = useState<UserPreference[]>([]);
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [newNote, setNewNote] = useState('');
  const [newTags, setNewTags] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPrefs, setShowPrefs] = useState(false);
  const provider = getProvider();

  const load = async () => {
    try {
      if (query.trim()) {
        const results = await provider.aiMemorySearch(kubeContext, query.trim());
        setEntries(tier === 'all' ? results : results.filter((e) => e.tier === tier));
      } else {
        setEntries(await provider.aiMemoryList(kubeContext, tier === 'all' ? undefined : tier));
      }
      setPrefs(await provider.aiMemoryPreferences(kubeContext));
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
  }, [kubeContext, query, tier]);

  const addNote = async () => {
    const text = newNote.trim();
    if (!text) return;
    const tags = newTags.split(',').map((t) => t.trim()).filter(Boolean);
    try {
      await provider.aiMemoryAdd(kubeContext, text, tags, tier === 'all' ? 'longTerm' : tier);
      setNewNote('');
      setNewTags('');
      await load();
    } catch { /* ignore */ }
  };

  const deleteEntry = async (id: string) => {
    try {
      await provider.aiMemoryDelete(kubeContext, id);
      await load();
    } catch { /* ignore */ }
  };

  if (loading) return <div className={styles.empty}>Loading memory…</div>;

  return (
    <div className={styles.body}>
      {/* Tier filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['all', 'shortTerm', 'longTerm', 'knowledgeVault'] as TierFilter[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTier(t)}
            className={tier === t ? styles.headerTabActive : styles.headerTab}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            {TIER_LABELS[t]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowPrefs(!showPrefs)}
          className={showPrefs ? styles.headerTabActive : styles.headerTab}
          style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
        >
          🧠 Prefs
        </button>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          className={styles.input}
          placeholder="Search memories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      {/* User preferences */}
      {showPrefs && (
        <div style={{ marginBottom: 10 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolName}>Learned Preferences</span>
          </div>
          {prefs.length === 0 && <div className={styles.empty}>No preferences learned yet.</div>}
          {prefs.map((p) => (
            <div key={p.key} className={styles.toolCard} style={{ marginBottom: 4, fontSize: 12 }}>
              <span style={{ color: 'var(--text-primary)' }}>{p.key}:</span>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>{p.value}</span>
              <span style={{ float: 'right', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {(p.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add note */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input className={styles.input} placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addNote(); }} style={{ flex: 2 }} />
        <input className={styles.input} placeholder="tags" value={newTags} onChange={(e) => setNewTags(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className={styles.sendBtn} onClick={addNote} disabled={!newNote.trim()} style={{ padding: '0 10px' }}>Add</button>
      </div>

      {/* Entries */}
      {entries.length === 0 && <div className={styles.empty}>{query ? 'No matches.' : 'No memories in this tier yet.'}</div>}
      {entries.map((entry) => (
        <div key={entry.id} className={styles.toolCard} style={{ marginBottom: 6 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}>{entry.tier === 'knowledgeVault' ? '📚' : entry.source === 'ai' ? '✦' : '📝'}</span>
            <span className={styles.toolStatusPill}>
              {entry.tier === 'shortTerm' ? 'recent' : entry.tier === 'longTerm' ? 'long-term' : 'vault'}
            </span>
            <span className={styles.toolExpandChevron}>{entry.createdAt.slice(0, 10)}</span>
            <button type="button" className={styles.headerTab} onClick={() => deleteEntry(entry.id)} title="Delete" style={{ marginLeft: 'auto' }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-body)', padding: '4px 0' }}>{entry.content}</div>
          {entry.tags.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.tags.map((t) => `#${t}`).join(' ')}</div>
          )}
          {entry.referenceCount > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
              referenced {entry.referenceCount}×
              {entry.tier === 'shortTerm' && entry.referenceCount < entry.promoteAt && ` (auto-promotes at ${entry.promoteAt}×)`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
