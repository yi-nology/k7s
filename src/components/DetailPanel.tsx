import { useEffect, useState } from "react";
import type { ResourceDetail } from "../lib/types";
import { api } from "../lib/tauri";

interface DetailPanelProps {
  kind: string;
  namespace: string | null;
  name: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DetailPanel({
  kind,
  namespace,
  name,
  onClose,
  onDeleted,
}: DetailPanelProps) {
  const [data, setData] = useState<ResourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getYaml(kind, namespace, name)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [kind, namespace, name]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteResource(kind, namespace, name);
      onDeleted();
      onClose();
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-kind">{kind}</span>
            <span className="modal-name">{name}</span>
            {namespace && <span className="modal-ns">· {namespace}</span>}
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="loading">Loading YAML…</div>
          ) : error ? (
            <div className="error-block">
              <div className="error-title">⚠ Failed to load</div>
              <pre className="error-body">{error}</pre>
            </div>
          ) : (
            <pre className="yaml">{data?.yaml}</pre>
          )}
        </div>
        <div className="modal-footer">
          <button
            className="btn-danger"
            onClick={() => setConfirmDelete(true)}
            disabled={loading || !!error || deleting}
          >
            Delete
          </button>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        {confirmDelete && (
          <div className="confirm-overlay" onClick={() => setConfirmDelete(false)}>
            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-title">Delete {kind}?</div>
              <div className="confirm-body">
                This will delete <code>{name}</code>
                {namespace && (
                  <>
                    {" "}
                    in namespace <code>{namespace}</code>
                  </>
                )}
                . This cannot be undone.
              </div>
              <div className="confirm-actions">
                <button
                  className="btn-danger"
                  onClick={doDelete}
                  disabled={deleting}
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  className="btn"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
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
