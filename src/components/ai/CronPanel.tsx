/**
 * CronPanel — scheduled AI task management. Shows preset + user-defined tasks,
 * toggle enable/disable, view run history.
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { CronTask } from '../../lib/ai/types';
import styles from './AiAssistantPanel.module.css';

export function CronPanel() {
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [presets, setPresets] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPresets, setShowPresets] = useState(false);

  const load = async () => {
    try {
      setTasks(await invoke<CronTask[]>('ai_cron_list'));
      setPresets(await invoke<CronTask[]>('ai_cron_presets'));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggle = async (id: string) => {
    try {
      await invoke('ai_cron_toggle', { id });
      await load();
    } catch {
      /* ignore */
    }
  };

  const remove = async (id: string) => {
    try {
      await invoke('ai_cron_delete', { id });
      await load();
    } catch {
      /* ignore */
    }
  };

  const addPreset = async (preset: CronTask) => {
    try {
      await invoke('ai_cron_add', { task: { ...preset, id: preset.id + '-' + Date.now() } });
      setShowPresets(false);
      await load();
    } catch {
      /* ignore */
    }
  };

  if (loading) return <div className={styles.empty}>Loading…</div>;

  return (
    <div className={styles.body}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          className={styles.sendBtn}
          onClick={() => setShowPresets(!showPresets)}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          {showPresets ? 'Close' : '+ Add preset'}
        </button>
      </div>

      {showPresets && (
        <div style={{ marginBottom: 10 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolName}>Preset tasks</span>
          </div>
          {presets.map((p) => (
            <div
              key={p.id}
              className={styles.toolCard}
              style={{ marginBottom: 4, cursor: 'pointer' }}
              onClick={() => addPreset(p)}
            >
              <div className={styles.toolHeader}>
                <span className={styles.toolName}>{p.name}</span>
                <span className={styles.toolState}>{p.cronExpr}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>{p.prompt.slice(0, 100)}…</div>
            </div>
          ))}
        </div>
      )}

      {tasks.length === 0 && (
        <div className={styles.empty}>
          No scheduled tasks. Click "+ Add preset" to get started with
          automated health checks.
        </div>
      )}

      {tasks.map((task) => (
        <div key={task.id} className={styles.toolCard} style={{ marginBottom: 6 }}>
          <div className={styles.toolHeader}>
            <span className={styles.toolIcon}>{task.enabled ? '▶' : '⏸'}</span>
            <span className={styles.toolName}>{task.name}</span>
            <span className={styles.toolState}>{task.cronExpr}</span>
            <button
              type="button"
              className={styles.close}
              onClick={() => remove(task.id)}
              title="Delete"
            >
              ✕
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 6 }}>
            {task.prompt.slice(0, 120)}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => toggle(task.id)}
              style={{
                border: 'none',
                background: task.enabled ? 'var(--ok, #22c55e)' : 'var(--bg-control)',
                color: task.enabled ? '#fff' : 'var(--fg)',
                padding: '3px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {task.enabled ? 'Enabled' : 'Disabled'}
            </button>
            {task.lastRun && (
              <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                Last: {task.lastRun.slice(0, 16).replace('T', ' ')}{' '}
                {task.lastStatus === 'success' ? '✓' : task.lastStatus === 'failed' ? '✗' : ''}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
