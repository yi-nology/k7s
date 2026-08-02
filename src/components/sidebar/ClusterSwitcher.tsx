/**
 * Cluster switcher (Design §1, top of the sidebar). Shows the active cluster with
 * an initials badge and a live connection status line, and opens a dropdown of
 * kubeconfig contexts. Selecting one triggers the connect flow.
 */

import { useRef } from "react";
import styles from "./Sidebar.module.css";
import { useStore } from "../../store";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useTranslation } from "../../hooks/useI18n";
import { connectTo } from "../../lib/connect";
import { importKubeconfigViaInput } from "../../providers";
import type { ImportResult } from "../../providers/types";

/** First two letters of the cluster name, uppercased ("FR" for "murphy-yi"). */
function initials(name: string): string {
  return name.slice(0, 2).toUpperCase() || "K7";
}

export function ClusterSwitcher() {
  const connection = useStore((s) => s.connection);
  const clusterStatus = useStore((s) => s.clusterStatus);
  const contexts = useStore((s) => s.contexts);
  const open = useStore((s) => s.openMenu === "cluster");
  const toggleMenu = useStore((s) => s.toggleMenu);
  const closeMenus = useStore((s) => s.closeMenus);
  const setContexts = useStore((s) => s.setContexts);
  const addImportedFile = useStore((s) => s.addImportedFile);
  const { t } = useTranslation();

  const ref = useRef<HTMLDivElement>(null);
  // A long-lived hidden file input. We `click()` it directly from the
  // import button's onClick so the user-gesture chain is a single frame
  // (no `await` in between). Spinning up a fresh input per click used
  // to silently no-op in Safari because the gesture was lost across the
  // Promise boundary.
  const fileInputRef = useRef<HTMLInputElement>(null);
  useClickOutside(ref, closeMenus, open);

  // Import contexts from a kubeconfig file (native picker), then merge them into
  // the switcher list. A null result means the user cancelled the dialog.
  //
  // The user-gesture contract: this function is the onClick handler, and
  // every line in it runs on the same gesture frame. We register the
  // change listener and call `input.click()` back-to-back with no
  // `await` between them — that's what makes Safari reliably pop the
  // system picker. The fetch happens later inside the change handler.
  const onImport = () => {
    closeMenus();
    const input = fileInputRef.current;
    if (!input) return;
    const promise = importKubeconfigViaInput(input).then((result: ImportResult | null) => {
      if (!result) return;
      setContexts(result.contexts);
      // Remember the file so its contexts come back on the next launch (B17).
      addImportedFile(result.path);
    });
    // The click() that opens the OS picker is part of the same user
    // gesture as the button click — no `await` before it.
    input.click();
    // Swallow rejections from the picker (e.g. user dismissed) — those
    // resolve as `null`, not as a rejected promise; rejections are real
    // API errors and worth a console note.
    void promise.catch((e: unknown) => console.error("[import] failed:", e));
  };

  // Display name: the connected cluster, else the selected context, else a stub.
  const name = connection.clusterName ?? connection.context ?? t("chrome.clusterSwitcher.noCluster");

  // Status line: dot color + text reflect the connection lifecycle.
  const { dotColor, statusText } = statusDisplay(
    connection.phase,
    clusterStatus?.version,
    t,
  );

  return (
    <div className={styles.switcher} ref={ref}>
      <div className={styles.switcherButton} onClick={() => toggleMenu("cluster")}>
        <div className={styles.badge}>{initials(name)}</div>
        <div className={styles.switcherText}>
          <div className={styles.clusterName}>{name}</div>
          <div className={styles.statusLine}>
            <span className={styles.dot} style={{ background: dotColor }} />
            {statusText}
          </div>
        </div>
        <span className={styles.chevron}>▼</span>
      </div>

      {open && (
        <div className={styles.menu}>
          {contexts.map((ctx) => {
            const isCurrent = ctx.name === connection.context;
            return (
              <div
                key={ctx.name}
                className={`${styles.menuRow} ${isCurrent ? styles.menuRowActive : ""}`}
                onClick={() => {
                  closeMenus();
                  // No-op if re-selecting the already-connected context.
                  if (!isCurrent) void connectTo(ctx.name);
                }}
              >
                <span
                  className={styles.dot}
                  style={{ background: isCurrent ? "var(--status-ok)" : "var(--dot-inactive)" }}
                />
                <span className={styles.menuName}>{ctx.name}</span>
                <span className={styles.menuEnv}>{ctx.cluster}</span>
              </div>
            );
          })}
          {contexts.length === 0 && (
            <div className={styles.menuRow}>
              <span className={styles.menuName} style={{ color: "var(--text-faint)" }}>
                {t("chrome.sidebar.noContexts")}
              </span>
            </div>
          )}

          {/* Import action, separated from the context list. */}
          <div className={styles.menuDivider} />
          <div className={styles.menuRow} onClick={() => void onImport()}>
            <span className={styles.importIcon}>＋</span>
            <span className={styles.menuName}>{t("chrome.sidebar.importKubeconfig")}</span>
          </div>
        </div>
      )}

      {/*
        The file picker. We keep one input in the React tree for the
        lifetime of the switcher and click() it from the import button
        so the user-gesture chain is unbroken. Hidden offscreen but
        connected, so Safari will actually pop the system dialog.
        accept is a hint, not a filter — kubeconfigs are sometimes
        named `config` with no extension.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,.kubeconfig,application/x-yaml,text/yaml"
        data-testid="kubeconfig-file-input"
        style={{
          position: "fixed",
          left: -9999,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/** Map connection phase → status dot color + text (with version when connected). */
function statusDisplay(
  phase: "idle" | "connecting" | "connected" | "error",
  version: string | undefined,
  t: (key: string, ...args: unknown[]) => string,
): { dotColor: string; statusText: string } {
  switch (phase) {
    case "connected":
      return {
        dotColor: "var(--status-ok)",
        statusText: t("chrome.clusterSwitcher.connected", version),
      };
    case "connecting":
      return { dotColor: "var(--status-warn)", statusText: t("chrome.clusterSwitcher.connecting") };
    default:
      return { dotColor: "var(--status-err)", statusText: t("chrome.clusterSwitcher.disconnected") };
  }
}
