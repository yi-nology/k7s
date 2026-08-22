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
import { useProviderQuery } from '../../hooks/useProviderQuery';
import styles from './AlertsPanel.module.css';
import { AlertList } from './AlertList';
import { SilenceList } from './SilenceList';
import { CreateSilenceForm } from './CreateSilenceForm';
import { RuleList } from './RuleList';

export function AlertsPanel({ onClose }: { onClose?: () => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<'alerts' | 'silences' | 'rules'>('alerts');
  const [actionError, setActionError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  const instancesQuery = useProviderQuery<AlertManager[]>({
    query: () => getProvider().alertManagerList(),
    deps: [],
    key: 'alerts:instances',
  });
  const instances = instancesQuery.data ?? [];

  // Auto-select the first instance once the list arrives.
  useEffect(() => {
    if (instances.length > 0 && !selected) setSelected(instances[0].name);
  }, [instances, selected]);

  // Alerts / silences are each fetched when their tab is active; the other's
  // data is retained so the tab counts stay visible while switching.
  const alertsQuery = useProviderQuery<Alert[]>({
    query: () => (selected && tab === 'alerts' ? getProvider().alertManagerAlerts(selected) : null),
    deps: [selected, tab],
    key: `alerts:list:${selected ?? 'none'}`,
  });
  const alerts = alertsQuery.data ?? [];

  const silencesQuery = useProviderQuery<Silence[]>({
    query: () =>
      selected && tab === 'silences' ? getProvider().alertManagerSilences(selected) : null,
    deps: [selected, tab],
    key: `alerts:silences:${selected ?? 'none'}`,
  });
  const silences = silencesQuery.data ?? [];

  // Rules come from Prometheus, fetched when the rules tab opens. Use the
  // first instance by convention (the instance name matches the
  // AlertManager name; if not, we just try the first one).
  const rulesQuery = useProviderQuery<RuleGroup[]>({
    query: () => {
      if (tab !== 'rules' || instances.length === 0) return null;
      const promInstance = selected ?? instances[0]?.name;
      return promInstance ? getProvider().prometheusRules(promInstance) : null;
    },
    deps: [tab, selected, instances],
    key: `alerts:rules:${selected ?? 'none'}`,
  });
  const ruleGroups = rulesQuery.data ?? [];

  const error = actionError ?? instancesQuery.error ?? alertsQuery.error ?? silencesQuery.error ??
    rulesQuery.error ?? null;

  const refresh = useCallback(() => {
    if (tab === 'alerts') alertsQuery.reload();
    else if (tab === 'silences') silencesQuery.reload();
  }, [tab, alertsQuery.reload, silencesQuery.reload]);

  const handleExpireSilence = useCallback(
    async (silenceId: string) => {
      if (!selected) return;
      setActionError(null);
      try {
        await getProvider().alertManagerDeleteSilence(selected, silenceId);
        refresh();
      } catch (e: unknown) {
        setActionError(formatError(e));
      }
    },
    [selected, refresh]
  );

  const handleCreateSilence = useCallback(
    async (request: CreateSilenceRequest) => {
      if (!selected) return;
      setActionError(null);
      try {
        await getProvider().alertManagerCreateSilence(selected, request);
        setShowCreateForm(false);
        setTab('silences');
        refresh();
      } catch (e: unknown) {
        setActionError(formatError(e));
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
