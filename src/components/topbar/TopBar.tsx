/**
 * TopBar — context switcher, namespace filter, search input.
 *
 * Pure presentation. The parent owns the data; this just lays it out.
 */

import { useEffect, useRef } from "react";
import type { ContextInfo, Row } from "../../providers/types";

interface TopBarProps {
  contexts: ContextInfo[];
  currentContext: string | null;
  namespaces: Row[];
  namespace: string;
  onPickContext: (name: string) => void;
  onPickNamespace: (name: string) => void;
  filter: string;
  onFilterChange: (s: string) => void;
  /** Optional connected cluster name (shown right-aligned). */
  clusterName?: string;
  /** Optional click handler for the about button. */
  onAbout?: () => void;
}

export function TopBar({
  contexts,
  currentContext,
  namespaces,
  namespace,
  onPickContext,
  onPickNamespace,
  filter,
  onFilterChange,
  clusterName,
  onAbout,
}: TopBarProps) {
  const filterRef = useRef<HTMLInputElement | null>(null);

  // Global "/" to focus filter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const tag = document.activeElement?.tagName?.toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      filterRef.current?.focus();
      filterRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="topbar">
      <div className="topbar-section">
        <span className="dot dot-ok pulse" />
        <select
          className="select"
          value={currentContext ?? ""}
          onChange={(e) => onPickContext(e.target.value)}
          title="Switch context"
        >
          {contexts.length === 0 && <option value="">(no contexts)</option>}
          {contexts.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
              {c.isCurrent ? " (current)" : ""}
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
          title="Namespace filter"
        >
          <option value="">all</option>
          {namespaces.map((ns) => (
            <option key={ns.uid || ns.name} value={ns.name}>
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

      {clusterName && <div className="topbar-cluster">{clusterName}</div>}
      {onAbout && (
        <button
          className="iconbtn topbar-about"
          onClick={onAbout}
          title="About / settings (Shift+?)"
        >
          ?
        </button>
      )}
    </header>
  );
}
