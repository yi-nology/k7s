import { useEffect, useState } from "react";
import { api } from "../lib/tauri";

interface ExecModalProps {
  name: string;
  namespace: string;
  /** Comma-separated container names from PodRow.containers. */
  containers: string;
  onClose: () => void;
}

/** Tokenize a shell-style command line into argv. Handles simple quotes. */
function splitCommand(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === " " || ch === "\t") {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function ExecModal({ name, namespace, containers, onClose }: ExecModalProps) {
  const containerList = containers
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const [container, setContainer] = useState<string>(containerList[0] ?? "");
  const [cmdInput, setCmdInput] = useState("ls -la /");
  const [result, setResult] = useState<{
    stdout: string;
    stderr: string;
    exit_code: number;
    duration_ms: number;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const argv = splitCommand(cmdInput);
    if (argv.length === 0) {
      setError("please enter a command");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.execPod(name, namespace, container || null, argv);
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  };

  // Enter to run, Esc to close
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
            <span className="modal-kind">Exec</span>
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
          <label className="toolbar-field toolbar-field-grow">
            <span>command</span>
            <input
              className="input"
              type="text"
              value={cmdInput}
              onChange={(e) => setCmdInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
              placeholder="ls -la /"
              autoFocus
            />
          </label>
          <button className="btn btn-primary" onClick={run} disabled={running}>
            {running ? "Running…" : "Run"}
          </button>
        </div>
        <div className="modal-body">
          {error ? (
            <div className="error-block">
              <div className="error-title">⚠ Failed to exec</div>
              <pre className="error-body">{error}</pre>
            </div>
          ) : result ? (
            <div className="exec-output">
              <div className="exec-status">
                exit {result.exit_code} · {result.duration_ms}ms
              </div>
              {result.stdout && (
                <pre className="yaml logs-view">{result.stdout}</pre>
              )}
              {result.stderr && (
                <pre className="yaml logs-view logs-stderr">{result.stderr}</pre>
              )}
              {!result.stdout && !result.stderr && (
                <div className="loading">(no output)</div>
              )}
            </div>
          ) : running ? (
            <div className="loading">Running…</div>
          ) : (
            <div className="loading">Enter a command above and press Enter / Run.</div>
          )}
        </div>
        <div className="modal-footer">
          <span className="footer-hint">
            runs `kubectl exec` against the active context
          </span>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
