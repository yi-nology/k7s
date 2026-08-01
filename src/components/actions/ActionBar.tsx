/**
 * ActionBar — context bar that appears below the TopBar when a row is
 * selected. Offers the actions available for the active kind:
 *   - Pods:        Logs (L)  Exec (E)  Restart  Delete
 *   - Deployments: Scale…  Restart  Delete
 *   - StatefulSets:        Scale…  Restart  Delete
 *   - Services:    Port-forward
 *   - Nodes:       Cordon / Uncordon  Drain  Delete
 *
 * Destructive actions prompt for confirmation. Everything is routed
 * through `provider` — no Tauri imports here.
 */

import { useCallback, useState } from "react";

import { provider } from "../../providers";
import type { Row } from "../../providers/types";
import { apiKindFor } from "../../providers/columns";

interface ActionBarProps {
  row: Row;
  /** Lowercase kind id from the sidebar (e.g. "pods"). */
  kind: string;
  /** Called after a successful action so the table can refresh. */
  onActioned?: () => void;
  /** Open the log modal for a pod. */
  onOpenLogs?: (row: Row) => void;
  /** Open the exec (interactive shell) modal for a pod. */
  onOpenExec?: (row: Row) => void;
  /** Open the port-forward modal. */
  onOpenPortForward?: (row: Row) => void;
}

export function ActionBar({
  row,
  kind,
  onActioned,
  onOpenLogs,
  onOpenExec,
  onOpenPortForward,
}: ActionBarProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<void>, label: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await fn();
        onActioned?.();
      } catch (e) {
        setError(`${label}: ${e}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, onActioned],
  );

  const ref = {
    kind: apiKindFor(kind),
    namespace: row.namespace,
    name: row.name,
  };

  const onDelete = useCallback(() => {
    const ok = window.confirm(
      `Delete ${ref.kind} ${row.namespace ? row.namespace + "/" : ""}${row.name}?`,
    );
    if (!ok) return;
    run(() => provider.deleteResource(ref), "delete");
  }, [ref, row, run]);

  const onScale = useCallback(() => {
    const cur =
      kind === "deployments"
        ? (row.cells[1]?.text ?? "0/0")
        : kind === "statefulsets"
          ? (row.cells[2]?.text ?? "0/0")
          : "0";
    const current = parseInt(cur.split("/")[0] || "1", 10);
    const input = window.prompt(`Scale ${row.name} to how many replicas?`, `${current}`);
    if (input == null) return;
    const replicas = parseInt(input, 10);
    if (Number.isNaN(replicas) || replicas < 0) {
      setError(`scale: "${input}" is not a valid replica count`);
      return;
    }
    run(
      () => provider.scaleResource(ref, replicas),
      "scale",
    );
  }, [ref, row, kind, run]);

  const onRestartPod = useCallback(() => {
    const ok = window.confirm(`Restart pod ${row.namespace}/${row.name}?`);
    if (!ok) return;
    run(() => provider.restartPod(ref), "restart");
  }, [ref, row, run]);

  const onRestartRollout = useCallback(() => {
    const ok = window.confirm(`Rollout restart ${ref.kind} ${row.name}?`);
    if (!ok) return;
    run(() => provider.restartRollout(ref), "rollout");
  }, [ref, row, run]);

  const onCordon = useCallback(
    (unschedulable: boolean) => {
      run(() => provider.setCordon(row.name, unschedulable), unschedulable ? "cordon" : "uncordon");
    },
    [row, run],
  );

  const onDrain = useCallback(() => {
    const ok = window.confirm(
      `Drain node ${row.name}? This will evict all non-DaemonSet pods.`,
    );
    if (!ok) return;
    run(() => provider.drainNode(row.name), "drain");
  }, [row, run]);

  return (
    <div className="actionbar">
      <span className="actionbar-target">
        <span className="actionbar-kind">{ref.kind}</span>
        <span className="actionbar-name">{row.name}</span>
      </span>

      {kind === "pods" && (
        <>
          {onOpenLogs && (
            <button className="actionbtn" onClick={() => onOpenLogs(row)}>
              Logs <kbd>L</kbd>
            </button>
          )}
          {onOpenExec && (
            <button className="actionbtn" onClick={() => onOpenExec(row)}>
              Exec <kbd>X</kbd>
            </button>
          )}
          <button className="actionbtn" onClick={onRestartPod}>
            Restart
          </button>
        </>
      )}

      {(kind === "deployments" || kind === "statefulsets" || kind === "daemonsets") && (
        <>
          <button className="actionbtn" onClick={onScale}>
            Scale…
          </button>
          <button className="actionbtn" onClick={onRestartRollout}>
            Restart
          </button>
        </>
      )}

      {kind === "replicasets" && (
        <button className="actionbtn" onClick={onRestartRollout}>
          Restart
        </button>
      )}

      {kind === "services" && onOpenPortForward && (
        <button className="actionbtn" onClick={() => onOpenPortForward(row)}>
          Port-forward
        </button>
      )}

      {kind === "nodes" && (
        <>
          <button className="actionbtn" onClick={() => onCordon(true)}>
            Cordon
          </button>
          <button className="actionbtn" onClick={() => onCordon(false)}>
            Uncordon
          </button>
          <button className="actionbtn warn" onClick={onDrain}>
            Drain
          </button>
        </>
      )}

      {kind !== "namespaces" && kind !== "events" && kind !== "pvc" && (
        <button className="actionbtn danger" onClick={onDelete}>
          Delete
        </button>
      )}

      {error && <span className="actionbar-error">{error}</span>}
    </div>
  );
}
