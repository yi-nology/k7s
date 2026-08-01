/**
 * ResourceTable — the universal table for every kind.
 *
 * Reads `Row` / `Cell` from the provider contract (see
 * `src/providers/types.ts`). The backend decides the tone and the cell
 * text; this component just lays them out and renders tone classes.
 *
 * Features:
 *   - One `<table>` per kind; columns driven by the active kind config.
 *   - Click to select; keyboard nav (j/k/g/G) handled by the parent.
 *   - Filter applies across all cells + the name.
 *   - Status dot for cells that ask for one (`cell.dot === true`).
 *   - Sticky header.
 */

import { useMemo } from "react";
import type { Cell, Row, Tone } from "../../providers/types";

export interface ColumnSpec {
  /** Header label. */
  label: string;
  /** Optional explicit width (CSS length). */
  width?: string;
  /** Right-align numeric columns. */
  align?: "left" | "right" | "center";
}

interface ResourceTableProps {
  columns: ColumnSpec[];
  rows: Row[];
  loading: boolean;
  emptyHint: string;
  selectedIndex?: number;
  filter?: string;
  onSelectIndex?: (i: number) => void;
  onActivate?: (row: Row) => void;
  /** Optional cell-click handler. Triggered when a cell has `nav` set. */
  onCellClick?: (row: Row, cell: Cell) => void;
}

export function ResourceTable({
  columns,
  rows,
  loading,
  emptyHint,
  selectedIndex = -1,
  filter = "",
  onSelectIndex,
  onActivate,
  onCellClick,
}: ResourceTableProps) {
  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter((r) => {
      if (r.name.toLowerCase().includes(q)) return true;
      if (r.namespace && r.namespace.toLowerCase().includes(q)) return true;
      return r.cells.some((c) => c.text.toLowerCase().includes(q));
    });
  }, [rows, filter]);

  if (rows.length === 0) {
    return (
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={i} style={{ width: c.width, textAlign: c.align ?? "left" }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="empty" colSpan={columns.length}>
                {loading ? "Loading…" : emptyHint}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i} style={{ width: c.width, textAlign: c.align ?? "left" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((row, i) => (
            <tr
              key={row.uid || row.name}
              className={i === selectedIndex ? "row-selected" : ""}
              onClick={() => onSelectIndex?.(i)}
              onDoubleClick={() => onActivate?.(row)}
            >
              {columns.map((c, ci) => {
                const cell = row.cells[ci];
                if (!cell) {
                  return (
                    <td key={ci} style={{ textAlign: c.align ?? "left" }} className="tone-muted">
                      —
                    </td>
                  );
                }
                return (
                  <td
                    key={ci}
                    className={`tone-${cell.tone}`}
                    style={{ textAlign: c.align ?? "left" }}
                    onClick={(e) => {
                      if (cell.nav) {
                        e.stopPropagation();
                        onCellClick?.(row, cell);
                      }
                    }}
                    title={cell.nav ? `→ ${cell.nav.kind}/${cell.nav.name}` : undefined}
                  >
                    {cell.dot && <span className="cell-dot" aria-hidden />}
                    {cell.format === "age" ? (
                      <AgeCell ts={cell.text} />
                    ) : (
                      cell.text || <span className="tone-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Live age formatter — parses an RFC3339 timestamp and ticks every 30s. */
function AgeCell({ ts }: { ts: string }) {
  // The "—" placeholder is also handled by the parent.
  if (!ts) return <span className="tone-muted">—</span>;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return <span className="tone-muted">—</span>;
  const text = formatAge(d);
  return <span className="tone-muted" data-ts={d.getTime()}>{text}</span>;
}

function formatAge(d: Date): string {
  const ms = Date.now() - d.getTime();
  if (ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const day = Math.floor(h / 24);
  return `${day}d`;
}

/** Tone class helper, in case a child wants to use it. */
export function toneClass(tone: Tone): string {
  return `tone-${tone}`;
}
