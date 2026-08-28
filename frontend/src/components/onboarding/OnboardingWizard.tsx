/**
 * OnboardingWizard — first-run guide in three steps (Task 9):
 * import kubeconfig → connection confirm → preferences.
 *
 * All cluster access goes through the DataProvider abstraction
 * (`getProvider().importKubeconfig()` — desktop opens the native picker, web
 * uploads a file), so the wizard is same code in both shells.
 *
 * Completion contract: every close path writes the `k7s.onboarded` flag (via
 * {@link markOnboarded}). `finish()` additionally applies the prefs; Esc /
 * backdrop dismissal skips the prefs but still marks onboarding done — the
 * wizard must never nag twice, and a user who dismisses is deemed onboarded
 * (the `k7s.onboarded` key is new, so pre-upgrade installs would otherwise
 * see the wizard on every launch).
 */

import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { getProvider, KubeconfigImportError } from '../../providers';
import type { KubeconfigIssue } from '../../providers/types';
import { markOnboarded } from '../../lib/onboarded';
import styles from './OnboardingWizard.module.css';

export function OnboardingWizard() {
  const open = useStore((s) => s.onboardingOpen);
  const setOpen = useStore((s) => s.setOnboardingOpen);
  const connection = useStore((s) => s.connection);
  const [step, setStep] = useState(0);
  const [defaultNs, setDefaultNs] = useState('default');
  // Import-failure detail (parse errors show their message, validation
  // failures itemize per context) and advisory warnings from a successful
  // import — both rendered inline so the user sees exactly what's wrong.
  const [importError, setImportError] = useState<Error | null>(null);
  const [warnings, setWarnings] = useState<KubeconfigIssue[]>([]);
  const { t } = useTranslation();

  /** Close + mark done. Every dismissal path funnels through here so the
   *  wizard can never re-open on the next launch (see the docblock). */
  const dismiss = () => {
    markOnboarded();
    setOpen(false);
  };

  // Esc closes, matching every other dismissible surface in the app (the
  // settings panel / palette contract). Runs only while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        dismiss();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // `dismiss` is a close+mark helper over stable store setters; listing it
    // would rebind the listener every render for no behavioural change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, setOpen]);

  // Hooks above stay unconditional (hook order must not depend on `open`).
  if (!open) return null;

  /** Apply the prefs and mark onboarding as done. */
  const finish = () => {
    markOnboarded();
    useStore.getState().setNamespace(defaultNs);
    setOpen(false);
  };

  /** Open the file picker; advance on a successful import. */
  const pick = async () => {
    setImportError(null);
    setWarnings([]);
    try {
      const result = await getProvider().importKubeconfig();
      if (!result) return; // cancelled the picker
      // Merge the imported contexts into the switcher list and remember the
      // file (B17 restore) — the same integration the command palette and
      // cluster switcher perform on import.
      useStore.getState().setContexts(result.contexts);
      useStore.getState().addImportedFile(result.path);
      setWarnings(result.issues ?? []);
      setStep(1);
    } catch (e) {
      // Real API errors (not a cancelled picker). Rendered inline below —
      // parse failures show their message, validation failures itemize.
      console.error('[onboarding] import failed:', e);
      setImportError(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return (
    // Click the scrim (not the dialog) → close. Same contract as the settings
    // modal: Esc or outside, both marking onboarding done.
    <div className={styles.backdrop} onClick={dismiss}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('onboarding.step1', 'Import cluster')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <button type="button" className={styles.closeBtn} onClick={dismiss} aria-label={t('wizard.close', 'Close')}>
            ×
          </button>
        </header>
        <div className={styles.stepper}>
          <span className={step === 0 ? styles.stepActive : styles.step}>① {t('onboarding.step1', 'Import cluster')}</span>
          <span className={step === 1 ? styles.stepActive : styles.step}>② {t('onboarding.step2', 'Connection check')}</span>
          <span className={step === 2 ? styles.stepActive : styles.step}>③ {t('onboarding.step3', 'Preferences')}</span>
        </div>
        {step === 0 && (
          <div>
            <p className={styles.hint}>{t('onboarding.import.hint', 'Pick a kubeconfig file to get started.')}</p>
            <button type="button" className={styles.primary} onClick={() => void pick()}>
              {t('onboarding.import.pick', 'Choose file…')}
            </button>
            {importError && (
              <div className={styles.importError} role="alert">
                <p className={styles.issueTitle}>
                  {importError instanceof KubeconfigImportError && importError.issues?.length
                    ? t('onboarding.import.validationFailed', 'Validation failed')
                    : t('onboarding.import.parseFailed', "Couldn't parse the file")}
                </p>
                {importError instanceof KubeconfigImportError && importError.issues?.length ? (
                  <ul className={styles.issueList}>
                    {importError.issues.map((iss, i) => (
                      <li
                        key={i}
                        className={iss.severity === 'error' ? styles.issueError : styles.issueWarning}
                      >
                        {iss.context ? <b>{iss.context}: </b> : null}
                        {iss.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.issueMessage}>{importError.message}</p>
                )}
              </div>
            )}
          </div>
        )}
        {step === 1 && (
          <div>
            {warnings.length > 0 && (
              <div className={styles.importWarnings} role="status">
                <p className={styles.issueTitle}>
                  {t('onboarding.import.importedWithWarnings', 'Imported, with warnings')}
                </p>
                <ul className={styles.issueList}>
                  {warnings.map((iss, i) => (
                    <li key={i} className={styles.issueWarning}>
                      {iss.context ? <b>{iss.context}: </b> : null}
                      {iss.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className={styles.hint}>
              {connection.phase === 'connected'
                ? t('onboarding.conn.ok', 'Connected: {cluster}').replace(
                    '{cluster}',
                    connection.clusterName ?? connection.context ?? '?'
                  )
                : t('onboarding.conn.wait', 'Connecting… if this takes long, check your kubeconfig.')}
            </p>
            <button
              type="button"
              className={styles.next}
              disabled={connection.phase !== 'connected'}
              onClick={() => setStep(2)}
            >
              {t('onboarding.next', 'Next')}
            </button>
          </div>
        )}
        {step === 2 && (
          <div>
            <label className={styles.nsLabel}>
              {t('onboarding.prefs.ns', 'Default namespace')}
              <input
                className={styles.nsInput}
                value={defaultNs}
                onChange={(e) => setDefaultNs(e.target.value)}
              />
            </label>
            <button type="button" className={styles.primary} onClick={finish}>
              {t('onboarding.done', 'Go to overview')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
