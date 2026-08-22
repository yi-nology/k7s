/**
 * AiSettingsPanel — the configuration block for the built-in AI assistant,
 * rendered inside the Settings dialog (alongside McpPanel).
 *
 * Surfaces: master enable toggle, LLM provider (base URL / model / temperature
 * / api key), permission mode, and a "test connection" button. Talks to the
 * backend through `ai_get_config`, `ai_save_config`, `ai_save_api_key`, and
 * `ai_test_connection`.
 */
import { useCallback, useEffect, useState } from 'react';
import { getProvider } from '../../providers';
import type { AiConfigView, PermissionMode } from '../../lib/ai/types';
import { useTranslation } from '../../hooks/useI18n';
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
  const { t } = useTranslation();
  const [config, setConfig] = useState<AiConfigView | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const provider = getProvider();

  const load = useCallback(async () => {
    try {
      const view = await provider.aiGetConfig();
      setConfig(view);
    } catch (e) {
      setTestMsg({ ok: false, text: String(e) });
    }
  }, [provider]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!config) return;
    try {
      await provider.aiSaveConfig(stripView(config));
      if (apiKey) {
        await provider.aiSaveApiKey(apiKey);
        setApiKey('');
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      await load();
    } catch (e) {
      setTestMsg({ ok: false, text: t('ai.settings.saveFailed', String(e)) });
    }
  }

  async function test() {
    if (!config) return;
    setTesting(true);
    setTestMsg(null);
    try {
      await provider.aiSaveConfig(stripView(config));
      if (apiKey) {
        await provider.aiSaveApiKey(apiKey);
      }
      const msg = await provider.aiTestConnection();
      setTestMsg({ ok: true, text: msg });
    } catch (e) {
      setTestMsg({ ok: false, text: String(e) });
    } finally {
      setTesting(false);
    }
  }

  if (!config) {
    return <div className={s.mcpHint}>{t('chrome.common.loading')}</div>;
  }

  return (
    <div className={s.mcpSection}>
      <div className={s.mcpHeader}>
        <div className={s.mcpHeaderText}>
          <div className={s.mcpTitle}>
            {t('ai.settings.title')} <span className={s.mcpBadge}>{t('ai.settings.beta')}</span>
          </div>
          <div className={s.mcpHint}>
            {t('ai.settings.description')}
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
          {t('ai.settings.enable')}
        </label>
      </div>

      <div className={aiRow}>
        <label className={aiLabel}>{t('ai.settings.providerPreset')}</label>
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
          <option value="">{t('ai.settings.custom')}</option>
          {Object.keys(DEFAULT_BASE_URLS).map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div className={aiRow}>
        <label className={aiLabel}>{t('ai.settings.baseUrl')}</label>
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
        <label className={aiLabel}>{t('ai.settings.model')}</label>
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
          {t('ai.settings.apiKey')} {config.hasApiKey && !apiKey && <span className={aiHint}>{t('ai.settings.stored')}</span>}
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
        <label className={aiLabel}>{t('ai.settings.permissionMode')}</label>
        <select
          className={s.mcpCopy}
          value={config.permission}
          onChange={(e) =>
            setConfig({ ...config, permission: e.target.value as PermissionMode })
          }
        >
          <option value="readConfirmWrite">{t('ai.settings.permReadWrite')}</option>
          <option value="readOnly">{t('ai.settings.permReadOnly')}</option>
          <option value="fullAuto">{t('ai.settings.permFullAuto')}</option>
        </select>
      </div>

      <div className={aiActions}>
        <button type="button" className={s.mcpCopy} onClick={test} disabled={testing}>
          {testing ? t('ai.settings.testing') : t('ai.settings.testConnection')}
        </button>
        <button type="button" className={styles.sendBtn} onClick={save}>
          {saved ? t('ai.settings.saved') : t('ai.settings.save')}
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
