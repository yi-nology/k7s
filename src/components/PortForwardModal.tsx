import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/tauri";
import type { PortForwardInfo } from "../lib/types";

interface PortForwardModalProps {
  kind: string;
  name: string;
  namespace: string;
  onClose: () => void;
}

const DEFAULT_LOCAL = 18080;
const DEFAULT_REMOTE = 80;

export function PortForwardModal({ kind, name, namespace, onClose }: PortForwardModalProps) {
  const [localPort, setLocalPort] = useState<number>(DEFAULT_LOCAL);
  const [remotePort, setRemotePort] = useState<number>(DEFAULT_REMOTE);
  const [active, setActive] = useState<PortForwardInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setActive(await api.listPortForwards());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const info = await api.startPortForward(
        kind,
        name,
        namespace,
        localPort,
        remotePort,
      );
      setActive((prev) => [...prev, info]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.stopPortForward(id);
      setActive((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const mine = active.filter(
    (p) => p.kind === kind && p.name === name && p.namespace === namespace,
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <span className="modal-kind">PortForward</span>
            <span className="modal-name">{name}</span>
            <span className="modal-ns">· {namespace}</span>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="modal-toolbar">
          <label className="toolbar-field">
            <span>local</span>
            <input
              className="input input-narrow"
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(Number(e.target.value) || 1)}
            />
          </label>
          <span className="arrow">→</span>
          <label className="toolbar-field">
            <span>remote</span>
            <input
              className="input input-narrow"
              type="number"
              min={1}
              max={65535}
              value={remotePort}
              onChange={(e) => setRemotePort(Number(e.target.value) || 1)}
            />
          </label>
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
        <div className="modal-body">
          {error ? (
            <div className="error-block">
              <div className="error-title">⚠ Failed</div>
              <pre className="error-body">{error}</pre>
            </div>
          ) : mine.length === 0 ? (
            <div className="loading">
              No active port-forwards for this resource yet.
              <br />
              Press <b>Start</b> to open 127.0.0.1:{localPort} → {kind.toLowerCase()}/{name}:{remotePort}.
            </div>
          ) : (
            <table className="table pf-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Local</th>
                  <th>Remote</th>
                  <th>Started</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {mine.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.id.slice(-8)}</code></td>
                    <td>127.0.0.1:{p.local_port}</td>
                    <td>{p.kind.toLowerCase()}/{p.namespace}/{p.name}:{p.remote_port}</td>
                    <td>{p.started_at}</td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn-danger btn-sm"
                        onClick={() => stop(p.id)}
                        disabled={busy}
                      >
                        Stop
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="modal-footer">
          <span className="footer-hint">
            {active.length} active total
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
