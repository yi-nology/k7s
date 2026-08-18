/**
 * The onboarding "finished" flag (Task 9).
 *
 * `localStorage['k7s.onboarded']` marks that the user completed the first-run
 * wizard; while it is absent the App auto-opens the wizard. Only the wizard's
 * `finish()` writes it — Esc/backdrop dismissal must not, so an interrupted
 * run re-opens on the next launch.
 *
 * Same shape as `cachedLocale` / `cachedTheme`: read `window.localStorage`
 * first (the one the browser actually uses), and swallow storage failures —
 * the flag is an optimisation for first-run UX, not state; with storage
 * disabled the wizard simply re-opens each launch.
 */

/** Key the finished marker lives under. */
export const ONBOARDED_STORAGE_KEY = 'k7s.onboarded';

/** True once the user finished the wizard (or storage is unavailable). */
export function isOnboarded(): boolean {
  const store =
    typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  if (!store) return true; // no storage → don't nag on every launch
  try {
    return store.getItem(ONBOARDED_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

/** Persist the finished marker (called only from the wizard's finish()). */
export function markOnboarded(): void {
  const store =
    typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  if (!store) return;
  try {
    store.setItem(ONBOARDED_STORAGE_KEY, '1');
  } catch {
    /* storage disabled — the wizard just won't be suppressed next launch */
  }
}
