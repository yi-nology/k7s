/**
 * CronPanel — scheduled AI task management.
 */
import { useCallback, useEffect, useState } from 'react';
import { getProvider } from '../../providers';
import type { CronTask } from '../../lib/ai/types';
import { useTranslation } from '../../hooks/useI18n';
import styles from './AiChat.module.css';

export function CronPanel() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [presets, setPresets] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPresets, setShowPresets] = useState(false);
  const provider = getProvider();

  const load = useCallback(async () => {
    try {
      setTasks(await provider.aiCronList());
      setPresets(await provider.aiCronPresets());
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [provider]);

  useEffect(() => { void load(); }, [load]);

  const toggle = async (id: string) => {
    try { await provider.aiCronToggle(id); await load(); } catch { /* ignore */ }
  };

  const remove = async (id: string) => {
    try { await provider.aiCronDelete(id); await load(); } catch { /* ignore */ }
  };

  const addPreset = async (preset: CronTask) => {
    try {
      await provider.aiCronAdd({ ...preset, id: preset.id + '-' + Date.now() });
      setShowPresets(false);
      await load();
    } catch { /* ignore */ }
  };

  if (loading) return <div className={styles.empty}>{t('ai.cron.loading')}</div>;

  return (
    <div className={styles.body}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button type="button" className={styles.sendBtn} onClick={() => setShowPresets(!showPresets)} style={{ fontSize: 12, padding: '4px 10px' }}>
          {showPresets ? t('ai.cron.close') : t('ai.cron.addPreset')}
        </button>
      </div>

      {showPresets && (
        <div style={{ marginBottom: 10 }}>
          <div className={styles.toolHeader}><span className={styles.toolName}>{t('ai.cron.presetTasks')}</span></div>
          {presets.map((p) => (
            <div key={p.id} className={styles.toolCard} style={{ marginBottom: 4, cursor: 'pointer' }} onClick={() => addPreset(p)}>
              <div className={styles.toolHeader}>
                <span className={styles.toolName}>{p.name}</span>
                <span className={styles.toolStatusPill}>{p.cronExpr}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.prompt.slice(0, 100)}…</div>
            </div>
          ))}
        </div>
      )}

      {tasks.length === 0 && <div className={styles.empty}>{t('ai.cron.noTasks')}</div>}

      {tasks.map((task) => (
        <div key={task.id} className={styles.toolCard} style={{ marginBottom: 6 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}>{task.enabled ? '▶' : '⏸'}</span>
            <span className={styles.toolName}>{task.name}</span>
            <span className={styles.toolStatusPill}>{task.cronExpr}</span>
            <button type="button" className={styles.headerTab} onClick={() => remove(task.id)} title={t('ai.cron.delete')} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{task.prompt.slice(0, 120)}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" onClick={() => toggle(task.id)} className={task.enabled ? styles.approveBtn : styles.denyBtn} style={{ fontSize: 11, padding: '2px 8px', flex: 'none' }}>
              {task.enabled ? t('ai.cron.enabled') : t('ai.cron.disabled')}
            </button>
            {task.lastRun && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {t('ai.cron.last')} {task.lastRun.slice(0, 16).replace('T', ' ')} {task.lastStatus === 'success' ? '✓' : task.lastStatus === 'failed' ? '✗' : ''}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
