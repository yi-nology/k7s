/**
 * MemoryPanel — shows the four-tier cluster memory / knowledge base.
 */
import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { formatError, getProvider } from '../../providers';
import { useProviderQuery } from '../../hooks/useProviderQuery';
import type { MemoryEntry, MemoryTier, UserPreference } from '../../lib/ai/types';
import styles from './AiChat.module.css';

/**
 * Format memory entry content for display:
 * - Truncate long content
 * - Clean up raw JSON error dumps
 * - Extract meaningful summary from tool-call-heavy entries
 */
function formatMemoryContent(content: string): string {
  // If content contains tool error JSON, extract the user question and clean up
  const userAskedMatch = content.match(/User asked: "([^"]+)"/);
  const respondedMatch = content.match(/and responded: "([^"]+)"/);

  if (userAskedMatch) {
    const question = userAskedMatch[1];
    let summary = `Q: ${question}`;

    if (respondedMatch) {
      // Clean up the response — remove JSON error objects
      let response = respondedMatch[1];
      // Remove JSON error objects like {"error":"tool error: unknown kind: Pod"}
      response = response.replace(/\{[^}]*"error"[^}]*\}/g, '').trim();
      // Remove any remaining orphaned braces
      response = response.replace(/[{}]/g, '').trim();
      // Remove multiple spaces
      response = response.replace(/\s+/g, ' ').trim();
      if (response) {
        // Truncate if too long
        if (response.length > 200) response = response.substring(0, 200) + '…';
        summary += `\n→ ${response}`;
      }
    }

    // Show which tools were used (brief)
    const toolsMatch = content.match(/AI used tools \[([^\]]+)\]/);
    if (toolsMatch) {
      const tools = toolsMatch[1].split(', ').map(t => t.trim());
      const uniqueTools = [...new Set(tools)];
      summary += `\n🔧 ${uniqueTools.join(', ')}`;
    }

    return summary;
  }

  // For other content, truncate if too long
  if (content.length > 300) {
    return content.substring(0, 300) + '…';
  }
  return content;
}

interface Props {
  kubeContext: string;
}

type TierFilter = 'all' | MemoryTier;

export function MemoryPanel({ kubeContext }: Props) {
  const { t } = useTranslation();
  const TIER_LABELS: Record<TierFilter, string> = {
    all: t('ai.memory.tierAll'),
    shortTerm: t('ai.memory.tierRecent'),
    longTerm: t('ai.memory.tierLongTerm'),
    knowledgeVault: t('ai.memory.tierVault'),
  };
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [newNote, setNewNote] = useState('');
  const [newTags, setNewTags] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const provider = getProvider();

  const entriesQuery = useProviderQuery<MemoryEntry[]>({
    query: () => {
      const q = query.trim();
      if (q) {
        return getProvider()
          .aiMemorySearch(kubeContext, q)
          .then((results) => (tier === 'all' ? results : results.filter((e) => e.tier === tier)));
      }
      return getProvider().aiMemoryList(kubeContext, tier === 'all' ? undefined : tier);
    },
    deps: [kubeContext, query, tier],
    key: `ai:memory:${kubeContext}`,
  });
  const entries = entriesQuery.data ?? [];

  const prefsQuery = useProviderQuery<UserPreference[]>({
    query: () => getProvider().aiMemoryPreferences(kubeContext),
    deps: [kubeContext],
    key: `ai:memory-prefs:${kubeContext}`,
  });
  const prefs = prefsQuery.data ?? [];

  // Until the first load settles either way, treat it as loading (matches
  // the pre-hook initial loading state).
  const loading =
    entriesQuery.loading || prefsQuery.loading ||
    (entriesQuery.data === undefined && !entriesQuery.error);
  const error = actionError ?? entriesQuery.error ?? prefsQuery.error ?? null;
  const reload = entriesQuery.reload;

  const addNote = async () => {
    const text = newNote.trim();
    if (!text) return;
    const tags = newTags.split(',').map((tag) => tag.trim()).filter(Boolean);
    setActionError(null);
    try {
      await provider.aiMemoryAdd(kubeContext, text, tags, tier === 'all' ? 'longTerm' : tier);
      setNewNote('');
      setNewTags('');
      reload();
    } catch (e) {
      setActionError(formatError(e));
    }
  };

  const deleteEntry = async (id: string) => {
    setActionError(null);
    try {
      await provider.aiMemoryDelete(kubeContext, id);
      reload();
    } catch (e) {
      setActionError(formatError(e));
    }
  };

  if (loading) return <div className={styles.empty}>{t('ai.memory.loading')}</div>;

  return (
    <div className={styles.body}>
      {error && (
        <div style={{ padding: 8, background: 'var(--status-err-soft)', color: 'var(--status-err)', borderRadius: 4, marginBottom: 8, fontSize: 12 }}>
          {error}
        </div>
      )}
      {/* Tier filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {(['all', 'shortTerm', 'longTerm', 'knowledgeVault'] as TierFilter[]).map((tf) => (
          <button
            key={tf}
            type="button"
            onClick={() => setTier(tf)}
            className={tier === tf ? styles.headerTabActive : styles.headerTab}
            style={{ fontSize: 11, padding: '2px 8px' }}
          >
            {TIER_LABELS[tf]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowPrefs(!showPrefs)}
          className={showPrefs ? styles.headerTabActive : styles.headerTab}
          style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
        >
          {t('ai.memory.prefs')}
        </button>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input
          className={styles.input}
          placeholder={t('ai.memory.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      {/* User preferences */}
      {showPrefs && (
        <div style={{ marginBottom: 10 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolName}>{t('ai.memory.learnedPrefs')}</span>
          </div>
          {prefs.length === 0 && <div className={styles.empty}>{t('ai.memory.noPrefs')}</div>}
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
        <input className={styles.input} placeholder={t('ai.memory.addNote')} value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void addNote(); }} style={{ flex: 2 }} />
        <input className={styles.input} placeholder={t('ai.memory.tags')} value={newTags} onChange={(e) => setNewTags(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className={styles.sendBtn} onClick={addNote} disabled={!newNote.trim()} style={{ padding: '0 10px' }}>{t('ai.memory.add')}</button>
      </div>

      {/* Entries */}
      {entries.length === 0 && <div className={styles.empty}>{query ? t('ai.memory.noMatches') : t('ai.memory.noMemories')}</div>}
      {entries.map((entry) => (
        <div key={entry.id} className={styles.toolCard} style={{ marginBottom: 6 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}>{entry.tier === 'knowledgeVault' ? '📚' : entry.source === 'ai' ? '✦' : '📝'}</span>
            <span className={styles.toolStatusPill}>
              {entry.tier === 'shortTerm' ? 'recent' : entry.tier === 'longTerm' ? 'long-term' : 'vault'}
            </span>
            <span className={styles.toolExpandChevron}>{entry.createdAt.slice(0, 10)}</span>
            <button type="button" className={styles.headerTab} onClick={() => deleteEntry(entry.id)} title={t('ai.memory.delete')} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-body)', padding: '4px 0' }}>
            {formatMemoryContent(entry.content)}
          </div>
          {entry.tags.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entry.tags.map((tag) => `#${tag}`).join(' ')}</div>
          )}
          {entry.referenceCount > 0 && (
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>
              {t('ai.memory.referenced', entry.referenceCount)}
              {entry.tier === 'shortTerm' && entry.referenceCount < entry.promoteAt && ` ${t('ai.memory.autoPromotes', entry.promoteAt)}`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
