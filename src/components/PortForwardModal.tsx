/**
 * PortForwardModal — open and manage port-forwards for pods/services.
 *
 * UI: a list of active forwards (with start/stop), plus a form to open
 * a new one. Backend call goes through `provider.startPortForward` /
 * `stopPortForward` / `listPortForwards`.
 *
 * Errors from the Rust side land inline; the modal stays open so the
 * user can retry.
 */

import { useCallback, useEffect, useState } from "react";

import { provider } from "../providers";
import type { ForwardInfo, Row } from "../providers/types";
import { apiKindFor } from "../providers/columns";

interface PortForwardModalProps {
  /** What the user clicked "Port-forward" on. */
  row: Row;
  /** Service ports the user can pick from (e.g. [80, 443]). Optional. */
  servicePorts?: number[];
  onClose: () => void;
}

export function PortForwardModal({ row, servicePorts, onClose }: PortForwardModalProps) {
  const [forwards, setForwards] = useState<ForwardInfo[]>([]);
  const [localPort, setLocalPort] = useState<string>("");
  const [remotePort, setRemotePort] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the remote port from the row's first service-port cell.
  useEffect(() => {
    if (remotePort) return;
    const fromRow = pickFirstPort(row);
    if (fromRow) setRemotePort(String(fromRow));
    else if (servicePorts && servicePorts[0]) setRemotePort(String(servicePorts[0]));
  }, [row, servicePorts, remotePort]);

  // Load existing forwards.
  const refresh = useCallback(async () => {
    try {
      setForwards(await provider.listPortForwards());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apiKind = apiKindFor(row.cells[0]?.text === "Service" ? "services" : "pods");

  const onStart = useCallback(async () => {
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);
    if (Number.isNaN(lp) || lp <= 0 || Number.isNaN(rp) || rp <= 0) {
      setError("local and remote ports must be positive integers");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await provider.startPortForward(apiKind, row.name, row.namespace ?? "", lp, rp);
      setLocalPort("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [apiKind, row, localPort, remotePort, refresh]);

  const onStop = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await provider.stopPortForward(id);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-pf" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-title">
            <span className="modal-kind">Port forward</span>
            <span className="modal-name">{row.name}</span>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </header>

        <div className="pf-form">
          <div className="pf-row">
            <label className="pf-label">Local port</label>
            <input
              className="input"
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              placeholder="(any free)"
            />
          </div>
          <div className="pf-row">
            <label className="pf-label">Remote port</label>
            <input
              className="input"
              type="number"
              min={1}
              max={65535}
              value={remotePort}
              onChange={(e) => setRemotePort(e.target.value)}
            />
          </div>
          {servicePorts && servicePorts.length > 0 && (
            <div className="pf-row">
              <label className="pf-label">Common</label>
              <div className="pf-presets">
                {servicePorts.map((p) => (
                  <button
                    key={p}
                    className="iconbtn"
                    onClick={() => setRemotePort(String(p))}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <div className="error-banner">{error}</div>}
          <button
            className="iconbtn primary"
            onClick={onStart}
            disabled={busy || !localPort || !remotePort}
          >
            {busy ? "…" : "Start"}
          </button>
        </div>

        <div className="pf-list">
          <div className="pf-list-title">Active forwards</div>
          {forwards.length === 0 ? (
            <div className="pf-empty">No active port-forwards.</div>
          ) : (
            forwards.map((f) => (
              <div key={f.id} className="pf-item">
                <div className="pf-item-main">
                  <code>
                    127.0.0.1:{f.localPort}
                  </code>
                  <span className="pf-arrow">→</span>
                  <code>
                    {f.pod}:{f.remotePort}
                  </code>
                </div>
                <button
                  className="iconbtn danger"
                  onClick={() => onStop(f.id)}
                  disabled={busy}
                >
                  Stop
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function pickFirstPort(row: Row): number | null {
  // The backend's service cells put ports in the "Ports" column; fall
  // back to a regex parse if the cell is a string.
  for (const c of row.cells) {
    const m = c.text.match(/(\d+):(\d+)/);
    if (m) return parseInt(m[2], 10);
  }
  return null;
}
