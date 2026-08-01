import { useEffect, useRef } from "react";
import type { ContextInfo, NamespaceRow } from "../lib/types";

interface TopBarProps {
  contexts: ContextInfo[];
  currentContext: string | null;
  namespaces: NamespaceRow[];
  namespace: string;
  onPickContext: (name: string) => void;
  onPickNamespace: (name: string) => void;
  onRefreshNow: () => void;
  loading: boolean;
  refreshIn: number;
  filter: string;
  onFilterChange: (s: string) => void;
  onToggleAutoRefresh: () => void;
  autoRefresh: boolean;
}

export function TopBar({
  contexts,
  currentContext,
  namespaces,
  namespace,
  onPickContext,
  onPickNamespace,
  onRefreshNow,
  loading,
  refreshIn,
  filter,
  onFilterChange,
  onToggleAutoRefresh,
  autoRefresh,
}: TopBarProps) {
  const filterRef = useRef<HTMLInputElement | null>(null);

  // Global "/" to focus filter
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-section">
        <span className="dot" />
        <select
          className="select"
          value={currentContext ?? ""}
          onChange={(e) => onPickContext(e.target.value)}
        >
          {contexts.length === 0 && <option value="">(no contexts)</option>}
          {contexts.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
              {c.is_current ? " (current)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="topbar-section">
        <span className="topbar-label">NS</span>
        <select
          className="select"
          value={namespace}
          onChange={(e) => onPickNamespace(e.target.value)}
        >
          <option value="">all</option>
          {namespaces.map((ns) => (
            <option key={ns.name} value={ns.name}>
              {ns.name}
            </option>
          ))}
        </select>
      </div>

      <div className="topbar-section topbar-filter">
        <span className="topbar-label">Filter</span>
        <input
          ref={filterRef}
          className="input"
          placeholder="/ to focus"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
      </div>

      <div className="topbar-spacer" />

      <button
        className="iconbtn"
        onClick={onToggleAutoRefresh}
        title={
          autoRefresh
            ? `Auto-refresh ON (next in ${refreshIn}s)`
            : "Auto-refresh OFF"
        }
      >
        {autoRefresh ? `${refreshIn}s` : "off"}
      </button>
      <button
        className="iconbtn"
        onClick={onRefreshNow}
        title="Refresh now (r)"
        disabled={loading}
      >
        {loading ? "⟳" : "↻"}
      </button>
    </header>
  );
}
