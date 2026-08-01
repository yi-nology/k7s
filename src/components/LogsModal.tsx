/**
 * LogsModal — live pod log viewer.
 *
 * Opens a streaming connection via `provider.startLogStream` and
 * renders lines as they arrive. Closes on Esc or click-outside.
 *
 * Keeps a bounded buffer (last N lines) so a chatty container doesn't
 * OOM the renderer.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { provider } from "../providers";
import type { LogHandle, LogLine, Row } from "../providers/types";

interface LogsModalProps {
  row: Row;
  /** Container to stream from (or null for "any" — k8s returns the first). */
  container: string | null;
  onClose: () => void;
}

const MAX_LINES = 5000;

export function LogsModal({ row, container, onClose }: LogsModalProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<string>("starting…");
  const [paused, setPaused] = useState(false);
  const [closed, setClosed] = useState(false);
  const handleRef = useRef<LogHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // Start the stream on mount, stop on unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await provider.startLogStream(
          { kind: "Pod", namespace: row.namespace, name: row.name },
          container,
          { tail: 200 },
          (line) => {
            if (cancelled) return;
            setLines((prev) => {
              const next = prev.length >= MAX_LINES ? prev.slice(-MAX_LINES + 1) : prev;
              return [...next, line];
            });
          },
          (reason) => {
            if (cancelled) return;
            setClosed(true);
            setStatus(`closed: ${reason}`);
          },
        );
        if (cancelled) {
          h.stop();
          return;
        }
        handleRef.current = h;
        setStatus(`streaming (${container ?? "any container"})`);
      } catch (e) {
        if (cancelled) return;
        setStatus(`error: ${e}`);
      }
    })();
    return () => {
      cancelled = true;
      handleRef.current?.stop();
    };
  }, [row.name, row.namespace, container]);

  // Auto-scroll unless the user scrolled up.
  useEffect(() => {
    if (paused) return;
    if (!stickToBottomRef.current) return;
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, paused]);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    stickToBottomRef.current = atBottom;
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-logs" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-title">
            <span className="modal-kind">Pod logs</span>
            <span className="modal-name">{row.name}</span>
            {container && <span className="modal-sub">/{container}</span>}
          </div>
          <div className="modal-actions">
            <button
              className="iconbtn"
              onClick={() => setPaused((p) => !p)}
              title={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
            >
              {paused ? "▶" : "⏸"}
            </button>
            <button
              className="iconbtn"
              onClick={() => {
                const text = lines
                  .map((l) => (l.ts ? `${l.ts}  ${l.msg}` : l.msg))
                  .join("\n");
                const blob = new Blob([text], { type: "text/plain" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${row.name}.log`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="Download"
            >
              ⤓
            </button>
            <button className="iconbtn" onClick={onClose} title="Close (Esc)">
              ✕
            </button>
          </div>
        </header>
        <div className="modal-statusbar">{status}{closed ? "" : ""}</div>
        <div className="logs-viewport" ref={scrollerRef} onScroll={onScroll}>
          {lines.map((l, i) => (
            <div key={i} className="log-line">
              {l.ts && <span className="log-ts tone-muted">{l.ts}</span>}
              {l.level && (
                <span
                  className={`log-level tone-${levelTone(l.level)}`}
                >
                  {padLevel(l.level)}
                </span>
              )}
              <span className="log-msg">{l.msg}</span>
            </div>
          ))}
          {lines.length === 0 && (
            <div className="log-empty tone-muted">
              {status.startsWith("error") ? status : "Waiting for first line…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function padLevel(s: string): string {
  return s.length >= 5 ? s : s + " ".repeat(5 - s.length);
}

function levelTone(s: string): string {
  switch (s) {
    case "ERROR":
    case "FATAL":
      return "err";
    case "WARN":
    case "WARNING":
      return "warn";
    case "INFO":
    case "DEBUG":
    case "TRACE":
      return "secondary";
    default:
      return "muted";
  }
}
