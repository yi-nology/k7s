/**
 * ExecModal — interactive TTY shell into a pod.
 *
 * Uses xterm.js for proper terminal emulation (ANSI colors, cursor
 * positioning, alt-screen programs). All bytes are shuttled base64-
 * encoded over the Tauri command channel so binary keys / control
 * sequences survive the JSON round-trip.
 *
 * The Tauri shell handle is `start_shell` / `shell_input` / `shell_resize`
 * / `stop_shell`. The Rust side uses `kube::api::AttachedProcess` with
 * tty=true, stdin=true, stdout=true, stderr=false.
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { provider } from "../providers";
import type { Row, ShellHandle } from "../providers/types";

interface ExecModalProps {
  row: Row;
  container: string | null;
  onClose: () => void;
}

export function ExecModal({ row, container, onClose }: ExecModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const handleRef = useRef<ShellHandle | null>(null);
  const [status, setStatus] = useState<string>("starting…");
  const [closed, setClosed] = useState(false);

  // Mount the terminal + start the shell.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new Terminal({
      convertEol: false, // shell wraps; we don't want CRLF→LF conversion
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      theme: {
        background: "#0f1115",
        foreground: "#e6e6e6",
        cursor: "#e6e6e6",
        selectionBackground: "#264f78",
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      fit.fit();
    } catch {
      /* container not measurable yet — resize observer will retry */
    }
    termRef.current = term;
    fitRef.current = fit;

    let cancelled = false;

    // Wire the shell.
    (async () => {
      try {
        const handle = await provider.startShell(
          row.namespace ?? "default",
          row.name,
          container,
          (b64) => {
            if (cancelled) return;
            const bytes = base64ToBytes(b64);
            term.write(bytes);
          },
          (reason, kstatus) => {
            if (cancelled) return;
            setClosed(true);
            setStatus(`closed: ${reason} (${kstatus || "—"})`);
            term.write(`\r\n\x1b[2m[session ended: ${kstatus || reason}]\x1b[0m\r\n`);
          },
        );
        if (cancelled) {
          handle.stop();
          return;
        }
        handleRef.current = handle;
        setStatus(`connected (${container ?? "default container"})`);
        term.focus();
      } catch (e) {
        if (cancelled) return;
        setStatus(`error: ${e}`);
        term.write(`\r\n\x1b[31m[exec failed: ${e}]\x1b[0m\r\n`);
      }
    })();

    // Forward user keystrokes to the shell.
    const dataDisp = term.onData((data) => {
      const h = handleRef.current;
      if (!h) return;
      // The shell expects raw bytes. base64 the string and ship it.
      h.input(toBase64(data)).catch(() => {
        /* shell closed mid-flight */
      });
    });

    // Resize: re-fit the terminal and tell the kubelet the new size.
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore — element not visible */
      }
      const h = handleRef.current;
      if (!h) return;
      h.resize(term.cols, term.rows).catch(() => {});
    });
    ro.observe(el);

    return () => {
      cancelled = true;
      dataDisp.dispose();
      ro.disconnect();
      handleRef.current?.stop();
      handleRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [row.name, row.namespace, container]);

  // Esc to close (only when terminal isn't actively capturing — xterm
  // already eats most keys; this is a courtesy close).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-wide modal-exec"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <strong>
            exec · {row.namespace}/{row.name}
            {container ? `:${container}` : ""}
          </strong>
          <span className={`status ${closed ? "err" : "ok"}`}>{status}</span>
          <button className="btn" onClick={onClose}>
            Close (Esc)
          </button>
        </header>
        <div className="exec-body">
          <div ref={containerRef} className="exec-terminal" />
        </div>
      </div>
    </div>
  );
}

// ---- base64 helpers (no Buffer / atob needed) ----

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
