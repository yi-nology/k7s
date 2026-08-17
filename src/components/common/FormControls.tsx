/**
 * Shared form control wrappers — styled inputs/selects that use design tokens.
 *
 * These replace ad-hoc inline inputs scattered across panels. Each control
 * delegates to the native element but applies consistent styling and clamping.
 */

import { useCallback, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';
import styles from './FormControls.module.css';
import { cx } from '../../lib/cx';

/* ------------------------------------------------------------------ */
/* TextInput                                                          */
/* ------------------------------------------------------------------ */

export type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  error?: boolean;
};

export function TextInput({ className, error, ...props }: TextInputProps) {
  return (
    <input
      className={cx(styles.input, error && styles.inputError, className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* NumberInput — clamp on blur, don't interrupt typing                 */
/* ------------------------------------------------------------------ */

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}

export function NumberInput({ min, max, value, onChange, className, ...props }: NumberInputProps) {
  // Display the raw value during typing; clamp on blur.
  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      const raw = Number(e.target.value);
      const clamped = Number.isFinite(raw) ? Math.min(max, Math.max(min, Math.round(raw))) : value;
      if (clamped !== value) onChange(clamped);
    },
    [min, max, value, onChange]
  );

  return (
    <input
      type="number"
      className={cx(styles.input, styles.number, className)}
      min={min}
      max={max}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onBlur={handleBlur}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Select                                                             */
/* ------------------------------------------------------------------ */

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  error?: boolean;
};

export function Select({ className, error, children, ...props }: SelectProps) {
  return (
    <select
      className={cx(styles.input, styles.select, error && styles.inputError, className)}
      {...props}
    >
      {children}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle — boolean switch                                            */
/* ------------------------------------------------------------------ */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, label, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      className={cx(styles.toggle, checked && styles.toggleActive, disabled && styles.toggleDisabled)}
      onClick={() => !disabled && onChange(!checked)}
      aria-pressed={checked}
      disabled={disabled}
    >
      <span className={styles.toggleKnob} />
      {label && <span className={styles.toggleLabel}>{label}</span>}
    </button>
  );
}
