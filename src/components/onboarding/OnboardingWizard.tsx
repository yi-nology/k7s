/**
 * OnboardingWizard — first-run guide in three steps (Task 9):
 * import kubeconfig → connection confirm → preferences.
 *
 * All cluster access goes through the DataProvider abstraction
 * (`getProvider().importKubeconfig()` — desktop opens the native picker, web
 * uploads a file), so the wizard is the same code in both shells.
 *
 * Completion contract: only `finish()` writes the `k7s.onboarded` flag (via
 * {@link markOnboarded}), sets the default namespace, and closes the dialog.
 * Esc / backdrop dismissal closes *without* the flag, so an interrupted wizard
 * re-opens on the next launch (the App auto-opens it whenever the flag is
 * absent).
 */

import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { useTranslation } from '../../hooks/useI18n';
import { getProvider } from '../../providers';
import { markOnboarded } from '../../lib/onboarded';
import styles from './OnboardingWizard.module.css';

export function OnboardingWizard() {
  const open = useStore((s) => s.onboardingOpen);
  const setOpen = useStore((s) => s.setOnboardingOpen);
  const connection = useStore((s) => s.connection);
  const [step, setStep] = useState(0);
  const [defaultNs, setDefaultNs] = useState('default');
  const { t } = useTranslation();

  // Esc closes, matching every other dismissible surface in the app (the
  // settings panel / palette contract). Runs only while open, and never
  // writes the finished flag — see the component docblock.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Hooks above stay unconditional (hook order must not depend on `open`).
  if (!open) return null;

  /** Apply the prefs and mark onboarding as done — the only flag writer. */
  const finish = () => {
    markOnboarded();
    useStore.getState().setNamespace(defaultNs);
    setOpen(false);
  };

  /** Open the file picker; advance on a successful import. */
  const pick = async () => {
    try {
      const result = await getProvider().importKubeconfig();
      if (!result) return; // cancelled the picker
      // Merge the imported contexts into the switcher list and remember the
      // file (B17 restore) — the same integration the command palette and
      // cluster switcher perform on import.
      useStore.getState().setContexts(result.contexts);
      useStore.getState().addImportedFile(result.path);
      setStep(1);
    } catch (e) {
      // Real API errors (not a cancelled picker) — worth a console note;
      // the provider-level error reporter surfaces it as a toast too.
      console.error('[onboarding] import failed:', e);
    }
  };

  return (
    // Click the scrim (not the dialog) → close. Same contract as the settings
    // modal: Esc or outside, and no flag write on either.
    <div className={styles.backdrop} onClick={() => setOpen(false)}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('onboarding.step1', 'Import cluster')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.stepper}>
          <span className={step === 0 ? styles.stepActive : styles.step}>① {t('onboarding.step1', 'Import cluster')}</span>
          <span className={step === 1 ? styles.stepActive : styles.step}>② {t('onboarding.step2', 'Connection check')}</span>
          <span className={step === 2 ? styles.stepActive : styles.step}>③ {t('onboarding.step3', 'Preferences')}</span>
        </div>
        {step === 0 && (
          <div>
            <p className={styles.hint}>{t('onboarding.import.hint', 'Pick a kubeconfig file or paste its contents.')}</p>
            <button type="button" className={styles.primary} onClick={() => void pick()}>
              {t('onboarding.import.pick', 'Choose file…')}
            </button>
          </div>
        )}
        {step === 1 && (
          <div>
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
