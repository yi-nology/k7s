/**
 * i18n hooks: a store-aware translator and a side-effecting locale applier.
 *
 * Same pattern as `useTheme`: a store subscription fires synchronously inside
 * `set()`, before React re-renders anything, so the document (`<html lang>`)
 * is always correct by the time any effect looks at it. The `useTranslation`
 * hook re-renders on locale change by selecting `s.settings.language` from the
 * store.
 *
 * Boot-time concerns (initial paint before React mounts) live in `index.html`:
 * that script reads the cached locale synchronously and sets `lang` before
 * the bundle has loaded. The hook here keeps the two in sync from then on.
 */

import { useEffect } from "react";
import { useStore } from "../store";
import {
  cacheLocale,
  cachedLocale,
  dict,
  translate,
  type Locale,
  LOCALE_STORAGE_KEY,
} from "../lib/i18n";

/** Apply the locale to the document and cache it for the next launch. */
function applyLocale(locale: Locale): void {
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
  cacheLocale(locale);
}

/**
 * The active locale, subscribed from the store. Components use this to read
 * `t(...)` results that update when the user changes the language setting.
 */
export function useLocale(): Locale {
  return useStore((s) => s.settings.language);
}

/**
 * A bound translator: `t("chrome.settings.title")` for a static string, or
 * `t("chrome.sidebar.watch", 5)` for a parameterised one.
 *
 * Re-binds on locale change so the `t` reference is stable per locale (handy
 * for memoised children), but the underlying dictionary lookup stays a single
 * function call away.
 */
export function useTranslation() {
  const locale = useLocale();
  return {
    locale,
    t: (key: string, ...args: unknown[]) => translate(locale, key, ...args),
  };
}

/**
 * Side-effecting locale applier. Mount once at the app root; the effect
 * mirrors the language pref onto `<html lang>` and the boot-time cache, so a
 * the OS-level language detection in the next launch lands on the right locale.
 */
export function useLocaleSync(): void {
  const locale = useStore((s) => s.settings.language);
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);
}

/**
 * Run once, before the first render. Mirrors the pattern of `startThemeSync`:
 * the document is in the right state before React paints, so a Settings panel
 * that opens right at boot reads the right value rather than a flash of
 * English.
 */
export function startLocaleSync(): void {
  applyLocale(cachedLocale());
}

// Re-exports for convenience.
export { translate, dict, cachedLocale, cacheLocale, LOCALE_STORAGE_KEY };
export type { Locale };
