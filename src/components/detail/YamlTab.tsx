/**
 * YAML tab — dual-pane editor with live local diff during editing.
 *
 * Layout (edit mode):
 *   ┌────────────────────────┬────────────────────────┐
 *   │  EditorCore (62%)      │  Live local diff (38%) │
 *   │  with lint + search    │  debounced 300ms       │
 *   └────────────────────────┴────────────────────────┘
 *
 * After dry-run preview, the right pane switches to server diff.
 * Read-only mode: single-pane EditorCore without toolbar.
 *
 * Draft protection: dirty state is tracked via yamlBase in the store;
 * navigating away while dirty triggers EditGuardDialog (mounted in App).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { EditorView } from '@codemirror/view';
import styles from './YamlTab.module.css';
import { useStore } from '../../store';
import { formatError, getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { useTranslation } from '../../hooks/useI18n';
import { EditorCore } from '../editor/EditorCore';
import { diffLines, diffStat, hasChanges, hunks } from '../../lib/diff';
import type { ResourceRef, YamlDiff } from '../../providers/types';

/** Debounce helper. */
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Local diff view — shows changes between the original YAML and the current draft.
 * Updates in real-time (debounced) as the user types.
 */
const LocalDiffView = React.memo(function LocalDiffView({
  original,
  draft,
}: {
  original: string;
  draft: string;
}) {
  const { t } = useTranslation();
  const lines = diffLines(original, draft);
  const groups = hunks(lines);
  const { added, removed } = diffStat(lines);

  if (!hasChanges(lines)) {
    return (
      <div className={styles.diffWrap}>
        <div className={styles.diffEmpty}>{t('yaml.noChanges')}</div>
      </div>
    );
  }

  return (
    <div className={styles.diffWrap}>
      <div className={styles.diffStat}>
        <span className={styles.diffAdded}>+{added}</span>{' '}
        <span className={styles.diffRemoved}>−{removed}</span>{' '}
        <span className={styles.diffNote}>{t('yaml.localDiff')}</span>
      </div>
      {groups.map((g, i) => (
        <div className={styles.diffHunk} key={i}>
          {g.map((l, j) => (
            <div
              key={j}
              className={[
                styles.diffLine,
                l.op === 'add' ? styles.diffLineAdd : '',
                l.op === 'del' ? styles.diffLineDel : '',
              ].join(' ')}
            >
              <span className={styles.diffGutter}>{l.before ?? l.after ?? ''}</span>
              <span className={styles.diffSign}>
                {l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}
              </span>
              <span className={styles.diffText}>{l.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

/**
 * Server diff view — shows what the dry-run would actually do.
 * Same rendering as the old DiffView.
 */
const ServerDiffView = React.memo(function ServerDiffView({ diff }: { diff: YamlDiff }) {
  const { t } = useTranslation();
  const lines = diffLines(diff.current, diff.proposed);
  const groups = hunks(lines);
  const { added, removed } = diffStat(lines);

  if (!hasChanges(lines)) {
    return (
      <div className={styles.diffWrap}>
        <div className={styles.diffEmpty}>{t('yaml.noChanges')}</div>
      </div>
    );
  }

  return (
    <div className={styles.diffWrap}>
      <div className={styles.diffStat}>
        <span className={styles.diffAdded}>+{added}</span>{' '}
        <span className={styles.diffRemoved}>−{removed}</span>{' '}
        <span className={styles.diffNote}>{t('yaml.diffNote')}</span>
      </div>
      {groups.map((g, i) => (
        <div className={styles.diffHunk} key={i}>
          {g.map((l, j) => (
            <div
              key={j}
              className={[
                styles.diffLine,
                l.op === 'add' ? styles.diffLineAdd : '',
                l.op === 'del' ? styles.diffLineDel : '',
              ].join(' ')}
            >
              <span className={styles.diffGutter}>{l.before ?? l.after ?? ''}</span>
              <span className={styles.diffSign}>
                {l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}
              </span>
              <span className={styles.diffText}>{l.text || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

export function YamlTab() {
  const row = useStore((s) => s.selectedRow);
  const kind = useStore((s) => s.nav);
  const yamlEditing = useStore((s) => s.yamlEditing);
  const yamlDraft = useStore((s) => s.yamlDraft);
  const startYamlEdit = useStore((s) => s.startYamlEdit);
  const cancelYaml = useStore((s) => s.cancelYaml);
  const setYamlDraft = useStore((s) => s.setYamlDraft);
  const setAiPendingMessage = useStore((s) => s.setAiPendingMessage);
  const setAiPanelOpen = useStore((s) => s.setAiPanelOpen);
  const { t } = useTranslation();

  const [editorView, setEditorView] = useState<EditorView | null>(null);
  const [yamlText, setYamlText] = useState('');
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [review, setReview] = useState<YamlDiff | null>(null);

  // Dirty tracking: compare draft to the original fetched text.
  const originalRef = useRef('');
  const isDirty = yamlEditing && yamlDraft !== originalRef.current;

  // Debounce the draft for local diff (300ms).
  const debouncedDraft = useDebounce(yamlDraft, 300);

  const ref: ResourceRef | null = row ? { kind, namespace: row.namespace, name: row.name } : null;

  /** Grab the selection (or full doc) and send it to the AI chat panel. */
  const onExplainYaml = () => {
    if (!editorView) return;
    const sel = editorView.state.sliceDoc(
      editorView.state.selection.main.from,
      editorView.state.selection.main.to,
    );
    const text = sel || editorView.state.doc.toString();
    if (!text) return;
    setAiPendingMessage(`Explain this YAML:\n\`\`\`yaml\n${text}\n\`\`\``);
    setAiPanelOpen(true);
  };

  // Fetch YAML on selection change.
  useAsyncEffect(async (isMounted) => {
    if (!ref) return;
    try {
      const text = await getProvider().getYaml(ref);
      if (!isMounted()) return;
      setYamlText(text);
      originalRef.current = text;
      setNonce((n) => n + 1);
      setError(null);
    } catch (e) {
      if (isMounted()) setError(formatError(e));
    }
  }, [row?.uid, row?.namespace, row?.name]);

  if (!row || !ref) return null;

  const editable = kind !== 'secrets';
  const path = row.namespace
    ? `${kind}/${row.namespace}/${row.name}.yaml`
    : `${kind}/${row.name}.yaml`;

  const onPreview = async () => {
    setApplying(true);
    try {
      setReview(await getProvider().dryRunYaml(ref, yamlDraft));
      setError(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setApplying(false);
    }
  };

  const onApply = async () => {
    setApplying(true);
    try {
      await getProvider().applyYaml(ref, yamlDraft);
      setReview(null);
      cancelYaml();
      const text = await getProvider().getYaml(ref);
      setYamlText(text);
      originalRef.current = text;
      setNonce((n) => n + 1);
      setError(null);
    } catch (e) {
      setError(formatError(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div className={styles.toolbar}>
        <span className={styles.path}>{path}</span>
        {isDirty && (
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--status-warn)',
            }}
            title={t('yaml.unsaved', 'Unsaved changes')}
          />
        )}
        <span className={styles.spacer} />
        {yamlEditing ? (
          review ? (
            <>
              <button type="button" className={styles.cancelBtn} onClick={() => setReview(null)}>
                {t('yaml.backToEditing')}
              </button>
              <button
                type="button"
                className={styles.applyBtn}
                disabled={applying}
                onClick={() => void onApply()}
              >
                {t('yaml.applyForReal')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => {
                  setReview(null);
                  cancelYaml();
                }}
              >
                {t('yaml.cancel')}
              </button>
              <button
                type="button"
                className={styles.applyBtn}
                disabled={applying}
                onClick={() => void onPreview()}
              >
                {applying ? t('yaml.checking') : t('yaml.preview')}
              </button>
            </>
          )
        ) : (
          <>
            <button
              type="button"
              className={styles.explainBtn}
              onClick={onExplainYaml}
              title={t('yaml.explain')}
            >
              <Sparkles size={14} />
              {t('yaml.explain')}
            </button>
            {editable && (
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => {
                  setError(null);
                  startYamlEdit(yamlText);
                }}
              >
                {t('yaml.edit')}
              </button>
            )}
          </>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {yamlEditing && review ? (
        // Review mode: editor left + server diff right
        <div className={styles.editorWrap} style={{ display: 'flex' }}>
          <div className={styles.editing} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <EditorCore
              key={`edit:${row.uid}`}
              value={yamlText}
              language="yaml"
              editable
              onChange={setYamlDraft}
              onViewReady={setEditorView}
              onSave={() => void onPreview()}
            />
          </div>
          <div style={{ flex: '0 0 38%', borderLeft: '1px solid var(--border-row)', minHeight: 0, overflow: 'hidden' }}>
            <ServerDiffView diff={review} />
          </div>
        </div>
      ) : yamlEditing ? (
        // Edit mode: editor left + live local diff right
        <div className={styles.editorWrap} style={{ display: 'flex' }}>
          <div className={styles.editing} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <EditorCore
              key={`edit:${row.uid}`}
              value={yamlText}
              language="yaml"
              editable
              onChange={setYamlDraft}
              onViewReady={setEditorView}
              onSave={() => void onPreview()}
            />
          </div>
          <div style={{ flex: '0 0 38%', borderLeft: '1px solid var(--border-row)', minHeight: 0, overflow: 'hidden' }}>
            <LocalDiffView original={originalRef.current} draft={debouncedDraft} />
          </div>
        </div>
      ) : (
        // Read-only mode: single pane, no toolbar
        <div className={styles.editorWrap}>
          <EditorCore
            key={`read:${row.uid}:${nonce}`}
            value={yamlText}
            language="yaml"
            editable={false}
            onViewReady={setEditorView}
            hideToolbar
          />
        </div>
      )}
    </>
  );
}
