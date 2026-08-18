/**
 * YamlReview — per-document review of a bundle dry run (YAML-import mode).
 *
 * Each doc is a row: a header showing `kind/name` (green if the server accepted
 * it, red if it errored) and the proposed manifest below. Errored docs show the
 * server's error message instead. Defaults to open when the doc succeeded,
 * closed when it errored (so the user sees the error first). Collapsible per
 * doc so a 5-doc bundle doesn't bury an error.
 */

import { useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import type { DocDryRun } from '../../providers/types';
import styles from './TemplatePicker.module.css';

export function YamlReview({ review }: { review: DocDryRun[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <div className={styles.review}>
      {review.map((d, i) => {
        const ok = !d.error;
        const label = d.error
          ? t('tpl.yaml.docErr', '{kind}/{name} — {error}')
              .replace('{kind}', d.kind || '?')
              .replace('{name}', d.name || '?')
              .replace('{error}', d.error)
          : t('tpl.yaml.docOk', '{kind}/{name}')
              .replace('{kind}', d.kind || '?')
              .replace('{name}', d.name || '?');
        const isOpen = open[i] ?? ok;
        return (
          <div key={i} className={styles.reviewDoc} data-ok={ok ? 'true' : 'false'}>
            <button
              type="button"
              className={styles.reviewHead}
              onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen }))}
              aria-expanded={isOpen}
            >
              <span className={styles.reviewChevron} data-open={isOpen}>
                ▾
              </span>
              <span className={ok ? styles.reviewOk : styles.reviewErr}>{label}</span>
            </button>
            {isOpen && <pre className={styles.reviewBody}>{d.proposed ?? d.error ?? ''}</pre>}
          </div>
        );
      })}
    </div>
  );
}
