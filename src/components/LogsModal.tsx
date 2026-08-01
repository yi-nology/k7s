import { useEffect, useState } from "react";
import { api } from "../lib/tauri";

interface LogsModalProps {
  name: string;
  namespace: string;
  /** Comma-separated container names from PodRow.containers. */
  containers: string;
  onClose: () => void;
}

export function LogsModal({ name, namespace, containers, onClose }: LogsModalProps) {
  const containerList = containers
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const [container, setContainer] = useState<string>(containerList[0] ?? "");
  const [tail, setTail] = useState(200);
  const [previous, setPrevious] = useState(false);
  const [timestamps, setTimestamps] = useState(false);
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await api.getPodLogs(name, namespace, {
        container: container || null,
        tail_lines: tail,
        previous,
        timestamps,
      });
      setLogs(text);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, namespace, container, tail, previous, timestamps]);

  // Esc closes
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
            <span className="modal-kind">Logs</span>
            <span className="modal-name">{name}</span>
            <span className="modal-ns">· {namespace}</span>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-toolbar">
          {containerList.length > 0 && (
            <label className="toolbar-field">
              <span>container</span>
              <select
                className="select"
                value={container}
                onChange={(e) => setContainer(e.target.value)}
              >
                {containerList.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="toolbar-field">
            <span>tail</span>
            <input
              className="input input-narrow"
              type="number"
              min={1}
              max={10000}
              value={tail}
              onChange={(e) => setTail(Number(e.target.value) || 1)}
            />
          </label>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={previous}
              onChange={(e) => setPrevious(e.target.checked)}
            />
            previous
          </label>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={timestamps}
              onChange={(e) => setTimestamps(e.target.checked)}
            />
            timestamps
          </label>
          <button
            className="btn"
            onClick={fetchLogs}
            disabled={loading}
            title="Re-fetch (r)"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        <div className="modal-body">
          {error ? (
            <div className="error-block">
              <div className="error-title">⚠ Failed to load logs</div>
              <pre className="error-body">{error}</pre>
            </div>
          ) : (
            <pre className="yaml logs-view">{logs || (loading ? "" : "(no log lines returned)")}</pre>
          )}
        </div>
        <div className="modal-footer">
          <span className="footer-hint">
            {loading ? "loading…" : `${logs.split("\n").length - 1} lines`}
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
