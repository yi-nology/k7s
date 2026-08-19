/**
 * errorsHuman — map raw provider error strings to a friendlier, localized
 * toast title (P3 Task 4).
 *
 * Kubernetes client errors reach the UI as long English chains like
 * `kubernetes error: ServiceError: client error (Connect)` that say nothing
 * actionable to the operator. This table matches known patterns (in order —
 * the first hit wins) and returns an i18n key plus an English fallback; the
 * caller (`App.tsx`'s error-reporter wrapper) shows the localized title with
 * the *original* raw string as the toast body, so no diagnostic information
 * is lost.
 *
 * Pure regex table, no dependencies: trivially testable and safe to call from
 * anywhere. Unknown error strings return `null` — the caller then keeps the
 * title it was given.
 */

/** A known error pattern → the i18n key + English fallback for its title. */
interface HumanPattern {
  /** Case-insensitive source pattern. */
  pattern: RegExp;
  /** i18n key under the `errors.*` group. */
  key: string;
  /** English copy for `t(key, fallback)` when the dictionary lacks the key. */
  fallback: string;
}

/**
 * Ordered pattern table. Order matters only for overlapping inputs; in
 * practice the four families are disjoint (a connect error does not say
 * "forbidden"), but the list is checked top-down and the first match wins.
 */
const PATTERNS: HumanPattern[] = [
  // kubeclient ServiceError connect chains, TCP refusals, HTTP client errors.
  {
    pattern: /client error \(connect\)|connection refused|connect error/i,
    key: 'errors.connect',
    fallback: 'Cannot reach the cluster API',
  },
  // RBAC denials — the apiserver's forbidden response and bare 403s.
  { pattern: /forbidden|\b403\b/i, key: 'errors.rbac', fallback: 'Permission denied (RBAC)' },
  // Auth rejections — expired/invalid tokens and bare 401s.
  {
    pattern: /unauthorized|invalid token|\b401\b/i,
    key: 'errors.auth',
    fallback: 'Authentication failed',
  },
  // Client/server timeouts ("timed out", "timedout", and the one-word "timeout").
  { pattern: /timed?\s*out|timeout/i, key: 'errors.timeout', fallback: 'Request timed out' },
];

/**
 * Match a raw error string against the known patterns.
 *
 * @param raw - The raw error message (e.g. an exception's `.message`).
 * @returns The i18n key + English fallback for the humanized title, or `null`
 *          when no pattern matches (caller keeps its own title).
 */
export function humanizeError(raw: string): { key: string; fallback: string } | null {
  for (const { pattern, key, fallback } of PATTERNS) {
    if (pattern.test(raw)) return { key, fallback };
  }
  return null;
}
