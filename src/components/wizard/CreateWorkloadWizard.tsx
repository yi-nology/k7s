/**
 * CreateWorkloadWizard — Kuboard-style 4-step create-workload wizard
 * (P2 Task 3 + 4): basics → container → storage → review & apply.
 *
 * All step state and form state live here; steps 1-3 render the dumb,
 * controlled fragments from StepFields.tsx. The step-0 gate is Task 2's pure
 * validator (`validateWorkloadForm(form).length === 0`), which is also what
 * keeps the YAML on step 4 generatable.
 *
 * Step 4 (Task 4) is an editable draft + dry-run-gated apply, mirroring
 * TemplatePicker's YAML-import mode: 检查 runs a bundle dry run (per-doc rows
 * via the shared YamlReview), any draft edit invalidates the run (stale), and
 * 应用 stays disabled until a clean, non-stale run exists. Apply failures go
 * to the global error toast + inline rows; success closes the wizard (the
 * table's existing watchers pick the new workload up on their own). The
 * 「从 YAML 回填表单」 button parses the edited draft back into the form and
 * regenerates the preview from the merged result.
 *
 * Mounted through the overlay dispatch table in App.tsx on key 'wizard'
 * (workload-kind create entries open it). The backdrop + centered dialog
 * mirror OnboardingWizard's modal contract: role=dialog + aria-modal, and Esc
 * on the document closes.
 */

import { useEffect, useState } from 'react';
import { formatError, getErrorReporter, getProvider, getSuccessReporter } from '../../providers';
import type { ApplyResult, DocDryRun } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import { CodeEditor } from '../detail/CodeEditor';
import { YamlReview } from '../templates/YamlReview';
import { Basics, Container, Mounts } from './StepFields';
import {
  emptyWorkloadForm,
  generateWorkloadYaml,
  parseWorkloadYaml,
  validateWorkloadForm,
  type WorkloadForm,
} from './workloadSpec';
import styles from './CreateWorkloadWizard.module.css';

const STEP_MARKS = ['①', '②', '③', '④'] as const;

export function CreateWorkloadWizard({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WorkloadForm>(() => emptyWorkloadForm('deployment'));
  const set = (patch: Partial<WorkloadForm>) => setForm((f) => ({ ...f, ...patch }));

  // ---- Step 4: editable draft + dry-run gate (Task 4) ----
  // `yamlDraft` is seeded from the form on ENTERING step 4 (see the Next
  // handler). Going back to a form step and returning regenerates the draft —
  // manual draft edits do not survive a step round-trip: the form is the
  // source of truth until the user commits to reviewing YAML.
  const [yamlDraft, setYamlDraft] = useState('');
  // CodeEditor is uncontrolled after mount; bumping this key remounts it with
  // the regenerated draft text (step entry + successful backfill).
  const [draftGen, setDraftGen] = useState(0);
  const [dry, setDry] = useState<DocDryRun[] | null>(null);
  const [stale, setStale] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  // Fatal provider errors (network/auth) — distinct from per-doc dry-run
  // errors, which live inside `dry`. Kept after apply too.
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [applyResults, setApplyResults] = useState<ApplyResult[]>([]);

  // The gate for leaving step 0 (carry-forward from Task 2's review): empty
  // array = valid. Later steps edit only optional fields, so they stay open.
  const errs = validateWorkloadForm(form);
  const steps = [
    t('wizard.step.basics', 'Basics'),
    t('wizard.step.container', 'Container'),
    t('wizard.step.storage', 'Storage & Config'),
    t('wizard.step.review', 'Review & Apply'),
  ];

  /** Per-doc dry run is clean when it ran, isn't invalidated by an edit,
   * produced at least one doc (an empty bundle — e.g. a cleared draft — must
   * not pass vacuously; TemplatePicker's gate does the same), and every doc
   * passed. Apply is gated on exactly this. */
  const clean = dry !== null && dry.length > 0 && !stale && dry.every((d) => !d.error);

  /** Run the bundle dry run against the current draft (检查). Per-doc errors
   * land in `dry` (rendered as YamlReview rows); a thrown provider error is
   * fatal and goes to the inline error line. */
  const check = async () => {
    if (checking || applying) return;
    setChecking(true);
    setFatalError(null);
    setApplyResults([]);
    try {
      const r = await getProvider().dryRunYamlBundle(yamlDraft);
      setDry(r);
      setStale(false);
    } catch (e) {
      setDry(null);
      setFatalError(formatError(e));
    } finally {
      setChecking(false);
    }
  };

  /** Apply the draft for real (应用). Only reachable on a clean, non-stale
   * run. Failed docs → error toast + inline rows, dialog stays open; an
   * all-good apply toasts the summary and closes (the table's watchers make
   * the new workload appear on their own — no refetch here). */
  const apply = async () => {
    if (!clean || checking || applying) return;
    setApplying(true);
    setFatalError(null);
    try {
      const results = await getProvider().applyYamlBundle(yamlDraft);
      const failed = results.filter((r) => r.action === 'failed');
      if (failed.length > 0) {
        setApplyResults(results);
        getErrorReporter()(
          t('wizard.applyFail', 'Apply failed'),
          failed.map((r) => `${r.kind}/${r.name}${r.error ? `: ${r.error}` : ''}`).join('; ')
        );
      } else {
        // All-good apply: green toast (the success reporter channel), then
        // close — the table's watchers make the new workload appear on their
        // own, no refetch here.
        getSuccessReporter()(
          t('wizard.applyOk', 'Applied'),
          results.map((r) => `${r.action} ${r.kind}/${r.name}`).join(', ')
        );
        onClose?.();
      }
    } catch (e) {
      setFatalError(formatError(e));
    } finally {
      setApplying(false);
    }
  };

  /** Parse the edited draft back into the form (从 YAML 回填表单). On success
   * the merged form regenerates the draft (fresh preview, gate re-closed);
   * on an unparseable / non-workload doc we surface a message and leave the
   * draft untouched so the user can fix it. */
  const backfill = () => {
    const parsed = parseWorkloadYaml(yamlDraft);
    if (!parsed) {
      setParseError(t('wizard.parseFail', 'Cannot parse this YAML as a workload'));
      return;
    }
    setParseError(null);
    const next = { ...form, ...parsed };
    setForm(next);
    setYamlDraft(generateWorkloadYaml(next));
    setDraftGen((g) => g + 1);
    setDry(null);
    setStale(false);
    setApplyResults([]);
  };

  // Esc closes, matching every other dismissible surface (the OnboardingWizard
  // contract). The component only stays mounted while the overlay is open, so
  // the listener's lifetime is the dialog's lifetime.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('wizard.title', 'Create Workload')}
      >
        <header className={styles.header}>
          <h2 className={styles.title}>{t('wizard.title', 'Create Workload')}</h2>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t('wizard.close', 'Close')}>
            ×
          </button>
        </header>

        <div className={styles.stepper}>
          {steps.map((label, i) => (
            <span key={label} className={i === step ? styles.stepActive : styles.step}>
              {STEP_MARKS[i]} {label}
            </span>
          ))}
        </div>

        <div className={styles.body}>
          {step === 0 && <Basics form={form} onChange={set} />}
          {step === 1 && <Container form={form} onChange={set} />}
          {step === 2 && <Mounts form={form} onChange={set} />}
          {step === 3 && (
            <div className={styles.preview}>
              <div className={styles.previewBar}>
                <p className={styles.hint}>{t('wizard.preview', 'YAML preview')}</p>
                <button type="button" className={styles.addBtn} onClick={backfill}>
                  {t('wizard.backfill', 'Fill form from YAML')}
                </button>
              </div>
              <div className={styles.previewEditor}>
                <CodeEditor
                  key={draftGen}
                  value={yamlDraft}
                  editable
                  onChange={(d) => {
                    setYamlDraft(d);
                    // Any edit invalidates a prior dry run — apply re-gates
                    // until the user re-runs 检查 against the new draft.
                    setStale(true);
                    setDry(null);
                    setParseError(null);
                  }}
                />
              </div>
              {parseError && <p className={styles.error}>{parseError}</p>}
              {stale && (
                <p className={styles.staleHint}>
                  {t('wizard.stale', 'Edit detected — run Check again before applying')}
                </p>
              )}
              {fatalError && <p className={styles.error}>{fatalError}</p>}
              {dry !== null && (
                <>
                  <p className={clean ? styles.statusOk : styles.error}>
                    {clean
                      ? t('wizard.checkOk', 'Check passed')
                      : t('wizard.hasErrors', 'Errors found')}
                  </p>
                  <YamlReview review={dry} />
                </>
              )}
              {applyResults.length > 0 && (
                <ul className={styles.results}>
                  {applyResults.map((r, i) => (
                    <li key={i} className={r.action === 'failed' ? styles.resultErr : undefined}>
                      {r.action} {r.kind}/{r.name}
                      {r.namespace ? ` (${r.namespace})` : ''}
                      {r.error ? ` — ${r.error}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {step === 0 && errs.length > 0 && (
            <p className={styles.error} data-testid="wizard-errors">
              {t('wizard.fixErrors', 'Fix the highlighted fields to continue')}
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          {step > 0 && (
            <button type="button" className={styles.btn} onClick={() => setStep((s) => s - 1)}>
              {t('wizard.prev', 'Back')}
            </button>
          )}
          {step === 3 && (
            <>
              <button
                type="button"
                className={styles.btn}
                disabled={checking || applying}
                onClick={() => void check()}
              >
                {checking
                  ? t('wizard.checking', 'Checking…')
                  : t('wizard.check', 'Check')}
              </button>
              <button
                type="button"
                className={styles.btnPrimary}
                disabled={!clean || checking || applying}
                onClick={() => void apply()}
              >
                {applying
                  ? t('wizard.applying', 'Applying…')
                  : t('wizard.apply', 'Apply')}
              </button>
            </>
          )}
          {step < 3 && (
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={step === 0 && errs.length > 0}
              onClick={() => {
                if (step === 2) {
                  // Entering review: seed the draft from the form (and reset
                  // the gate). Re-entering after going back regenerates —
                  // manual draft edits don't survive a step round-trip.
                  setYamlDraft(generateWorkloadYaml(form));
                  setDraftGen((g) => g + 1);
                  setDry(null);
                  setStale(false);
                  setParseError(null);
                  setFatalError(null);
                  setApplyResults([]);
                }
                setStep((s) => s + 1);
              }}
            >
              {t('wizard.next', 'Next')}
            </button>
          )}
          <button type="button" className={styles.btn} onClick={onClose}>
            {t('wizard.close', 'Close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
