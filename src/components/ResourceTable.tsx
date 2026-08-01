export interface ColumnDef {
  key: string;
  label: string;
  width: string;
  align?: "left" | "right" | "center";
}

interface ResourceTableProps {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  loading: boolean;
  emptyHint: string;
  selectedIndex?: number;
  filter?: string;
  onSelectIndex?: (i: number) => void;
}

function statusTone(value: unknown): string {
  const v = String(value ?? "").toLowerCase();
  if (["running", "ready", "active", "succeeded", "available", "complete"].includes(v))
    return "ok";
  if (
    ["pending", "containercreating", "terminating", "unknown", "notready"].includes(v)
  )
    return "warn";
  if (
    [
      "failed",
      "crashloopbackoff",
      "error",
      "imagepullbackoff",
      "evicted",
    ].includes(v)
  )
    return "err";
  return "neutral";
}

export function ResourceTable({
  columns,
  rows,
  loading,
  emptyHint,
  selectedIndex = -1,
  filter = "",
  onSelectIndex,
}: ResourceTableProps) {
  const filteredRows = filter
    ? rows.filter((r) =>
        Object.values(r).some((v) =>
          String(v ?? "").toLowerCase().includes(filter.toLowerCase()),
        ),
      )
    : rows;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{ width: c.width, textAlign: c.align ?? "left" }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filteredRows.length === 0 ? (
            <tr>
              <td className="empty" colSpan={columns.length}>
                {loading ? "Loading…" : emptyHint}
              </td>
            </tr>
          ) : (
            filteredRows.map((row, i) => (
              <tr
                key={i}
                className={i === selectedIndex ? "row-selected" : ""}
                onClick={() => onSelectIndex?.(i)}
                onDoubleClick={() => onSelectIndex?.(i)}
              >
                {columns.map((c) => {
                  const value = row[c.key];
                  const tone =
                    c.key === "status" || c.key === "ready" || c.key === "phase"
                      ? statusTone(value)
                      : "neutral";
                  return (
                    <td
                      key={c.key}
                      className={`cell-${tone}`}
                      style={{ textAlign: c.align ?? "left" }}
                    >
                      {value === null || value === undefined
                        ? "—"
                        : String(value)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
