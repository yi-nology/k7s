/**
 * Tests for useErrorToast (P3 Task 4) — the toast stack's kind channel.
 *
 * showError keeps its existing contract (default kind 'error', default 5s
 * duration); the new showSuccess pushes a kind:'success' toast with a shorter
 * 4s default. Both share the stack (cap, dismissal) — only the kind and the
 * default duration differ.
 */

import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { renderHook } from './testUtils';
import { useErrorToast, type UseErrorToastReturn } from './useErrorToast';

/**
 * Mount the hook and return a live view over its return value. `toasts` is a
 * getter so assertions read the latest render's array (the hook returns a
 * fresh object each render); the callbacks are stable useCallback identities,
 * so capturing them once is fine.
 */
function mount(): UseErrorToastReturn {
  let current: UseErrorToastReturn | undefined;
  renderHook(() => {
    current = useErrorToast();
  });
  const first = current!;
  return {
    get toasts() {
      return current!.toasts;
    },
    showError: (...args) => first.showError(...args),
    showSuccess: (...args) => first.showSuccess(...args),
    dismissToast: (...args) => first.dismissToast(...args),
    clearAll: () => first.clearAll(),
  };
}

describe('useErrorToast', () => {
  it('showError pushes a toast with kind "error" (the default)', () => {
    const api = mount();
    act(() => api.showError('Boom', 'it broke'));
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0].kind).toBe('error');
    expect(api.toasts[0].title).toBe('Boom');
    expect(api.toasts[0].message).toBe('it broke');
    // Existing default: 5s auto-dismiss.
    expect(api.toasts[0].duration).toBe(5000);
  });

  it('showError keeps the explicit-duration override', () => {
    const api = mount();
    act(() => api.showError('Boom', 'it broke', 0));
    expect(api.toasts[0].duration).toBe(0);
    expect(api.toasts[0].kind).toBe('error');
  });

  it('showSuccess pushes a kind "success" toast with a 4s default', () => {
    const api = mount();
    act(() => api.showSuccess('Applied', 'created Deployment/nginx'));
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0].kind).toBe('success');
    expect(api.toasts[0].title).toBe('Applied');
    expect(api.toasts[0].message).toBe('created Deployment/nginx');
    expect(api.toasts[0].duration).toBe(4000);
  });

  it('showSuccess accepts an explicit duration', () => {
    const api = mount();
    act(() => api.showSuccess('Applied', 'ok', 8000));
    expect(api.toasts[0].duration).toBe(8000);
  });

  it('success and error toasts share one stack and dismissal', () => {
    const api = mount();
    act(() => {
      api.showError('Boom', 'a');
      api.showSuccess('Applied', 'b');
    });
    expect(api.toasts).toHaveLength(2);
    expect(api.toasts.map((t) => t.kind)).toEqual(['error', 'success']);
    act(() => api.dismissToast(api.toasts[0].id));
    expect(api.toasts).toHaveLength(1);
    expect(api.toasts[0].kind).toBe('success');
  });

  it('cap of 5 evicts the oldest regardless of kind', () => {
    const api = mount();
    act(() => {
      api.showError('e1', 'm');
      api.showError('e2', 'm');
      api.showError('e3', 'm');
      api.showSuccess('s4', 'm');
      api.showSuccess('s5', 'm');
      api.showSuccess('s6', 'm');
    });
    expect(api.toasts).toHaveLength(5);
    expect(api.toasts.map((t) => t.title)).toEqual(['e2', 'e3', 's4', 's5', 's6']);
  });
});
