/**
 * AiSettingsPanel — the configuration block for the built-in AI assistant,
 * rendered inside the Settings dialog (alongside McpPanel).
 *
 * Surfaces: master enable toggle, LLM provider (base URL / model / temperature
 * / api key), permission mode, and a "test connection" button. Talks to the
 * backend through `ai_get_config`, `ai_save_config`, `ai_save_api_key`, and
 * `ai_test_connection`.
 */
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AiConfigView, PermissionMode } from '../../lib/ai/types';
import styles from './AiAssistantPanel.module.css';
import s from '../settings/SettingsPanel.module.css';

// Local aliases for readability — all defined in AiAssistantPanel.module.css.
const aiField = styles.field;
const aiRow = styles.field;
const aiLabel = styles.fieldLabel;
const aiInput = styles.fieldInput;
const aiHint = styles.hint;
const aiActions = styles.actions;

const DEFAULT_BASE_URLS: Record<string, string> = {
  DeepSeek: 'https://api.deepseek.com/v1',
  Kimi: 'https://api.moonshot.cn/v1',
  Zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  OpenAI: 'https://api.openai.com/v1',
  Ollama: 'http://localhost:11434/v1',
};

export function AiSettingsPanel() {
  const [config, setConfig] = useState<AiConfigView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const view = await invoke<AiConfigView>('ai_get_config');
      setConfig(view);
    } catch (e) {
      setTestMsg({ ok: false, text: String(e) });
    }
  }

  async function save() {
    if (!config) return;
    try {
      await invoke('ai_save_config', { configInput: stripView(config) });
      if (apiKey) {
        await invoke('ai_save_api_key', { apiKey });
        setApiKey('');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: `Save failed: ${e}` });
    }
  }

  async function test() {
    if (!config) return;
    setTesting(true);
    setTestMsg(null);
    try {
      // Persist first so the backend reads the current values.
      await invoke('ai_save_config', { configInput: stripView(config) });
      if (apiKey) {
        await invoke('ai_save_api_key', { apiKey });
      }
      const msg = await invoke<string>('ai_test_connection');
      setTestMsg({ ok: true, text: msg });
    } catch (e) {
      setTestMsg({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  }

  if (!config) {
    return <div className={s.mcpHint}>Loading…</div>;
  }

  return (
    <div className={s.mcpSection}>
      <div className={s.mcpHeader}>
        <div className={s.mcpHeaderText}>
          <div className={s.mcpTitle}>
            AI Assistant <span className={s.mcpBadge}>BETA</span>
          </div>
          <div className={s.mcpHint}>
            A built-in chat assistant that can read and operate your cluster.
            Bring your own key — works with any OpenAI-compatible provider
            (DeepSeek, Kimi, Zhipu, OpenAI, local Ollama).
          </div>
        </div>
      </div>

      <div className={aiField}>
        <label className={aiLabel}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
          />
          Enable AI assistant
        </label>
      </div>

      <div className={aiRow}>
        <label className={aiLabel}>Provider preset</label>
        <select
          className={s.mcpCopy}
          onChange={(e) => {
            const url = DEFAULT_BASE_URLS[e.target.value];
            if (url) setConfig({ ...config, provider: { ...config.provider, baseUrl: url } });
          }}
          value={
            Object.entries(DEFAULT_BASE_URLS).find(([, u]) => u === config.provider.baseUrl)?.[0] ??
            ''
          }
        >
          <option value="">Custom…</option>
          {Object.keys(DEFAULT_BASE_URLS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className={aiRow}>
        <label className={aiLabel}>Base URL</label>
        <input
          className={aiInput}
          value={config.provider.baseUrl}
          placeholder="https://api.deepseek.com/v1"
          onChange={(e) =>
            setConfig({ ...config, provider: { ...config.provider, baseUrl: e.target.value } })
          }
        />
      </div>

      <div className={aiRow}>
        <label className={aiLabel}>Model</label>
        <input
          className={aiInput}
          value={config.provider.model}
          placeholder="deepseek-chat"
          onChange={(e) =>
            setConfig({ ...config, provider: { ...config.provider, model: e.target.value } })
          }
        />
      </div>

      <div className={aiRow}>
        <label className={aiLabel}>
          API key {config.hasApiKey && !apiKey && <span className={aiHint}>(stored)</span>}
        </label>
        <input
          className={aiInput}
          type="password"
          value={apiKey}
          placeholder={config.hasApiKey ? '•••••••• (enter new to replace)' : 'sk-…'}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <div className={aiRow}>
        <label className={aiLabel}>Permission mode</label>
        <select
          className={s.mcpCopy}
          value={config.permission}
          onChange={(e) =>
            setConfig({ ...config, permission: e.target.value as PermissionMode })
          }
        >
          <option value="readConfirmWrite">Read freely, confirm writes (default)</option>
          <option value="readOnly">Read-only</option>
          <option value="fullAuto">Full auto (no confirmation)</option>
        </select>
      </div>

      <div className={aiActions}>
        <button type="button" className={s.mcpCopy} onClick={test} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button type="button" className={styles.sendBtn} onClick={save}>
          {saved ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {testMsg && (
        <div className={testMsg.ok ? styles.testOk : styles.errorMsg}>
          {testMsg.ok ? '✓ ' : '⚠ '}
          {testMsg.text}
        </div>
      )}
    </div>
  );
}

/** Strip the view-only `hasApiKey` field before sending config back. */
function stripView(view: AiConfigView) {
  const { hasApiKey: _unused, ...cfg } = view;
  void _unused;
  return cfg;
}
