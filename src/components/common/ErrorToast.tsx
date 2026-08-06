/**
 * ErrorToast — a non-blocking error notification that slides in from the
 * top-right corner and auto-dismisses after a configurable duration.
 *
 * Multiple toasts stack vertically. Each toast has a close button for
 * manual dismissal. The component is rendered once at the app root and
 * driven by the `useErrorToast` hook.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { cx } from '../../lib/cx';
import styles from './ErrorToast.module.css';

/** A single toast notification. */
export interface Toast {
  id: string;
  title: string;
  message: string;
  /** Auto-dismiss delay in ms. 0 means persistent until manually closed. */
  duration: number;
}

interface InternalToast extends Toast {
  exiting: boolean;
}

interface ErrorToastProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ErrorToast({ toasts, onDismiss }: ErrorToastProps) {
  const [internal, setInternal] = useState<InternalToast[]>([]);

  // Sync incoming toasts with internal state (add new, start exit on removed).
  useEffect(() => {
    setInternal((prev) => {
      const prevMap = new Map(prev.map((t) => [t.id, t]));
      const next: InternalToast[] = [];

      for (const toast of toasts) {
        const existing = prevMap.get(toast.id);
        if (existing) {
          next.push(existing);
        } else {
          next.push({ ...toast, exiting: false });
        }
      }

      // Mark removed toasts as exiting (they'll be cleaned up after animation).
      for (const prev of prevMap.values()) {
        if (!toasts.find((t) => t.id === prev.id) && !prev.exiting) {
          next.push({ ...prev, exiting: true });
        }
      }

      return next;
    });
  }, [toasts]);

  // Clean up exited toasts after animation completes.
  const handleAnimationEnd = useCallback(
    (id: string) => {
      setInternal((prev) => {
        const toast = prev.find((t) => t.id === id);
        if (toast?.exiting) {
          return prev.filter((t) => t.id !== id);
        }
        return prev;
      });
      onDismiss(id);
    },
    [onDismiss]
  );

  if (internal.length === 0) return null;

  return (
    <div className={styles.container} role="region" aria-label="Notifications">
      {internal.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={onDismiss} onExited={handleAnimationEnd} />
      ))}
    </div>
  );
}

interface ToastItemProps {
  toast: InternalToast;
  onClose: (id: string) => void;
  onExited: (id: string) => void;
}

/** A single toast card. Memoized: multiple toasts stack and only the changed
 *  toast should re-render when the list is updated. */
const ToastItem = React.memo(function ToastItem({ toast, onClose, onExited }: ToastItemProps) {
  // Auto-dismiss after duration.
  useEffect(() => {
    if (toast.duration <= 0 || toast.exiting) return;
    const timer = setTimeout(() => onClose(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, toast.exiting, onClose]);

  return (
    <div
      className={cx(styles.toast, toast.exiting && styles.toastExiting)}
      role="alert"
      aria-live="assertive"
      onAnimationEnd={() => {
        if (toast.exiting) onExited(toast.id);
      }}
    >
      <AlertCircle className={styles.icon} aria-hidden="true" />
      <div className={styles.content}>
        <div className={styles.title}>{toast.title}</div>
        <div className={styles.message}>{toast.message}</div>
      </div>
      <button
        type="button"
        className={styles.close}
        onClick={() => onClose(toast.id)}
        aria-label="Dismiss notification"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
});
