/**
 * User settings (B23) and the rules for keeping them sane.
 *
 * These are typed into a text field and then fed to real loops — a ring buffer, a
 * poll interval, an exec command — so every value is clamped on the way in rather
 * than trusted. A cap of 0 would silently discard every log line; a 1ms poll
 * interval would hammer the API server. Bad input is corrected, never rejected:
 * the panel edits live, and yanking the field out from under someone mid-keystroke
 * is worse than briefly holding a value that gets clamped on blur.
 */

import { asTheme, type Theme } from './theme';
import { asLocale, type Locale } from './i18n';
import { isValidImageRef } from './security';

/** Everything the settings panel controls. */
export interface Settings {
  /** Lines the log view retains (the design default is 200). */
  logBufferCap: number;
  /** Seconds between pod/node metrics polls. */
  metricsIntervalSecs: number;
  /** Seconds between cluster-status polls. */
  statusIntervalSecs: number;
  /** Namespace selected on connect; "all" for no filter. */
  defaultNamespace: string;
  /**
   * Command run when opening a shell. Empty means the built-in probe, which
   * prefers bash and falls back to sh.
   */
  shellCommand: string;
  /** Colour palette; "system" follows the OS (B52). */
  theme: Theme;
  /**
   * UI language for chrome (sidebar, top bar, tabs, settings). Defaults to
   * "zh"; an unrecognised value falls back to the same. Picked by the user
   * and persisted like the other settings — a saved choice always wins.
   */
  language: Locale;
  /**
   * Image for the node debug shell (B53). Empty uses the built-in default.
   *
   * Worth exposing because the constraints are real and cluster-specific: the
   * image must be multi-arch on a mixed-arch cluster, must carry a full `nsenter`,
   * and on an air-gapped cluster must come from a registry the nodes can reach.
   */
  nodeShellImage: string;
  // ---- scanner (SBOM / image vulnerability scanning) ----
  /** Custom path to the trivy binary; empty = auto-detect. */
  scannerTrivyPath: string;
  /** Custom path to the grype binary; empty = auto-detect. */
  scannerGrypePath: string;
  /** Timeout for scanner invocations (e.g. "5m", "300s"); empty = 5m default. */
  scannerTimeout: string;
  // ---- editor / terminal ----
  /** Font size for the YAML editor and other CodeMirror surfaces. */
  editorFontSize: number;
  /** Font size for the terminal (xterm). */
  terminalFontSize: number;
  /** Scrollback lines for the terminal. */
  terminalScrollback: number;
  /** Detail panel width as percentage of content area (25–70). */
  detailWidthPct: number;
}

export const DEFAULT_SETTINGS: Settings = {
  logBufferCap: 200,
  metricsIntervalSecs: 15,
  statusIntervalSecs: 10,
  defaultNamespace: 'all',
  shellCommand: '',
  // Following the OS is the least surprising default, and it's what the app did
  // implicitly before there was a choice — for anyone on a dark desktop.
  theme: 'system',
  // Chinese is the default UI locale: the primary audience reads zh, and
  // English remains the dictionary-level fallback for untranslated keys (see
  // `translate`). Users who picked "en" have it persisted, so the default only
  // affects fresh installs and prefs files that predate the language setting.
  language: 'zh',
  nodeShellImage: '',
  scannerTrivyPath: '',
  scannerGrypePath: '',
  scannerTimeout: '',
  editorFontSize: 12,
  terminalFontSize: 12,
  terminalScrollback: 5000,
  detailWidthPct: 48,
};

/**
 * Bounds for the numeric settings. The lower bounds are where the feature stops
 * working (a handful of log lines is useless; sub-5s polling is rude to the API
 * server); the upper bounds are where it stops being a setting and becomes a
 * memory leak or an effectively-frozen display.
 */
export const LIMITS = {
  logBufferCap: { min: 50, max: 5000 },
  metricsIntervalSecs: { min: 5, max: 300 },
  statusIntervalSecs: { min: 5, max: 300 },
  editorFontSize: { min: 9, max: 18 },
  terminalFontSize: { min: 9, max: 18 },
  terminalScrollback: { min: 1000, max: 50000 },
  detailWidthPct: { min: 25, max: 70 },
} as const;

/**
 * What `sanitizeSettings` accepts: the same keys, but any value.
 *
 * Deliberately looser than `Partial<Settings>` — its callers are persisted JSON
 * and half-typed form fields, neither of which is typed by construction. Claiming
 * the input is already `Partial<Settings>` would put the cast at every call site
 * instead of inside the one function whose job is to check.
 */
export type SettingsInput = Partial<Record<keyof Settings, unknown>>;

/** Clamp a number into a range, falling back to `fallback` for junk input. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  // NaN/Infinity from an empty or half-typed field: keep the default rather than
  // writing garbage into a loop bound.
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Sanitize node shell image: validate format if non-empty, trim whitespace. */
function sanitizeNodeShellImage(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Use image reference validation to catch obviously invalid/dangerous inputs
  if (!isValidImageRef(trimmed)) return '';
  return trimmed;
}

/** Sanitize a filesystem path: trim, reject shell metacharacters and traversal. */
function sanitizePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Block shell metacharacters that enable injection (but allow ~, #, !).
  if (/[;&|`$(){}<>]/.test(trimmed)) return '';
  // Block relative traversal.
  if (trimmed.includes('..')) return '';
  return trimmed;
}

/** Sanitize a timeout string like "5m", "300s", "1h". Empty = default. */
function sanitizeTimeout(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Must be a number followed by s, m, or h.
  if (!/^\d+[smh]$/i.test(trimmed)) return '';
  return trimmed;
}

/**
 * Coerce anything (persisted prefs from an older version, a half-typed field)
 * into usable settings. Every field falls back to its default independently, so
 * one bad value can't discard the rest.
 */
export function sanitizeSettings(raw: SettingsInput | null | undefined): Settings {
  const s = raw ?? {};
  return {
    logBufferCap: clampNumber(
      s.logBufferCap,
      LIMITS.logBufferCap.min,
      LIMITS.logBufferCap.max,
      DEFAULT_SETTINGS.logBufferCap
    ),
    metricsIntervalSecs: clampNumber(
      s.metricsIntervalSecs,
      LIMITS.metricsIntervalSecs.min,
      LIMITS.metricsIntervalSecs.max,
      DEFAULT_SETTINGS.metricsIntervalSecs
    ),
    statusIntervalSecs: clampNumber(
      s.statusIntervalSecs,
      LIMITS.statusIntervalSecs.min,
      LIMITS.statusIntervalSecs.max,
      DEFAULT_SETTINGS.statusIntervalSecs
    ),
    defaultNamespace:
      typeof s.defaultNamespace === 'string' && s.defaultNamespace.trim() !== ''
        ? s.defaultNamespace.trim()
        : DEFAULT_SETTINGS.defaultNamespace,
    shellCommand: typeof s.shellCommand === 'string' ? s.shellCommand.trim() : '',
    // Not a clamp: an unknown string (older prefs, hand-edited file) has no
    // nearest valid value, so it falls back to the default outright.
    theme: asTheme(s.theme),
    language: asLocale(s.language),
    nodeShellImage:
      typeof s.nodeShellImage === 'string' ? sanitizeNodeShellImage(s.nodeShellImage) : '',
    scannerTrivyPath:
      typeof s.scannerTrivyPath === 'string' ? sanitizePath(s.scannerTrivyPath) : '',
    scannerGrypePath:
      typeof s.scannerGrypePath === 'string' ? sanitizePath(s.scannerGrypePath) : '',
    scannerTimeout:
      typeof s.scannerTimeout === 'string' ? sanitizeTimeout(s.scannerTimeout) : '',
    editorFontSize: clampNumber(
      s.editorFontSize,
      LIMITS.editorFontSize.min,
      LIMITS.editorFontSize.max,
      DEFAULT_SETTINGS.editorFontSize
    ),
    terminalFontSize: clampNumber(
      s.terminalFontSize,
      LIMITS.terminalFontSize.min,
      LIMITS.terminalFontSize.max,
      DEFAULT_SETTINGS.terminalFontSize
    ),
    terminalScrollback: clampNumber(
      s.terminalScrollback,
      LIMITS.terminalScrollback.min,
      LIMITS.terminalScrollback.max,
      DEFAULT_SETTINGS.terminalScrollback
    ),
    detailWidthPct: clampNumber(
      s.detailWidthPct,
      LIMITS.detailWidthPct.min,
      LIMITS.detailWidthPct.max,
      DEFAULT_SETTINGS.detailWidthPct
    ),
  };
}
