import type { ResourceKind } from "../lib/types";
import { kindLabel } from "../lib/tauri";

export interface NavLeaf {
  kind: ResourceKind;
  label: string;
  icon: string;
  hotkey?: string;
}

export interface NavItem {
  group: string;
  items: NavLeaf[];
}

interface SidebarProps {
  nav: NavItem[];
  active: ResourceKind;
  onPick: (kind: ResourceKind) => void;
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
        {nav.map((group) => (
          <div key={group.group} className="nav-group">
            <div className="nav-group-title">{group.group}</div>
            {group.items.map((item) => {
              const isActive = item.kind === active;
              return (
                <button
                  key={item.kind}
                  className={`nav-item ${isActive ? "is-active" : ""}`}
                  onClick={() => onPick(item.kind)}
                  title={kindLabel[item.kind]?.singular}
                >
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.hotkey && (
                    <span className="nav-hotkey">{item.hotkey}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <span className="kbd">j</span>
        <span className="kbd">k</span>
        <span> navigate</span>
        <span className="kbd">⏎</span>
        <span> detail</span>
        <span className="kbd">d</span>
        <span> delete</span>
      </div>
    </aside>
  );
}
