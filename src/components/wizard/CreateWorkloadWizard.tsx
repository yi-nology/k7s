/**
 * CreateWorkloadWizard — Kuboard-style 4-step create-workload wizard
 * (P2 Task 3): basics → container → storage → review.
 *
 * All step state and form state live here; steps 1-3 render the dumb,
 * controlled fragments from StepFields.tsx. The step-0 gate is Task 2's pure
 * validator (`validateWorkloadForm(form).length === 0`), which is also what
 * keeps the YAML on step 4 generatable. Step 4 is a READ-ONLY preview —
 * dry-run / apply / editable YAML land in Task 4.
 *
 * Mounted through the overlay dispatch table in App.tsx on key 'wizard'
 * (opened via `openOverlay('wizard')` — the entry points are wired in a later
 * task). The backdrop + centered dialog mirror OnboardingWizard's modal
 * contract: role=dialog + aria-modal, and Esc on the document closes.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { CodeEditor } from '../detail/CodeEditor';
import { Basics, Container, Mounts } from './StepFields';
import {
  emptyWorkloadForm,
  generateWorkloadYaml,
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

  // The gate for leaving step 0 (carry-forward from Task 2's review): empty
  // array = valid. Later steps edit only optional fields, so they stay open.
  const errs = validateWorkloadForm(form);
  const steps = [
    t('wizard.step.basics', 'Basics'),
    t('wizard.step.container', 'Container'),
    t('wizard.step.storage', 'Storage & Config'),
    t('wizard.step.review', 'Review & Apply'),
  ];

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
              <p className={styles.hint}>{t('wizard.preview', 'YAML preview')}</p>
              <div className={styles.previewEditor}>
                <CodeEditor value={generateWorkloadYaml(form)} editable={false} />
              </div>
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
          {step < 3 && (
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={step === 0 && errs.length > 0}
              onClick={() => setStep((s) => s + 1)}
            >
              {t('wizard.next', 'Next')}
            </button>
          )}
          {/* Last step: prev + close only — apply/dry-run arrive in Task 4. */}
          <button type="button" className={styles.btn} onClick={onClose}>
            {t('wizard.close', 'Close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
