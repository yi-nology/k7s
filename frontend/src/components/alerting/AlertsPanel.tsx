/**
 * AlertsPanel — list active alerts, silences, and alert rules from
 * configured AlertManager / Prometheus instances.
 *
 * Supports creating and expiring silences, and viewing Prometheus
 * alerting rules (read-only).
 */
import { useCallback, useEffect, useState } from 'react';
import { formatError, getProvider } from '../../providers';
import type {
  Alert,
  AlertManager,
  CreateSilenceRequest,
  RuleGroup,
  Silence,
} from '../../providers/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './AlertsPanel.module.css';
import { AlertList } from './AlertList';
import { SilenceList } from './SilenceList';
import { CreateSilenceForm } from './CreateSilenceForm';
import { RuleList } from './RuleList';

export function AlertsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [instances, setInstances] = useState<AlertManager[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [silences, setSilences] = useState<Silence[]>([]);
  const [ruleGroups, setRuleGroups] = useState<RuleGroup[]>([]);
  const [tab, setTab] = useState<'alerts' | 'silences' | 'rules'>('alerts');
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    getProvider()
      .alertManagerList()
      .then((rows) => {
        setInstances(rows);
        if (rows.length > 0 && !selected) {
          setSelected(rows[0].name);
        }
      })
      .catch((e: unknown) => setError(formatError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    if (!selected) return;
    setError(null);
    if (tab === 'alerts') {
      getProvider()
        .alertManagerAlerts(selected)
        .then(setAlerts)
        .catch((e: unknown) => setError(formatError(e)));
    } else if (tab === 'silences') {
      getProvider()
        .alertManagerSilences(selected)
        .then(setSilences)
        .catch((e: unknown) => setError(formatError(e)));
    }
  }, [selected, tab]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fetch rules from Prometheus when switching to rules tab.
  useEffect(() => {
    if (tab !== 'rules') return;
    if (instances.length === 0) return;
    // Use the first Prometheus instance (by convention the instance name
    // matches the AlertManager name; if not, we just try the first one).
    const promInstance = selected ?? instances[0]?.name;
    if (!promInstance) return;
    setError(null);
    getProvider()
      .prometheusRules(promInstance)
      .then(setRuleGroups)
      .catch((e: unknown) => setError(formatError(e)));
  }, [tab, selected, instances]);

  const handleExpireSilence = useCallback(
    async (silenceId: string) => {
      if (!selected) return;
      setError(null);
      try {
        await getProvider().alertManagerDeleteSilence(selected, silenceId);
        refresh();
      } catch (e: unknown) {
        setError(formatError(e));
      }
    },
    [selected, refresh]
  );

  const handleCreateSilence = useCallback(
    async (request: CreateSilenceRequest) => {
      if (!selected) return;
      setError(null);
      try {
        await getProvider().alertManagerCreateSilence(selected, request);
        setShowCreateForm(false);
        setTab('silences');
        refresh();
      } catch (e: unknown) {
        setError(formatError(e));
      }
    },
    [selected, refresh]
  );

  return (
    <div className={styles.panel}>
      <header className={styles.header}>
        <h2>{t('alerts.title', 'Alerts')}</h2>
        {onClose && (
          <button className={styles.btn} onClick={onClose}>
            {t('alerts.close', 'Close')}
          </button>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.body}>
        <aside className={styles.side}>
          {instances.length === 0 ? (
            <div className={styles.empty}>{t('alerts.none', 'No AlertManager instances yet')}</div>
          ) : (
            <ul className={styles.list}>
              {instances.map((i) => (
                <li
                  key={i.name}
                  className={selected === i.name ? styles.itemActive : styles.item}
                  onClick={() => setSelected(i.name)}
                >
                  <div className={styles.itemName}>{i.name}</div>
                  <div className={styles.itemUrl}>{i.url}</div>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <main className={styles.main}>
          {selected ? (
            <>
              <div className={styles.tabs}>
                <button
                  className={tab === 'alerts' ? styles.activeTab : styles.tab}
                  onClick={() => setTab('alerts')}
                >
                  {t('alerts.tabs.alerts', 'Alerts')} ({alerts.length})
                </button>
                <button
                  className={tab === 'silences' ? styles.activeTab : styles.tab}
                  onClick={() => setTab('silences')}
                >
                  {t('alerts.tabs.silences', 'Silences')} ({silences.length})
                </button>
                <button
                  className={tab === 'rules' ? styles.activeTab : styles.tab}
                  onClick={() => setTab('rules')}
                >
                  {t('alerts.tabs.rules', 'Rules')}
                </button>
              </div>
              {tab === 'alerts' && <AlertList alerts={alerts} />}
              {tab === 'silences' && (
                <SilenceList
                  silences={silences}
                  onExpire={handleExpireSilence}
                  onCreate={() => setShowCreateForm(true)}
                />
              )}
              {tab === 'rules' && <RuleList groups={ruleGroups} />}
              {showCreateForm && (
                <CreateSilenceForm
                  onSubmit={handleCreateSilence}
                  onCancel={() => setShowCreateForm(false)}
                />
              )}
            </>
          ) : (
            <div className={styles.empty}>
              {t('alerts.pick', 'Add an AlertManager instance to get started')}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// Components extracted to separate files:
// - AlertList: ./AlertList.tsx
// - SilenceList: ./SilenceList.tsx
// - CreateSilenceForm: ./CreateSilenceForm.tsx
// - RuleList: ./RuleList.tsx
