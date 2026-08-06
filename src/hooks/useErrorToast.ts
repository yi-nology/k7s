/**
 * useErrorToast — manages a stack of non-blocking error toasts.
 *
 * Returns the current toast list and functions to add/dismiss toasts.
 * Designed to be used at the app root with the `ErrorToast` component.
 *
 * Usage:
 *   const { toasts, showError, dismissToast } = useErrorToast();
 *   // In JSX:
 *   <ErrorToast toasts={toasts} onDismiss={dismissToast} />
 *   // Somewhere in a catch block:
 *   showError('Operation failed', 'Could not apply YAML');
 */

import { useCallback, useRef, useState } from 'react';
import type { Toast } from '../components/common/ErrorToast';

/** Default auto-dismiss duration (5 seconds). */
const DEFAULT_DURATION = 5000;

/** Maximum number of visible toasts before the oldest is dismissed. */
const MAX_TOASTS = 5;

export interface UseErrorToastReturn {
  toasts: Toast[];
  showError: (title: string, message: string, duration?: number) => void;
  dismissToast: (id: string) => void;
  clearAll: () => void;
}

export function useErrorToast(): UseErrorToastReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showError = useCallback(
    (title: string, message: string, duration: number = DEFAULT_DURATION) => {
      const id = `toast-${++counterRef.current}`;
      const toast: Toast = { id, title, message, duration };

      setToasts((prev) => {
        const next = [...prev, toast];
        // Evict the oldest toast if we exceed the cap.
        if (next.length > MAX_TOASTS) {
          return next.slice(-MAX_TOASTS);
        }
        return next;
      });
    },
    []
  );

  const clearAll = useCallback(() => {
    setToasts([]);
  }, []);

  return { toasts, showError, dismissToast, clearAll };
}
