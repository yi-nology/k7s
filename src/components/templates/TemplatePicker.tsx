/**
 * TemplatePicker — the create-from-template overlay (Bxx wizard pass).
 *
 * The picker is a single-screen form, not a multi-step wizard. The shape:
 *
 *   ┌─ Header ─────────────────────────────────────────────┐
 *   │  Create from template                          [×]   │
 *   ├─ Kind bar ───────────────────────────────────────────┤
 *   │  Kind: [Deployment ▼]   Single-container …          │
 *   ├─ Form (scrollable) ─────────────────────────────────┤
 *   │  ┌─ Basic ────────────────────────────────────────┐  │
 *   │  │ Name     [___]   Image  [___]                 │  │
 *   │  │ Replicas [_]     Port   [_]                  │  │
 *   │  │ Namespace [___]                              │  │
 *   │  └──────────────────────────────────────────────┘  │
 *   │  ┌─ Labels ──[+ Add label]─────────────────────┐   │
 *   │  │ [app: my-app ×] [tier: web ×]               │   │
 *   │  │ [key=value                              ] [+] │   │
 *   │  └──────────────────────────────────────────────┘  │
 *   │  ┌─ Resource requests ─────────────────────────┐   │
 *   │  │ CPU [___]  Memory [___]                    │   │
 *   │  └──────────────────────────────────────────────┘  │
 *   │  ▾ YAML preview                                    │
 *   │  ┌────────────────────────────────────────────┐    │
 *   │  │ apiVersion: apps/v1                       │    │
 *   │  │ ...                                         │    │
 *   │  └────────────────────────────────────────────┘    │
 *   ├─ Footer (sticky) ───────────────────────────────────┤
 *   │  [Cancel]                          [Apply →]       │
 *   └────────────────────────────────────────────────────┘
 *
 * Design notes:
 *  - The old side list of templates is gone — replaced by a single
 *    `<select>` in the kind bar. With 11 templates, the side list was
 *    a 220px column the user had to scroll to find the right entry.
 *    A dropdown is the same UX with a tenth of the screen real estate.
 *  - The description of the currently-selected kind lives next to the
 *    dropdown, so the user still sees what each kind is for without
 *    having to switch.
 *  - Form sections are <fieldset> cards, not bare <h3> headers, so
 *    each one has a visible boundary in the dark UI.
 *  - The Apply button is in a sticky footer; long YAML previews don't
 *    push it off-screen.
 *  - Labels are a chip list (GitHub-style) instead of the old
 *    `key = value [×]` rows, which read more like a single line of
 *    text and were visually noisy.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getProvider } from '../../providers';
import type { ApplyResult, DocDryRun } from '../../providers/types';
import {
  defaultValuesFor,
  listTemplates,
  renderTemplate,
  type Template,
  type TemplateExtras,
} from '../../lib/templates';
import { useTranslation } from '../../hooks/useI18n';
import { useStore } from '../../store';
import { CodeEditor } from '../detail/CodeEditor';
import styles from './TemplatePicker.module.css';

/**
 * The values dict the render function gets. The renderer's signature is
 * `Record<string, unknown>`, so this is the source of truth on what the
 * wizard actually feeds in. The `labels` and `resources` keys are
 * conventional — none of the templates' `params` use these names.
 */
interface TemplateValues {
  [key: string]: string | Record<string, string> | { cpu?: string; memory?: string } | undefined;
  labels?: Record<string, string>;
  resources?: { cpu?: string; memory?: string };
}

/** Build the initial values for a template, including any `extras`. */
function initialValuesFor(t: Template): TemplateValues {
  return {
    ...defaultValuesFor(t),
    ...(t.extras?.labels ? { labels: { ...t.extras.labels.default } } : {}),
    ...(t.extras?.resources ? { resources: { ...t.extras.resources.default } } : {}),
  } as TemplateValues;
}

/**
 * Parse the chip-editor's `key=value` input. Returns `null` for an
 * unparseable line (empty / key-only-after-trim), so the caller can
 * decide whether to commit silently or surface a hint. Splitting the
 * first `=` (not the last) matches `kubectl label` and the way every
 * shell tool handles KEY=VAL — a value containing `=` is left intact.
 */
export function parseLabelDraft(draft: string): { key: string; value: string } | null {
  const line = draft.trim();
  if (!line) return null;
  const eq = line.indexOf('=');
  let key: string;
  let value: string;
  if (eq === -1) {
    key = line;
    value = '';
  } else {
    key = line.slice(0, eq).trim();
    value = line.slice(eq + 1).trim();
  }
  if (!key) return null;
  return { key, value };
}

export function TemplatePicker({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const templates = useMemo(() => listTemplates(), []);
  const currentKind = useStore((s) => s.nav);
  const [selected, setSelected] = useState<Template | null>(null);
  const [values, setValues] = useState<TemplateValues>({});
  const [result, setResult] = useState<ApplyResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Default the YAML preview to expanded so the user can verify before
  // submit; the toggle is for the long-preview case where the form
  // gets crowded.
  const [yamlOpen, setYamlOpen] = useState(true);

  // ---- YAML-import mode (Bxx — two-mode create overlay) ----
  // `mode` toggles between the template form (default) and a raw-YAML
  // editor with a bundle dry-run preview step. Switching form → yaml seeds
  // the editor from the rendered template so the user can hand-tweak what
  // the form produced; switching back preserves the form state.
  const [mode, setMode] = useState<'form' | 'yaml'>('form');
  const [yamlDraft, setYamlDraft] = useState('');
  const [review, setReview] = useState<DocDryRun[] | null>(null);
  // Track the draft text at the time of the last Preview so we can detect
  // post-preview edits and force a re-preview before Apply (stale guard).
  const [reviewedDraft, setReviewedDraft] = useState('');

  const initialSelection = useMemo(
    () => templates.find((tt) => tt.kind === currentKind) ?? null,
    [templates, currentKind]
  );

  useEffect(() => {
    if (initialSelection) {
      setSelected(initialSelection);
      setValues(initialValuesFor(initialSelection));
    } else {
      setSelected(null);
      setValues({});
    }
    setResult([]);
    setError(null);
  }, [initialSelection]);

  const yamlPreview = useMemo(() => {
    if (!selected) return '';
    try {
      return renderTemplate(selected.id, values);
    } catch (e) {
      return `# error: ${String(e)}`;
    }
  }, [selected, values]);

  const pickTemplate = (tt: Template) => {
    setSelected(tt);
    setValues(initialValuesFor(tt));
    setResult([]);
    setError(null);
  };

  /**
   * Switch to YAML-import mode, seeding the editor from the form's current
   * rendered output. If the form has no template selected, seed empty so the
   * user pastes from scratch. Seeding every switch (not just the first)
   * means a user who tweaks the form, switches to YAML, then switches back
   * and tweaks again picks up the latest render — the intuitive "form feeds
   * YAML" relationship.
   */
  const switchToYaml = () => {
    setReview(null);
    setError(null);
    setResult([]);
    setReviewedDraft('');
    setYamlDraft(yamlPreview || '');
    setMode('yaml');
  };

  const switchToForm = () => {
    setReview(null);
    setError(null);
    setResult([]);
    setMode('form');
  };

  /** Per-doc review is "clean" when every doc has a proposed manifest and no
   * error. Apply is gated on this — the whole point of the dry-run step is
   * to block a bundle with a bad doc from being applied. */
  const reviewClean = review !== null && review.length > 0 && review.every((d) => !d.error);

  /** A draft edit after a clean Preview invalidates that preview: Apply gets
   * disabled again until the user re-runs Preview. */
  const reviewStale = reviewClean && yamlDraft !== reviewedDraft;

  const applyForm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getProvider().applyYamlBundle(yamlPreview);
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Run a bundle dry run and store the per-doc results. Errors are surfaced
   * per-doc in `review`, not as a top-level `error` (a per-doc admission
   * rejection is expected, not a fatal command failure). A thrown error from
   * the provider (network, auth) does go to `error`. */
  const previewYaml = async () => {
    if (!yamlDraft.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getProvider().dryRunYamlBundle(yamlDraft);
      setReview(r);
      setReviewedDraft(yamlDraft);
    } catch (e) {
      setError(String(e));
      setReview(null);
    } finally {
      setBusy(false);
    }
  };

  /** Apply the YAML bundle for real. Only reachable after a clean Preview
   * (Apply is disabled otherwise). On success we keep the results list so
   * the user sees what was created; on failure we keep the draft + review. */
  const applyYaml = async () => {
    if (!reviewClean) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getProvider().applyYamlBundle(yamlDraft);
      setResult(r);
      setReview(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'form') void applyForm();
    // In YAML mode the primary action is Preview (or Apply after a clean
    // preview); both are buttons, not a form submit, because the draft
    // textarea shouldn't submit on Enter.
  };

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('tpl.title', 'Create from template')}</h2>
        {onClose && (
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('tpl.close', 'Close')}
          >
            ×
          </button>
        )}
      </header>

      {/* Mode toggle: segmented control. Hidden when no template is selected
          in form mode would strand the user, but YAML mode is useful even
          with no template (paste from scratch), so we always show it. */}
      <div className={styles.modeBar} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'form'}
          className={styles.modeBtn}
          data-active={mode === 'form'}
          onClick={switchToForm}
        >
          {t('tpl.mode.form', 'Form')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'yaml'}
          className={styles.modeBtn}
          data-active={mode === 'yaml'}
          onClick={switchToYaml}
        >
          {t('tpl.mode.yaml', 'YAML import')}
        </button>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <form onSubmit={onSubmit} className={styles.formRoot}>
        {mode === 'form' ? (
          <>
            <div className={styles.kindBar}>
              <label className={styles.kindLabel}>
                {t('tpl.kind', 'Kind')}
                <select
                  className={styles.kindSelect}
                  value={selected?.id ?? ''}
                  onChange={(e) => {
                    const next = templates.find((tt) => tt.id === e.target.value);
                    if (next) pickTemplate(next);
                  }}
                >
                  {/* No template auto-selected: render a placeholder option
                      so the dropdown isn't empty. The body below shows the
                      "pick a kind" hint. */}
                  {!selected && (
                    <option value="" disabled>
                      {t('tpl.pick', 'Pick a template on the left')}
                    </option>
                  )}
                  {templates.map((tt) => (
                    <option key={tt.id} value={tt.id}>
                      {t(`tpl.titles.${tt.id}`, tt.title)}
                    </option>
                  ))}
                </select>
              </label>
              {selected && (
                <p className={styles.kindDesc}>
                  {t(`tpl.descs.${selected.id}`, selected.description)}
                </p>
              )}
            </div>

            <div className={styles.body}>
              {selected ? (
                <>
                  <section className={styles.section}>
                    <h3 className={styles.sectionTitle}>{t('tpl.section.basic', 'Basic')}</h3>
                    <div className={styles.fields}>
                      {selected.params.map((p) => {
                        const raw = values[p.key];
                        const value = typeof raw === 'string' ? raw : (p.default ?? '');
                        return (
                          <label
                            key={p.key}
                            className={styles.field}
                            data-wide={p.help ? 'true' : 'false'}
                          >
                            <span className={styles.fieldLabel}>{p.label}</span>
                            {p.kind === 'boolean' ? (
                              <input
                                type="checkbox"
                                checked={value === 'true'}
                                onChange={(e) =>
                                  setValues({
                                    ...values,
                                    [p.key]: e.target.checked ? 'true' : 'false',
                                  })
                                }
                              />
                            ) : (
                              <input
                                type={p.kind === 'number' ? 'number' : 'text'}
                                value={value}
                                required={p.required ?? true}
                                pattern={p.pattern}
                                min={p.min}
                                max={p.max}
                                placeholder={p.default}
                                onChange={(e) =>
                                  setValues({
                                    ...values,
                                    [p.key]: e.target.value,
                                  })
                                }
                              />
                            )}
                            {p.help && <small className={styles.fieldHelp}>{p.help}</small>}
                          </label>
                        );
                      })}
                    </div>
                  </section>

                  {selected.extras && (
                    <ExtrasSection
                      extras={selected.extras}
                      labels={values.labels ?? {}}
                      resources={values.resources ?? {}}
                      onLabelsChange={(labels) => setValues({ ...values, labels })}
                      onResourcesChange={(resources) => setValues({ ...values, resources })}
                    />
                  )}

                  <section className={styles.section}>
                    <button
                      type="button"
                      className={styles.yamlToggle}
                      onClick={() => setYamlOpen((o) => !o)}
                      aria-expanded={yamlOpen}
                    >
                      <span className={styles.yamlChevron} data-open={yamlOpen}>
                        ▾
                      </span>
                      {t('tpl.preview', 'YAML preview')}
                    </button>
                    {yamlOpen && <pre className={styles.preview}>{yamlPreview}</pre>}
                  </section>
                </>
              ) : (
                <div className={styles.empty}>{t('tpl.pick', 'Pick a template on the left')}</div>
              )}
            </div>

            <footer className={styles.footer}>
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
                {t('tpl.cancel', 'Cancel')}
              </button>
              <button type="submit" className={styles.applyBtn} disabled={busy || !selected}>
                {busy ? t('tpl.applying', 'Applying…') : t('tpl.apply', 'Apply')}
              </button>
            </footer>
          </>
        ) : (
          // ---- YAML-import mode ----
          // Editor + per-doc review, with a two-stage Preview → Apply flow
          // mirroring YamlTab's dry-run safety net. The footer's primary
          // action flips between Preview (no clean review yet) and Apply
          // (clean review, not stale).
          <>
            <div className={styles.body}>
              {review && review.length > 0 ? (
                <YamlReview review={review} />
              ) : (
                <div className={styles.yamlEditorWrap}>
                  <CodeEditor
                    key="yaml-import"
                    value={yamlDraft}
                    editable
                    onChange={(text) => {
                      setYamlDraft(text);
                      // Editing invalidates any prior preview.
                      if (review) setReview(null);
                    }}
                  />
                </div>
              )}
              {reviewStale && (
                <div className={styles.staleHint}>
                  {t('tpl.yaml.stale', 'Edit detected — click Preview again')}
                </div>
              )}
            </div>

            <footer className={styles.footer}>
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
                {t('tpl.cancel', 'Cancel')}
              </button>
              {reviewClean && !reviewStale ? (
                <button
                  type="button"
                  className={styles.applyBtn}
                  disabled={busy}
                  onClick={() => void applyYaml()}
                >
                  {busy ? t('tpl.yaml.applying', 'Applying…') : t('tpl.yaml.apply', 'Apply')}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.applyBtn}
                  disabled={busy || !yamlDraft.trim()}
                  onClick={() => void previewYaml()}
                >
                  {busy ? t('tpl.yaml.checking', 'Checking…') : t('tpl.yaml.preview', 'Preview')}
                </button>
              )}
            </footer>
          </>
        )}
      </form>

      {result.length > 0 && (
        <ul className={styles.results}>
          {result.map((r, i) => (
            <li key={i} className={r.action === 'failed' ? styles.resultErr : styles.resultOk}>
              {r.action} {r.kind}/{r.name}
              {r.namespace ? ` (${r.namespace})` : ''}
              {r.error ? ` — ${r.error}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The structured "extras" — labels (chip list) and resource requests
 * (CPU + memory inputs). Rendered as their own section card.
 */
function ExtrasSection({
  extras,
  labels,
  resources,
  onLabelsChange,
  onResourcesChange,
}: {
  extras: TemplateExtras;
  labels: Record<string, string>;
  resources: { cpu?: string; memory?: string };
  onLabelsChange: (labels: Record<string, string>) => void;
  onResourcesChange: (r: { cpu?: string; memory?: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {extras.labels && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('tpl.extras.labels', 'Labels')}</h3>
          <LabelsEditor labels={labels} onChange={onLabelsChange} />
        </section>
      )}
      {extras.resources && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('tpl.extras.resources', 'Resource requests')}</h3>
          <div className={styles.resourcesRow}>
            <label className={styles.resourceField}>
              <span className={styles.fieldLabel}>{t('tpl.extras.cpu', 'CPU')}</span>
              <input
                type="text"
                value={resources.cpu ?? ''}
                placeholder={extras.resources.default.cpu ?? '100m'}
                onChange={(e) => onResourcesChange({ ...resources, cpu: e.target.value })}
              />
            </label>
            <label className={styles.resourceField}>
              <span className={styles.fieldLabel}>{t('tpl.extras.memory', 'Memory')}</span>
              <input
                type="text"
                value={resources.memory ?? ''}
                placeholder={extras.resources.default.memory ?? '128Mi'}
                onChange={(e) => onResourcesChange({ ...resources, memory: e.target.value })}
              />
            </label>
          </div>
        </section>
      )}
    </>
  );
}

/**
 * Chip-style labels editor. Each label is a removable pill showing
 * `key: value`; a single text input below accepts `key=value` (or
 * just `key`) and adds it on Enter / `+`. An empty key is dropped
 * silently so a half-typed line never produces invalid YAML.
 *
 * Why chip pattern over the prior `key = value [×]` rows:
 *  - Reading "10 labels" at a glance is easier with chips than with
 *    a 10-row table.
 *  - Removal is one click on a single × (not "find the right row,
 *    click the × at the end").
 *  - The `key=value` input is the same shape kubectl users know,
 *    and works with paste.
 */
function LabelsEditor({
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

/**
 * Per-document review of a bundle dry run (YAML-import mode). Each doc is a
 * row: a header showing `kind/name` (green if the server accepted it, red if
 * it errored) and the proposed manifest below. Errored docs show the server's
 * message verbatim — the whole value of the dry run is surfacing admission
 * rejections before a real apply.
 *
 * This is the create-side counterpart to YamlTab's DiffView. Where DiffView
 * shows a current-vs-proposed diff (editing an existing object), a create has
 * no `current`, so we show the full proposed manifest: "here's what will be
 * created." Collapsible per doc so a 5-doc bundle doesn't bury an error.
 */
function YamlReview({ review }: { review: DocDryRun[] }) {
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
