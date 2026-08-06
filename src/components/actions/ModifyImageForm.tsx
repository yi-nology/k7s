/**
 * ModifyImageForm — the "Modify image…" row action (Bxx — KubePi parity).
 *
 * The flow: fetch the workload's YAML, extract each container's current
 * image, render an input per container, and on submit rewrite the YAML
 * in-place and apply it via the same `applyYaml` path the YAML editor
 * uses. That way the user gets the existing dry-run → review → apply
 * safety net for free.
 *
 * Why a separate component (not inlined in ActionList.tsx):
 *   - The form fetches YAML on mount — a side-effecting operation that
 *     doesn't fit the menu's render-only model.
 *   - The scale and port-forward forms in ActionList are one-liner
 *     `<input type="number">`s; this is multi-step (load → input →
 *     apply) and would dwarf the menu it sits in.
 *   - Keeping the form small makes it independently testable.
 *
 * State: `images` is the user's current input values, keyed by the
 * container's stable name. The initial values come from the YAML we
 * fetch; if the user cancels or the fetch fails, we never call
 * `applyYaml`, so the cluster is left alone.
 */
import { useState } from 'react';
import { formatError, getProvider } from '../../providers';
import { useAsyncEffect } from '../../hooks/useAsyncEffect';
import { useTranslation } from '../../hooks/useI18n';
import { extractContainerImages, rewriteContainerImage } from '../../lib/imageUpgrade';
import { isValidImageRef } from '../../lib/security';
import type { ResourceRef } from '../../providers/types';
import styles from './ModifyImageForm.module.css';

interface ModifyImageFormProps {
  ref: ResourceRef;
  /** Where to route API / state errors (e.g. RBAC denials). The caller
   *  is responsible for rendering the message; the form is pure. */
  onError: (msg: string | null) => void;
  /** Close the surrounding menu (only on a successful apply, or on
   *  cancel). Errors keep the menu open so the user can see them. */
  onClose: () => void;
}

export function ModifyImageForm({ ref: resourceRef, onError, onClose }: ModifyImageFormProps) {
  const { t } = useTranslation();

  // The form is a small state machine:
  //   loading → ready (success) | error (fetch failed)
  //   ready → applying → success | error
  // We don't model the success state — the parent closes the menu.
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<Record<string, string> | null>(null);
  // The original images are kept around so the form can show a "reset
  // to original" affordance — same pattern as the scale form, which
  // resets the input to the row's `currentReplicas`.
  const [originalImages, setOriginalImages] = useState<Record<string, string>>({});
  const [fetchError, setFetchError] = useState<string | null>(null);

  useAsyncEffect(async (isMounted) => {
    setFetchError(null);
    const effectRef: ResourceRef = {
      kind: resourceRef.kind,
      namespace: resourceRef.namespace,
      name: resourceRef.name,
    };
    try {
      const yaml = await getProvider().getYaml(effectRef);
      if (!isMounted()) return;
      const containers = extractContainerImages(yaml);
      if (containers.length === 0) {
        // The workload has no `containers:` — odd, but possible
        // (e.g. an empty pod template under construction). Surface
        // it as an error rather than a dead form.
        setFetchError(t('actions.modifyImage.noContainers', 'no containers found in YAML'));
        return;
      }
      const init: Record<string, string> = {};
      for (const c of containers) init[c.name] = c.image;
      setImages(init);
      setOriginalImages(init);
    } catch (e) {
      if (!isMounted()) return;
      setFetchError(formatError(e));
    }
  }, [resourceRef.kind, resourceRef.namespace, resourceRef.name, t]);

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!images || busy) return;
    setBusy(true);
    onError(null);
    try {
      // Fetch fresh YAML right before applying — the manifest might
      // have changed between the form's load and the user's submit,
      // and we want to re-parse against the current text rather than
      // trust our cached fetch.
      const yaml = await getProvider().getYaml(resourceRef);
      let next = yaml;
      for (const [name, newImage] of Object.entries(images)) {
        // Skip entries the user didn't change — fewer rewrites, a
        // cleaner diff in the dry-run review.
        if (newImage === originalImages[name]) continue;
        if (!newImage.trim()) {
          // The form's required attribute already blocks this, but
          // the trim catches pasted whitespace.
          onError(t('actions.modifyImage.empty', 'image must not be empty'));
          return;
        }
        // Validate image reference format to prevent injection
        if (!isValidImageRef(newImage)) {
          onError(
            t(
              'actions.modifyImage.invalidImage',
              'invalid image reference: contains disallowed characters'
            )
          );
          return;
        }
        next = rewriteContainerImage(next, name, newImage);
      }
      // Use the same dry-run → review flow as the YamlTab. We don't
      // need to render the diff here; the user already saw the
      // previews of the values they typed. The dry-run still catches
      // admission-webhook rejections before the cluster sees them.
      await getProvider().dryRunYaml(resourceRef, next);
      await getProvider().applyYaml(resourceRef, next);
      onClose();
    } catch (e2) {
      onError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  if (fetchError) {
    return (
      <div className={styles.menu}>
        <div className={styles.error}>{fetchError}</div>
        <div className={styles.confirmRow}>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>
            {t('chrome.common.cancel')}
          </button>
        </div>
      </div>
    );
  }
  if (!images) {
    return (
      <div className={styles.menu}>
        <div className={styles.loading}>{t('actions.modifyImage.loading', 'loading…')}</div>
      </div>
    );
  }

  return (
    <div className={styles.menu}>
      <form onSubmit={apply} className={styles.form}>
        <div className={styles.confirm}>
          <div className={styles.confirmText}>
            {t('actions.modifyImage.title', resourceRef.name)}
          </div>
          {Object.entries(images).map(([name, image]) => (
            <label key={name} className={styles.field}>
              <span className={styles.fieldLabel}>
                {name}
                {originalImages[name] && originalImages[name] !== image && (
                  <button
                    type="button"
                    className={styles.resetBtn}
                    onClick={() => setImages({ ...images, [name]: originalImages[name] })}
                    title={t('actions.modifyImage.reset', 'reset to original')}
                  >
                    ↺
                  </button>
                )}
              </span>
              <input
                type="text"
                value={image}
                disabled={busy}
                required
                className={styles.input}
                onChange={(e) => setImages({ ...images, [name]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className={styles.confirmRow}>
          <div
            className={styles.cancelBtn}
            aria-disabled={busy}
            onClick={() => {
              if (busy) return;
              onClose();
            }}
          >
            {t('chrome.common.cancel')}
          </div>
          <button type="submit" className={styles.applyBtn} disabled={busy}>
            {busy ? t('actions.modifyImage.applying', 'Applying…') : t('chrome.common.apply')}
          </button>
        </div>
      </form>
    </div>
  );
}
