/**
 * DetailPanel — slides in from the right when a row is activated.
 *
 * Three tabs:
 *   - **YAML**  : live source-of-truth. Edit + save, or read-only.
 *   - **Events**: kubernetes events for this object.
 *   - **Properties**: labels, annotations, key fields.
 *
 * Reads `Row` from the table; the parent owns the active row and
 * passes it down. All commands go through `provider`.
 */

import { useCallback, useEffect, useState } from "react";

import { provider } from "../../providers";
import type { ResourceRef, Row } from "../../providers/types";

interface DetailPanelProps {
  row: Row;
  /** Backend's "kind label" (e.g. "Pod", "Deployment"). */
  kindLabel: string;
  /** Close the panel. */
  onClose: () => void;
  /** Called after a successful apply, so the table can refresh. */
  onApplied?: () => void;
}

type Tab = "yaml" | "events" | "properties";

export function DetailPanel({ row, kindLabel, onClose, onApplied }: DetailPanelProps) {
  const [tab, setTab] = useState<Tab>("yaml");
  const [yaml, setYaml] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref: ResourceRef = {
    kind: kindLabel,
    namespace: row.namespace,
    name: row.name,
  };

  // Load YAML when the row changes.
  useEffect(() => {
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const y = await provider.getYaml(ref);
        setYaml(y);
        setOriginal(y);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [row.name, row.namespace, kindLabel]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dirty = yaml !== original;

  const onSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await provider.applyYaml(ref, yaml);
      setOriginal(yaml);
      onApplied?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [yaml, ref, onApplied]);

  const onDiscard = useCallback(() => {
    setYaml(original);
    setError(null);
  }, [original]);

  return (
    <aside className="detail-panel">
      <header className="detail-header">
        <div className="detail-title">
          <span className="detail-kind">{kindLabel}</span>
          <span className="detail-name">{row.name}</span>
        </div>
        <button className="iconbtn" onClick={onClose} title="Close (Esc)">
          ✕
        </button>
      </header>

      <div className="detail-tabs">
        <button
          className={`detail-tab ${tab === "yaml" ? "is-active" : ""}`}
          onClick={() => setTab("yaml")}
        >
          YAML
        </button>
        <button
          className={`detail-tab ${tab === "events" ? "is-active" : ""}`}
          onClick={() => setTab("events")}
        >
          Events
        </button>
        <button
          className={`detail-tab ${tab === "properties" ? "is-active" : ""}`}
          onClick={() => setTab("properties")}
        >
          Properties
        </button>
      </div>

      <div className="detail-body">
        {error && <div className="error-banner">{error}</div>}

        {tab === "yaml" && (
          <YamlTab
            yaml={yaml}
            setYaml={setYaml}
            loading={loading}
            saving={saving}
            dirty={dirty}
            onSave={onSave}
            onDiscard={onDiscard}
          />
        )}
        {tab === "events" && <EventsTab ref={ref} />}
        {tab === "properties" && <PropertiesTab row={row} />}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// YAML tab
// ---------------------------------------------------------------------------

interface YamlTabProps {
  yaml: string;
  setYaml: (s: string) => void;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

function YamlTab({ yaml, setYaml, loading, saving, dirty, onSave, onDiscard }: YamlTabProps) {
  if (loading) return <div className="detail-loading">Loading YAML…</div>;
  return (
    <>
      <div className="yaml-toolbar">
        <span className={`yaml-status ${dirty ? "is-dirty" : ""}`}>
          {dirty ? "modified" : "saved"}
        </span>
        <div className="yaml-spacer" />
        <button
          className="iconbtn"
          onClick={onDiscard}
          disabled={!dirty || saving}
          title="Discard changes"
        >
          ↶
        </button>
        <button
          className="iconbtn primary"
          onClick={onSave}
          disabled={!dirty || saving}
          title="Save (server-side apply)"
        >
          {saving ? "…" : "Save"}
        </button>
      </div>
      <textarea
        className="yaml-editor"
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        spellCheck={false}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Events tab
// ---------------------------------------------------------------------------

function EventsTab({ ref }: { ref: ResourceRef }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await provider.getEvents(ref);
        setRows(r);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [ref.name, ref.namespace, ref.kind]);

  if (error) return <div className="error-banner">{error}</div>;
  if (rows === null) return <div className="detail-loading">Loading events…</div>;
  if (rows.length === 0) return <div className="detail-empty">No events.</div>;

  return (
    <div className="events-list">
      {rows.map((r) => (
        <div key={r.uid} className="event-row">
          <div className="event-head">
            <span className={`event-type tone-${r.cells[0]?.tone ?? "muted"}`}>
              {r.cells[0]?.text ?? "?"}
            </span>
            <span className="event-reason">{r.cells[4]?.text ?? ""}</span>
            <span className="event-count">{r.cells[7]?.text ?? ""}</span>
          </div>
          <div className="event-msg">{r.cells[5]?.text ?? ""}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Properties tab
// ---------------------------------------------------------------------------

function PropertiesTab({ row }: { row: Row }) {
  const labels = row.labels ?? {};
  const entries = Object.entries(labels);
  return (
    <div className="props">
      <div className="props-section">
        <div className="props-key">Name</div>
        <div className="props-val tone-primary">{row.name}</div>
      </div>
      {row.namespace && (
        <div className="props-section">
          <div className="props-key">Namespace</div>
          <div className="props-val tone-muted">{row.namespace}</div>
        </div>
      )}
      <div className="props-section">
        <div className="props-key">UID</div>
        <div className="props-val tone-muted">{row.uid || "—"}</div>
      </div>
      {row.selector && (
        <div className="props-section">
          <div className="props-key">Selector</div>
          <div className="props-val tone-muted">
            {Object.entries(row.selector)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}
          </div>
        </div>
      )}
      {row.pod && (
        <>
          <div className="props-section">
            <div className="props-key">Node</div>
            <div className="props-val tone-muted">{row.pod.node || "—"}</div>
          </div>
          <div className="props-section">
            <div className="props-key">Containers</div>
            <div className="props-val tone-muted">{row.pod.containers.join(", ") || "—"}</div>
          </div>
        </>
      )}
      <div className="props-section">
        <div className="props-key">Labels</div>
        <div className="props-val tone-muted">
          {entries.length === 0
            ? "—"
            : entries.map(([k, v]) => (
                <div key={k} className="props-label-row">
                  {k}={v}
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}
