/**
 * CommandPalette — k9s-style ⌘K command bar.
 *
 * Two modes:
 *   - `:` prefix → command dispatch. We support the k9s-style set the
 *     app already exposes via hotkeys and ActionBar:
 *       :y  YAML tab on the selected row
 *       :d  Describe (open detail panel)
 *       :e  Exec (open exec modal — pods only)
 *       :l  Logs (open logs modal — pods only)
 *       :f  Port-forward (pods + services)
 *       :s  Scale (deployments / statefulsets)
 *       :r  Restart (pods / rollouts)
 *       :x  Delete (with confirm)
 *   - anything else → fuzzy match on a tiny in-memory list of
 *     {kind, name, namespace} over the current snapshot. Pick a row
 *     to jump to it (sets the active kind + selection).
 *
 * Designed to be cheap to mount/unmount. The actual actions go
 * through props (`onCommand`) so the palette stays a dumb view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Row } from "../providers/types";

export type Command =
  | "yaml"
  | "describe"
  | "exec"
  | "logs"
  | "port-forward"
  | "scale"
  | "restart"
  | "delete";

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Current snapshot of all visible rows, keyed by kind. */
  rowsByKind: Map<string, Row[]>;
  /** Current active kind (so :s/:r/:e dispatch is kind-aware). */
  activeKind: string;
  /** Run a command against the currently selected row. */
  onCommand: (cmd: Command) => void;
  /** Jump to a specific row (sets active kind + selection). */
  onJump: (kind: string, row: Row) => void;
  /** Switch the active sidebar kind. */
  onPickKind: (kind: string) => void;
}

interface PaletteItem {
  id: string;
  /** "kind:name" or "command::y" etc. */
  key: string;
  label: string;
  hint?: string;
  group: "command" | "kind" | "row";
  run: () => void;
}

const ALL_KINDS = [
  "pods",
  "deployments",
  "statefulsets",
  "daemonsets",
  "replicasets",
  "jobs",
  "cronjobs",
  "services",
  "ingresses",
  "configmaps",
  "secrets",
  "nodes",
  "namespaces",
  "events",
  "hpa",
  "persistentvolumeclaims",
];

const COMMAND_REGISTRY: Array<{ cmd: Command; label: string; key: string; hint: string }> = [
  { cmd: "yaml", label: "YAML", key: "y", hint: "Open YAML tab for the selected row" },
  { cmd: "describe", label: "Describe", key: "d", hint: "Open the detail panel" },
  { cmd: "exec", label: "Exec", key: "x", hint: "Open an interactive shell (pods)" },
  { cmd: "logs", label: "Logs", key: "l", hint: "Open the log viewer (pods)" },
  { cmd: "port-forward", label: "Port-forward", key: "f", hint: "Forward a port (pods, services)" },
  { cmd: "scale", label: "Scale", key: "s", hint: "Scale a deployment / statefulset" },
  { cmd: "restart", label: "Restart", key: "r", hint: "Restart pod or rollout" },
  { cmd: "delete", label: "Delete", key: "x", hint: "Delete the selected resource" },
];

export function CommandPalette({
  open,
  onClose,
  rowsByKind,
  activeKind,
  onCommand,
  onJump,
  onPickKind,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Build the candidate list.
  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = [];

    // Commands (only when user typed a `:`).
    for (const c of COMMAND_REGISTRY) {
      out.push({
        id: `cmd::${c.key}`,
        key: `cmd::${c.key}`,
        label: `:${c.key}  ${c.label}`,
        hint: c.hint,
        group: "command",
        run: () => onCommand(c.cmd),
      });
    }

    // Kinds.
    for (const k of ALL_KINDS) {
      out.push({
        id: `kind:${k}`,
        key: `kind:${k}`,
        label: k,
        hint: "switch view",
        group: "kind",
        run: () => onPickKind(k),
      });
    }

    // Rows (capped for performance).
    const rowItems: PaletteItem[] = [];
    for (const [kind, rows] of rowsByKind) {
      for (const r of rows) {
        rowItems.push({
          id: `row:${kind}:${r.uid}`,
          key: `row:${kind}:${r.name}`,
          label: r.name,
          hint: r.namespace ? `${kind} · ${r.namespace}` : kind,
          group: "row",
          run: () => onJump(kind, r),
        });
        if (rowItems.length >= 2000) break;
      }
      if (rowItems.length >= 2000) break;
    }
    out.push(...rowItems);

    return out;
  }, [rowsByKind, onCommand, onPickKind, onJump]);

  // Filter by query.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // No query: show commands first, then kinds.
      return items.filter((i) => i.group !== "row").slice(0, 80);
    }
    const isCommand = q.startsWith(":");
    const needle = isCommand ? q.slice(1) : q;
    const out: PaletteItem[] = [];
    for (const it of items) {
      if (isCommand) {
        if (it.group !== "command") continue;
        if (it.key.toLowerCase().includes(needle)) out.push(it);
      } else {
        if (it.group === "row" && it.key.toLowerCase().includes(needle)) out.push(it);
        else if (it.group === "kind" && it.key.toLowerCase().includes(needle)) out.push(it);
      }
      if (out.length >= 80) break;
    }
    return out;
  }, [items, query, activeKind]);

  // Reset highlight when filter changes.
  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Focus the input on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Esc closes; ↑/↓ move; Enter runs.
  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const pick = filtered[highlight];
        if (pick) {
          pick.run();
          onClose();
        }
      }
    },
    [filtered, highlight, onClose],
  );

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal modal-palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command (:y :d :e :l :f :s :r :x) or search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matches.</div>
          ) : (
            filtered.map((it, i) => (
              <div
                key={it.id}
                className={`palette-item${i === highlight ? " active" : ""}`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  it.run();
                  onClose();
                }}
              >
                <span className="palette-label">{it.label}</span>
                {it.hint && <span className="palette-hint">{it.hint}</span>}
              </div>
            ))
          )}
        </div>
        <div className="palette-foot">
          <span>↑↓ move</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
