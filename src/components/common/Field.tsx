/**
 * Field wrapper for form inputs — provides label, hint, and inline error display.
 */

import type { ReactNode } from 'react';
import styles from './Field.module.css';
import { cx } from '../../lib/cx';

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  /** Required indicator. */
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function Field({ label, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cx(styles.field, error && styles.fieldError, className)}>
      <div className={styles.header}>
        <label className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.control}>{children}</div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
