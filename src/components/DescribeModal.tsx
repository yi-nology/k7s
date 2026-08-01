import { useEffect, useState } from "react";
import { api } from "../lib/tauri";

interface DescribeModalProps {
  kind: string;
  name: string;
  namespace: string;
  onClose: () => void;
}

export function DescribeModal({ kind, name, namespace, onClose }: DescribeModalProps) {
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .describe(kind, name, namespace)
      .then((r) => setText(r.text))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [kind, name, namespace]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-kind">Describe</span>
            <span className="modal-name">{name}</span>
            <span className="modal-ns">· {namespace || "(cluster)"}</span>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="loading">Loading…</div>
          ) : error ? (
            <div className="error-block">
              <div className="error-title">⚠ Failed to describe</div>
              <pre className="error-body">{error}</pre>
            </div>
          ) : (
            <pre className="yaml logs-view describe-view">{text}</pre>
          )}
        </div>
        <div className="modal-footer">
          <span className="footer-hint">read-only; just like `kubectl describe`</span>
          <button
            className="btn"
            onClick={() => {
              navigator.clipboard.writeText(text);
            }}
            disabled={!text}
            title="Copy to clipboard"
          >
            Copy
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
