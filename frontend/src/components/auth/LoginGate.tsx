/**
 * LoginGate — the web-mode auth gate (Task 8).
 *
 * Only the browser shell sees it: on desktop (Tauri) the gate passes children
 * straight through without touching the network. In web mode it asks
 * `GET /api/auth/status` once on mount:
 * - `authRequired: false` (loopback) → children.
 * - `authRequired: true, configured: false` → first-run setup form (POST
 *   `/api/auth/setup`).
 * - `authRequired: true, configured: true` → sign-in form (POST
 *   `/api/auth/login`).
 *
 * While the status is loading — and if the status fetch fails at all — the
 * children render. That fail-open keeps a dead status endpoint from locking
 * the user out of a loopback dev session, and avoids flashing the gate on
 * connections that never needed it. A successful setup/login sets the
 * `k7s_session` cookie (HttpOnly, attached by the browser), so the page
 * reloads wholesale to pick up the authenticated session.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { isHttpMode } from '../../providers/HttpProvider';
import styles from './LoginGate.module.css';

/** Wire shape of `GET /api/auth/status` (k7s-server Task 7). */
interface Status {
  authRequired: boolean;
  configured: boolean;
}

export function LoginGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isHttpMode()) return;
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null)); // fail open — render the app
  }, []);

  // Desktop, status still loading, status fetch failed, or no auth required:
  // all pass through. The gate only mounts its form once the server said so.
  if (!isHttpMode() || !status || !status.authRequired) return <>{children}</>;

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const endpoint = status.configured ? '/api/auth/login' : '/api/auth/setup';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      // Map the server's stable error strings onto localized copy. Unknown
      // errors (including "password required" from a malformed post) fall
      // through to the wrong-password message — generic, but honest enough
      // for a single-user gate.
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(
        body.error === 'password already configured'
          ? t('auth.err.configured', 'Password already configured — sign in instead')
          : body.error === 'password must be >= 8 chars'
            ? t('auth.err.short', 'Password must be at least 8 characters')
            : t('auth.err.wrong', 'Wrong password')
      );
    } catch {
      // Network-level failure — same generic message; the password never
      // leaves this component except in the POST body above.
      setErr(t('auth.err.wrong', 'Wrong password'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <form
        className={styles.card}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 className={styles.brand}>k7s</h1>
        <h2>{status.configured ? t('auth.login.title', 'Sign in') : t('auth.setup.title', 'Set an access password')}</h2>
        {!status.configured && <p className={styles.hint}>{t('auth.setup.hint', 'First run: set an admin password for this instance (8+ characters).')}</p>}
        <input
          type="password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          autoFocus
          autoComplete={status.configured ? 'current-password' : 'new-password'}
        />
        {err && <div className={styles.err}>{err}</div>}
        <button type="submit" disabled={busy || pwd.length < 8}>
          {status.configured ? t('auth.login.submit', 'Sign in') : t('auth.setup.submit', 'Save and continue')}
        </button>
      </form>
    </div>
  );
}
