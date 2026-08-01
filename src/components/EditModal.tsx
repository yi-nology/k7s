import { useEffect, useState } from "react";
import { api } from "../lib/tauri";

interface EditModalProps {
  kind: string;
  name: string;
  namespace: string;
  /** Initial YAML shown in the editor. */
  initialYaml: string;
  onClose: () => void;
  onApplied: () => void;
}

export function EditModal({
  kind,
  name,
  namespace,
  initialYaml,
  onClose,
  onApplied,
}: EditModalProps) {
  const [yaml, setYaml] = useState(initialYaml);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.applyYaml(kind, name, namespace, yaml);
      setResult(r);
      setYaml(r);
      onApplied();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirming) setConfirming(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirming]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-kind">Edit</span>
            <span className="modal-name">{name}</span>
            <span className="modal-ns">· {namespace}</span>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-toolbar">
          <span className="toolbar-field">
            <span>apply</span>
            <span className="muted">server-side apply (force)</span>
          </span>
          <span className="toolbar-spacer" style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            onClick={() => setConfirming(true)}
            disabled={busy || yaml === initialYaml}
          >
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
        <div className="modal-body" style={{ minHeight: 320 }}>
          {error ? (
            <div className="error-block">
              <div className="error-title">⚠ Apply failed</div>
              <pre className="error-body">{error}</pre>
            </div>
          ) : result ? (
            <pre className="yaml logs-view">{result}</pre>
          ) : (
            <textarea
              className="yaml-editor"
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              spellCheck={false}
            />
          )}
        </div>
        <div className="modal-footer">
          <span className="footer-hint">
            YAML is sent as <code>application/apply-patch+yaml</code>
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {confirming && (
          <div className="confirm-overlay" onClick={() => setConfirming(false)}>
            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-title">Apply changes?</div>
              <div className="confirm-body">
                This will <b>server-side apply</b> the edited YAML to{" "}
                <code>{kind}/{namespace}/{name}</code>. Fields owned by other
                managers will be rejected unless <code>force</code> is set.
              </div>
              <div className="confirm-actions">
                <button
                  className="btn-danger"
                  onClick={apply}
                  disabled={busy}
                >
                  {busy ? "Applying…" : "Yes, apply"}
                </button>
                <button
                  className="btn"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
