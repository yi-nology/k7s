/**
 * TopologyPanel — a Service → Endpoints → Pod → Container relationship
 * graph (Phase 1 Tier-2 of KubePi parity).
 *
 * This is the "ingress-relationship-chart" port: a list view of Services
 * where clicking one fetches its EndpointSlices and the pods those slices
 * point to. We use a card list rather than a true graph layout because
 * the chart in k7s is a single Service at a time, not the whole
 * cluster at once — graph layout is the next step.
 *
 * Why this exists separately: the "what is this Service pointing at"
 * question is the most common debugging pivot, and answering it takes
 * one click here vs. the three-clicks-plus-eyeballs it takes in
 * kubectl. The card layout also reads better on a small window than
 * a force-directed graph would.
 */
import { useEffect, useState } from "react";
import { getProvider } from "../../providers";
import type { EndpointRow } from "../../providers/types";
import { useTranslation } from "../../hooks/useI18n";
import { TopologyGraph } from "./TopologyGraph";
import styles from "./TopologyPanel.module.css";

interface ServiceTopology {
  service: string;
  namespace: string;
  slices: EndpointRow[];
}

/**
 * TopologyPanel — wraps the d3 force-directed graph with a slim sidebar
 * (the Service list) and a header. The previous "card list" implementation
 * lived here too; it was replaced by TopologyGraph because the card
 * layout doesn't scale to whole-cluster views. The sidebar is still
 * handy for finding a Service by name and seeing at a glance which
 * ones have ready backends.
 */
export function TopologyPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [services, setServices] = useState<ServiceTopology[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProvider()
      .listEndpoints()
      .then((all) => {
        if (cancelled) return;
        const byService = new Map<string, ServiceTopology>();
        for (const slc of all) {
          if (!slc.service) continue;
          const key = `${slc.namespace}/${slc.service}`;
          let entry = byService.get(key);
          if (!entry) {
            entry = {
              service: slc.service,
              namespace: slc.namespace,
              slices: [],
            };
            byService.set(key, entry);
          }
          entry.slices.push(slc);
        }
        setServices([...byService.values()].sort((a, b) =>
          a.service.localeCompare(b.service),
        ));
      })
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t("topology.title", "Service Topology")}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t("topology.close", "Close")}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          <h3 className={styles.colHeader}>
            {t("topology.col.service", "Service")}
          </h3>
          {services.length === 0 ? (
            <div className={styles.empty}>
              {t("topology.empty", "No services with endpoints")}
            </div>
          ) : (
            <ul className={styles.list}>
              {services.map((s) => (
                <li
                  key={`${s.namespace}/${s.service}`}
                  className={styles.item}
                >
                  <div className={styles.itemName}>{s.service}</div>
                  <div className={styles.itemMeta}>
                    {s.namespace} · {s.slices.length} slice
                    {s.slices.length === 1 ? "" : "s"} ·{" "}
                    {s.slices.reduce((n, sl) => n + sl.ready, 0)} ready
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <main className={styles.main}>
          <TopologyGraph />
        </main>
      </div>
    </div>
  );
}
