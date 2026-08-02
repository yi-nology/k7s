/**
 * Active port-forwards strip (B6, B16). Renders above the status bar whenever
 * there are live forwards, each as `localhost:PORT → target:REMOTE` with a ✕ to
 * stop it. Clicking the local address copies it.
 *
 * A Service forward (B16) shows the service name — that's what the user asked to
 * forward — with the pod it actually resolved to in the tooltip. A forward whose
 * connections are failing turns red but stays listed: its listener is still bound
 * and the pod may come back.
 *
 * v2 — the error tooltip joins with " — " instead of "\n": an HTML `title`
 * attribute doesn't render newlines (browsers squash them to a space, so the
 * resolved target and the failure string ended up glued together with no visual
 * separator). The em-dash is the same pattern TemplatePicker.tsx uses for its
 * per-row error join, so error copy reads consistently across the chrome.
 */

import styles from "./ForwardsBar.module.css";
import { useStore } from "../../store";
import { getProvider } from "../../providers";
import { useTranslation } from "../../hooks/useI18n";
import type { ForwardInfo } from "../../providers/types";

export function ForwardsBar() {
  const forwards = useStore((s) => s.portForwards);
  const setPortForwards = useStore((s) => s.setPortForwards);
  const { t } = useTranslation();

  if (forwards.length === 0) return null;

  const stop = async (id: string) => {
    await getProvider().stopPortForward(id);
    setPortForwards(await getProvider().listPortForwards());
  };

  return (
    <div className={styles.bar}>
      <span className={styles.label}>{t("chrome.forwards.label")}</span>
      {forwards.map((f) => (
        <span
          key={f.id}
          className={`${styles.item} ${f.error ? styles.itemError : ""}`}
          title={tooltip(f, t)}
        >
          <span
            className={styles.local}
            title={t("chrome.forwards.copyAddress")}
            onClick={() => void copy(`localhost:${f.localPort}`)}
          >
            localhost:{f.localPort}
          </span>
          <span className={styles.arrow}>→</span>
          <span className={styles.target}>
            {f.service ?? f.pod}:{f.servicePort ?? f.remotePort}
          </span>
          {f.error && <span className={styles.errorMark}>!</span>}
          <span className={styles.stop} title={t("chrome.forwards.stopForward")} onClick={() => void stop(f.id)}>
            ✕
          </span>
        </span>
      ))}
    </div>
  );
}

/** Full detail on hover: the resolved pod and port for services, and any failure. */
function tooltip(
  f: ForwardInfo,
  t: (key: string, ...args: unknown[]) => string,
): string {
  // The strip shows the port asked for; the tooltip is where the resolved
  // targetPort belongs, since that's the detail you'd want when debugging.
  const base = f.service
    ? t("chrome.forwards.serviceTarget", f.namespace, f.service, f.servicePort ?? f.remotePort, f.pod, f.remotePort)
    : t("chrome.forwards.podTarget", f.namespace, f.pod, f.remotePort);
  // Em-dash separator (not a newline): the `title` attribute collapses \n to a
  // space, so the error would otherwise be glued onto the resolved target with
  // no visual break.
  return f.error ? `${base} — ${f.error}` : base;
}

/** Copy silently; the address stays visible either way. */
async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Non-fatal.
  }
}
