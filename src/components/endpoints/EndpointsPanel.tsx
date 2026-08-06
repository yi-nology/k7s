/**
 * EndpointsPanel — the EndpointSlices table (Phase 1 Tier-2 of KubePi parity).
 *
 * The first half is the slice list (one row per EndpointSlice, with
 * ready/total so 503s are obvious at a glance). The second half is the
 * drill-down: click a row, get one entry per backing address with
 * readiness + the pod the address points to.
 *
 * Why a separate panel: a "503 No endpoints available" on a Service is
 * the canonical debugging path, and the Endpoints object is the one
 * thing to look at. Surfacing it as its own kind makes the link from
 * "Service is broken" → "here's why" one click instead of three.
 */
import { useEffect, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import type { EndpointAddress, EndpointRow } from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './EndpointsPanel.module.css';

export function EndpointsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<EndpointRow[]>([]);
  const [selected, setSelected] = useState<EndpointRow | null>(null);
  const [addresses, setAddresses] = useState<EndpointAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getProvider()
      .listEndpoints()
      .then((r) => setRows(r))
      .catch((e: unknown) => setError(formatError(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) {
      setAddresses([]);
      return;
    }
    getProvider()
      .listEndpointAddresses(selected.namespace, selected.name)
      .then(setAddresses)
      .catch((e: unknown) => setError(formatError(e)));
  }, [selected]);

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('endpoints.title', 'Endpoints')}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t('endpoints.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <div className={styles.list}>
          {loading && rows.length === 0 ? (
            <div className={styles.empty}>…</div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>
              {t('endpoints.empty', 'No EndpointSlices in this cluster')}
            </div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('endpoints.col.name', 'Name')}</th>
                  <th>{t('endpoints.col.namespace', 'Namespace')}</th>
                  <th>{t('endpoints.col.service', 'Service')}</th>
                  <th>{t('endpoints.col.ready', 'Ready')}</th>
                  <th>{t('endpoints.col.addresses', 'Addresses')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tone =
                    r.ready === 0 ? styles.bad : r.ready < r.total ? styles.warn : styles.ok;
                  return (
                    <tr
                      key={`${r.namespace}/${r.name}`}
                      onClick={() => setSelected(r)}
                      className={
                        selected?.name === r.name && selected?.namespace === r.namespace
                          ? styles.rowActive
                          : styles.row
                      }
                    >
                      <td>{r.name}</td>
                      <td>{r.namespace}</td>
                      <td>{r.service}</td>
                      <td className={tone}>
                        {r.ready}/{r.total}
                      </td>
                      <td className={styles.mono}>
                        {r.addresses.length > 2
                          ? `${r.addresses.slice(0, 2).join(', ')} +${r.addresses.length - 2}`
                          : r.addresses.join(', ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {selected && (
          <div className={styles.detail}>
            <h3>
              {selected.namespace}/{selected.name}
            </h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('endpoints.col.address', 'Address')}</th>
                  <th>{t('endpoints.col.ready', 'Ready')}</th>
                  <th>{t('endpoints.col.target', 'Target')}</th>
                  <th>{t('endpoints.col.node', 'Node')}</th>
                </tr>
              </thead>
              <tbody>
                {addresses.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles.empty}>
                      —
                    </td>
                  </tr>
                ) : (
                  addresses.map((a, i) => (
                    <tr key={i}>
                      <td className={styles.mono}>{a.address}</td>
                      <td className={a.ready ? styles.ok : styles.bad}>{a.ready ? '✓' : '✗'}</td>
                      <td>
                        {a.targetRefKind}/{a.targetRefName}
                      </td>
                      <td>{a.nodeName}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
