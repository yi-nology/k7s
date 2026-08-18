/**
 * LabelsEditor — chip-style labels editor.
 *
 * Each label is a removable pill showing `key: value`; a single text input
 * below accepts `key=value` (or just `key`) and adds it on Enter / `+`.
 * An empty key is dropped silently so a half-typed line never produces
 * invalid YAML.
 *
 * Why chip pattern over the prior `key = value [×]` rows:
 *  - Reading "10 labels" at a glance is easier with chips than with a 10-row table.
 *  - Removal is one click on a single × (not "find the right row, click the × at the end").
 *  - The `key=value` input is the same shape kubectl users know, and works with paste.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { parseLabelDraft } from './parseLabelDraft';
import styles from './TemplatePicker.module.css';

export function LabelsEditor({
  labels,
  onChange,
}: {
  labels: Record<string, string>;
  onChange: (labels: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  // Insertion order matters: chips appear in the order the user added
  // them, not sorted alphabetically. Object key order in JS is
  // insertion order for string keys, so we just iterate.
  const entries = Object.entries(labels);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const parsed = parseLabelDraft(draft);
    if (!parsed) return;
    onChange({ ...labels, [parsed.key]: parsed.value });
    setDraft('');
  };

  return (
    <div className={styles.labelsWrap}>
      {entries.length > 0 && (
        <div className={styles.chipList}>
          {entries.map(([k, v]) => (
            <span key={k} className={styles.chip}>
              <span className={styles.chipKey}>{k}</span>
              {v !== '' && (
                <>
                  <span className={styles.chipSep}>:</span>
                  <span className={styles.chipVal}>{v}</span>
                </>
              )}
              <button
                type="button"
                className={styles.chipX}
                onClick={() => {
                  const next = { ...labels };
                  delete next[k];
                  onChange(next);
                }}
                aria-label={t('tpl.extras.remove', 'remove')}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.labelAdd}>
        <input
          type="text"
          value={draft}
          placeholder={t('tpl.extras.addPlaceholder', 'key=value, then ⏎')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <button
          type="button"
          className={styles.labelAddBtn}
          onClick={commit}
          disabled={!draft.trim()}
        >
          +
        </button>
      </div>
    </div>
  );
}
