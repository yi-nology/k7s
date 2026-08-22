/**
 * Tests for ErrorToast (P3 Task 4) — the success variant.
 *
 * The toast card picks its accent class, icon, and ARIA semantics from
 * `toast.kind`: errors keep the red `--status-err` chrome + role="alert" the
 * component always had; success toasts carry the "success" class, a
 * CheckCircle2 icon, and the gentler role="status" / aria-live="polite".
 * The store locale is pinned to en by the global setup, so the region's
 * aria-label is the English "Notifications".
 */

import { describe, expect, it } from 'vitest';
import { render } from '../../test/componentUtils';
import { ErrorToast, type Toast } from './ErrorToast';

const onDismiss = () => {};
const errToast: Toast = {
  id: 't-err',
  title: 'Apply failed',
  message: 'forbidden: User cannot get resource',
  duration: 0, // persistent — no auto-dismiss timer in jsdom
  kind: 'error',
};
const okToast: Toast = {
  id: 't-ok',
  title: 'Applied',
  message: 'created Deployment/nginx',
  duration: 0,
  kind: 'success',
};

describe('ErrorToast', () => {
  it('renders an error toast without the success class, role=alert', () => {
    const view = render(<ErrorToast toasts={[errToast]} onDismiss={onDismiss} />);
    const card = view.container.querySelector('[role="alert"]');
    expect(card).not.toBeNull();
    expect(card!.className).not.toMatch(/success/);
    expect(card!.getAttribute('aria-live')).toBe('assertive');
    expect(card!.textContent).toContain('Apply failed');
  });

  it('renders a success toast with the success class, role=status, polite', () => {
    const view = render(<ErrorToast toasts={[okToast]} onDismiss={onDismiss} />);
    const card = view.container.querySelector('[class*="success"]');
    expect(card).not.toBeNull();
    expect(card!.getAttribute('role')).toBe('status');
    expect(card!.getAttribute('aria-live')).toBe('polite');
    // The toast content still renders.
    expect(card!.textContent).toContain('Applied');
    expect(card!.textContent).toContain('created Deployment/nginx');
  });

  it('defaults to the error chrome when kind is omitted (back-compat)', () => {
    const legacy: Toast = { id: 't-legacy', title: 'Old', message: 'no kind field', duration: 0 };
    const view = render(<ErrorToast toasts={[legacy]} onDismiss={onDismiss} />);
    const card = view.container.querySelector('[role="alert"]');
    expect(card).not.toBeNull();
    expect(card!.className).not.toMatch(/success/);
    expect(view.container.querySelector('[role="status"]')).toBeNull();
  });

  it('renders both kinds side by side in one stack', () => {
    const view = render(<ErrorToast toasts={[errToast, okToast]} onDismiss={onDismiss} />);
    expect(view.container.querySelectorAll('[class*="success"]').length).toBe(1);
    expect(view.container.querySelectorAll('[role="alert"]').length).toBe(1);
    expect(view.container.querySelectorAll('[role="status"]').length).toBe(1);
  });
});
