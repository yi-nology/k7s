/**
 * ConfirmDialog — modal prompt with a single confirm/cancel pair.
 *
 * Replaces the throwaway `window.confirm` for destructive actions
 * (delete, drain, restart) with a styled modal that supports an
 * optional secondary confirm input (e.g. type the resource name).
 */

import { useEffect } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tones the confirm button (default "danger" for destructive ops). */
  tone?: "danger" | "warn" | "primary";
  /** If set, the user must type this string to confirm. */
  requireType?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  requireType,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal modal-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        <div className="confirm-body">{body}</div>
        {requireType && (
          <input
            className="confirm-input"
            placeholder={`Type "${requireType}" to confirm`}
            onChange={(e) => {
              const btn = document.getElementById(
                "confirm-action-btn",
              ) as HTMLButtonElement | null;
              if (btn) btn.disabled = e.target.value !== requireType;
            }}
          />
        )}
        <div className="confirm-actions">
          <button className="iconbtn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            id="confirm-action-btn"
            className={`iconbtn ${tone}`}
            onClick={onConfirm}
            disabled={!!requireType}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
