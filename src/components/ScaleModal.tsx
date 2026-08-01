import { useEffect, useState } from "react";
import { api } from "../lib/tauri";

interface ScaleModalProps {
  kind: string;
  name: string;
  namespace: string;
  /** Current desired replicas; we initialize the input from this. */
  currentReplicas: number;
  onClose: () => void;
  onScaled: () => void;
}

export function ScaleModal({
  kind,
  name,
  namespace,
  currentReplicas,
  onClose,
  onScaled,
}: ScaleModalProps) {
  const [replicas, setReplicas] = useState<number>(currentReplicas);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  const apply = async () => {
    if (replicas < 0) {
      setError("replicas must be >= 0");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.scaleResource(kind, name, namespace, replicas);
      setResult(r);
      onScaled();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-kind">Scale</span>
            <span className="modal-name">{name}</span>
            <span className="modal-ns">· {namespace}</span>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-toolbar">
          <label className="toolbar-field">
            <span>replicas</span>
            <input
              className="input input-narrow"
              type="number"
              min={0}
              max={1000}
              value={replicas}
              onChange={(e) => setReplicas(Number(e.target.value) || 0)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              autoFocus
            />
          </label>
          <button className="btn btn-primary" onClick={apply} disabled={busy}>
            {busy ? "Scaling…" : "Apply"}
          </button>
        </div>
        <div className="modal-body">
          {error ? (
            <div className="error-block">
              <div className="error-title">⚠ Failed to scale</div>
              <pre className="error-body">{error}</pre>
            </div>
          ) : result !== null ? (
            <div className="loading">
              ✓ Scaled {kind}/{namespace}/{name} to <b>{result}</b>{" "}
              replicas.
              <br />
              <small>(was {currentReplicas})</small>
            </div>
          ) : (
            <div className="loading">
              Currently <b>{currentReplicas}</b> {currentReplicas === 1 ? "replica" : "replicas"}.
              <br />
              Enter the new replica count and press <b>Apply</b> (or Enter).
            </div>
          )}
        </div>
        <div className="modal-footer">
          <span className="footer-hint">
            updates the <code>scale</code> subresource
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
