/**
 * AboutModal — a tiny settings/info page.
 *
 * Shows:
 *   - Active cluster: context, server, version.
 *   - kubeconfig path (resolved via the Tauri host — best effort).
 *   - App version (from Tauri).
 *   - Cluster summary: nodes (ready/total), CPU/mem if metrics-server.
 *   - Hotkey cheatsheet.
 *
 * Triggered from the topbar "?" button or `?` key (we don't have one
 * yet — k9s uses Shift-?).
 */

import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

import type { ClusterInfo, ClusterStatus } from "../providers/types";

interface AboutModalProps {
  clusterInfo: ClusterInfo | null;
  status: ClusterStatus;
  contextName: string | null;
  onClose: () => void;
}

const HOTKEYS: Array<[string, string]> = [
  ["j / k", "move down / up"],
  ["g / G", "top / bottom"],
  ["Enter / d", "open detail"],
  ["y", "YAML tab"],
  ["e", "logs (pods)"],
  ["x", "exec (pods)"],
  ["f", "port-forward"],
  ["Space", "mark / unmark row"],
  ["⌘ K / Ctrl-K", "command palette"],
  [":", "open palette (then :y :d :e :f :s …)"],
  ["Esc", "close modals"],
];

export function AboutModal({ clusterInfo, status, contextName, onClose }: AboutModalProps) {
  const [appVersion, setAppVersion] = useState<string>("…");
  const [kcPath, setKcPath] = useState<string>("—");

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion("unknown"));
    // Best-effort kubeconfig path. The Rust side loads it through
    // KUBECONFIG or the default ~/.kube/config — we just hint that
    // here. (A dedicated get_kubeconfig_path command can land in a
    // later phase; for now this is enough.)
    if (typeof window !== "undefined") {
      // The browser sees nothing; we approximate from env if Tauri's
      // Tauri env API ever exposes it. For now, show the conventional
      // default and call it a day.
      setKcPath("~/.kube/config (or $KUBECONFIG)");
    }
  }, []);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-about"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <strong>k7s</strong>
          <span className="muted">v{appVersion}</span>
          <button className="btn" onClick={onClose}>
            Close (Esc)
          </button>
        </header>

        <div className="about-body">
          <section>
            <h3>Cluster</h3>
            <dl>
              <dt>Context</dt>
              <dd>{contextName ?? "—"}</dd>
              <dt>Name</dt>
              <dd>{clusterInfo?.clusterName ?? "—"}</dd>
              <dt>Server</dt>
              <dd>
                <code>{clusterInfo?.server ?? "—"}</code>
              </dd>
              <dt>Version</dt>
              <dd>{status.version || clusterInfo?.version || "—"}</dd>
              <dt>API latency</dt>
              <dd>{status.apiLatencyMs} ms</dd>
              <dt>Nodes</dt>
              <dd>
                {status.nodesReady} / {status.nodesTotal} ready
              </dd>
              <dt>CPU / Mem</dt>
              <dd>
                {status.cpuPercent == null ? "—" : `${status.cpuPercent.toFixed(0)}%`}
                {" / "}
                {status.memPercent == null ? "—" : `${status.memPercent.toFixed(0)}%`}
              </dd>
            </dl>
          </section>

          <section>
            <h3>Kubeconfig</h3>
            <dl>
              <dt>Path</dt>
              <dd>
                <code>{kcPath}</code>
              </dd>
              <dt>Active context</dt>
              <dd>
                <code>{contextName ?? "—"}</code>
              </dd>
            </dl>
          </section>

          <section>
            <h3>Hotkeys</h3>
            <table className="about-hotkeys">
              <tbody>
                {HOTKEYS.map(([k, label]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </div>
  );
}
