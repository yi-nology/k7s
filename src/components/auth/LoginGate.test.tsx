/**
 * Tests for LoginGate — the web-mode auth gate (Task 8).
 *
 * Desktop (Tauri) never sees the gate; in web mode the gate stays invisible
 * until `/api/auth/status` says `authRequired`, then blocks the app behind a
 * setup (first run) or sign-in form. Status-fetch failures fail open (children
 * render) so a dead status endpoint can't lock the user out of a loopback
 * dev session.
 *
 * These tests assert localized copy, so each pins the locale to "en"
 * explicitly (the global setup pins it too — the pin keeps that explicit,
 * same contract as Sidebar.test.tsx pins "zh").
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { useStore } from '../../store';
import { render, cleanup, type RenderResult } from '../../test/componentUtils';
import { LoginGate } from './LoginGate';

// The gate asks HttpProvider's mode helper whether it runs in the browser
// shell. Hoisted so the vi.mock factory (which is hoisted above imports) can
// flip it per test.
const mode = vi.hoisted(() => ({ http: false }));
vi.mock('../../providers/HttpProvider', () => ({
  HttpProvider: class {},
  isHttpMode: () => mode.http,
}));

/** Minimal Response stand-in — jsdom has no fetch we want to lean on. */
function res(ok: boolean, body: unknown, status = 200): Response {
  return { ok, status, json: () => Promise.resolve(body) } as unknown as Response;
}

let view: RenderResult;
let fetchMock: ReturnType<typeof vi.fn>;
const originalLocation = window.location;
let reloadSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mode.http = false;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', { value: { reload: reloadSpy }, writable: true });
  // Locale pin — these tests assert English copy.
  useStore.setState({ settings: { ...useStore.getState().settings, language: 'en' } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
});

/** Flush the status-fetch microtask chain inside act. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('LoginGate', () => {
  it('passes through on desktop (no fetch, no gate)', async () => {
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    expect(view.queryByText('app')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders children while the status is loading (no gate flash)', async () => {
    mode.http = true;
    // Never-resolving status fetch — the gate must stay invisible.
    fetchMock.mockReturnValue(new Promise(() => {}));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    expect(view.queryByText('app')).not.toBeNull();
    expect(view.querySelector('form')).toBeNull();
  });

  it('fails open when the status fetch rejects', async () => {
    mode.http = true;
    fetchMock.mockRejectedValue(new Error('network down'));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    expect(view.queryByText('app')).not.toBeNull();
    expect(view.querySelector('form')).toBeNull();
  });

  it('passes through when authRequired is false (loopback dev)', async () => {
    mode.http = true;
    fetchMock.mockResolvedValue(res(true, { authRequired: false, configured: true }));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    expect(view.queryByText('app')).not.toBeNull();
    expect(view.querySelector('form')).toBeNull();
  });

  it('blocks with the sign-in form when authRequired and configured', async () => {
    mode.http = true;
    fetchMock.mockResolvedValue(res(true, { authRequired: true, configured: true }));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    // The app itself is gone; the sign-in card is up.
    expect(view.queryByText('app')).toBeNull();
    expect(view.getByText('k7s')).not.toBeNull();
    expect(view.getByText('Sign in')).not.toBeNull();
    expect(view.querySelector('input[type="password"]')).not.toBeNull();
    // No setup hint on the login variant.
    expect(view.queryByText(/set an admin password/i)).toBeNull();
  });

  it('shows setup copy when the password is not configured yet', async () => {
    mode.http = true;
    fetchMock.mockResolvedValue(res(true, { authRequired: true, configured: false }));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    expect(view.getByText('Set an access password')).not.toBeNull();
    expect(view.getByText(/set an admin password for this instance/i)).not.toBeNull();
    expect(view.getByText('Save and continue')).not.toBeNull();
    expect(view.queryByText('app')).toBeNull();
  });

  it('submit is disabled until the password is 8+ chars', async () => {
    mode.http = true;
    fetchMock.mockResolvedValue(res(true, { authRequired: true, configured: true }));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    const input = view.querySelector('input[type="password"]') as HTMLInputElement;
    const btn = view.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    view.change(input, 'short');
    expect(btn.disabled).toBe(true);
    view.change(input, 'longenough1');
    expect(btn.disabled).toBe(false);
  });

  it('maps a 401 wrong-password response to the localized error', async () => {
    mode.http = true;
    fetchMock.mockResolvedValueOnce(res(true, { authRequired: true, configured: true }));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    const input = view.querySelector('input[type="password"]') as HTMLInputElement;
    view.change(input, 'longenough1');
    const form = view.querySelector('form') as HTMLFormElement;
    // The login attempt 401s — the gate shows the localized error, no reload.
    fetchMock.mockResolvedValueOnce(res(false, { ok: false, error: 'wrong password' }, 401));
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ password: 'longenough1' }) })
    );
    expect(view.getByText('Wrong password')).not.toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('reloads the page after a successful login', async () => {
    mode.http = true;
    fetchMock.mockResolvedValueOnce(res(true, { authRequired: true, configured: true }));
    view = render(
      <LoginGate>
        <div>app</div>
      </LoginGate>
    );
    await flush();
    fetchMock.mockResolvedValueOnce(res(true, {}));
    const input = view.querySelector('input[type="password"]') as HTMLInputElement;
    view.change(input, 'longenough1');
    const form = view.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(reloadSpy).toHaveBeenCalled();
  });
});
