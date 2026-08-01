/**
 * Sidebar — the resource navigator.
 *
 * Pure presentation: the parent owns `active` and `onPick`. Renders the
 * k7s brand, the current context, and the grouped nav items.
 *
 * Style is driven by tokens (see `src/styles/tokens.css`) — no hard
 * colors here.
 */

import type { ResourceKind } from "../../providers/types";

export interface NavLeaf {
  kind: ResourceKind | string;
  label: string;
  icon: string;
  hotkey?: string;
}

export interface NavGroup {
  group: string;
  items: NavLeaf[];
}

interface SidebarProps {
  nav: NavGroup[];
  active: string;
  onPick: (kind: string) => void;
  contextName: string | null;
}

export function Sidebar({ nav, active, onPick, contextName }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">k7s</div>
        <div className="brand-sub">{contextName ?? "no context"}</div>
      </div>
      <nav className="nav">
        {nav.map((g) => (
          <div key={g.group} className="nav-group">
            <div className="nav-group-title">{g.group}</div>
            {g.items.map((item) => {
              const isActive = item.kind === active;
              return (
                <button
                  key={item.kind}
                  className={`nav-item ${isActive ? "is-active" : ""}`}
                  onClick={() => onPick(item.kind)}
                >
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.hotkey && <span className="nav-hotkey">{item.hotkey}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="kbd">j</span>
        <span className="kbd">k</span>
        <span> nav</span>
        <span className="kbd">⏎</span>
        <span> detail</span>
        <span className="kbd">/</span>
        <span> filter</span>
      </div>
    </aside>
  );
}
