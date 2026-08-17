/**
 * Shared modal dialog shell — portal, focus trap, Esc, backdrop click.
 *
 * Replaces hand-rolled modal logic scattered across Settings, overlays, etc.
 * Every change applied via setSettings(sanitizeSettings({ ...settings, ...patch }));
 */

import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';
import { cx } from '../../lib/cx';
import { X } from 'lucide-react';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** sm=360px, md=520px, lg=720px, xl=960px. Default: md. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Prevent close on backdrop/Esc. Default: false. */
  preventClose?: boolean;
  /** Header actions (e.g. close button override). */
  headerRight?: ReactNode;
  children: ReactNode;
  /** Additional class on the panel. */
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  size = 'md',
  preventClose = false,
  headerRight,
  children,
  className,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Save and restore focus.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      // Focus the first focusable element inside the panel.
      requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const first = panel.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        first?.focus();
      });
    } else if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  // Esc to close.
  useEffect(() => {
    if (!open || preventClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, preventClose]);

  // Focus trap: Tab cycles within the panel.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    []
  );

  if (!open) return null;

  const sizeClass = styles[`size${size.charAt(0).toUpperCase() + size.slice(1)}`] ?? styles.sizeMd;

  return createPortal(
    <div className={styles.backdrop} onClick={preventClose ? undefined : onClose}>
      <div
        ref={panelRef}
        className={cx(styles.panel, sizeClass, className)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className={styles.header}>
            <span className={styles.title}>{title}</span>
            {headerRight}
            {!preventClose && (
              <button
                type="button"
                className={styles.close}
                onClick={onClose}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body
  );
}
