/**
 * MCP / AI-integration panel — a self-contained block rendered inside the
 * Settings dialog. It surfaces the running k7s-web instance as a Model
 * Context Protocol endpoint, with three ready-to-paste configs (Claude
 * Desktop, Claude Code, Cursor) and a "copy" button on each.
 *
 * Why this lives in Settings (and not, say, a new top-level menu):
 * users who care about AI integration will find it next to the other
 * connection-shaped knobs (default namespace, shell command, etc.),
 * and the gear icon is already the obvious "configure this thing" entry
 * point. A standalone page would add a discoverability problem for
 * exactly the audience that doesn't know the feature exists.
 *
 * The MCP endpoint URL is `window.location.origin + "/mcp"`. The MCP
 * server is the *same* server you opened this UI in, on the same port,
 * via the `k7s-web` binary's `/mcp` route. So the URL the user sees
 * here is the URL they paste into the AI client.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import styles from './SettingsPanel.module.css';

/** Approximate count of MCP tools. Hard-coded for the hint copy; the
 *  real count is the source of truth in the Rust server. The point of
 *  this number is "a lot" — keeping it loosely accurate is fine. */
const TOOL_COUNT = 91;

export function McpPanel() {
  const { t } = useTranslation();
  // The MCP endpoint URL. Computed lazily on mount (window isn't
  // available during SSR; this is a Vite SPA so it's always there, but
  // being lazy keeps the component SSR-safe if we ever add it).
  const [url, setUrl] = useState<string>('…');
  useEffect(() => {
    setUrl(`${window.location.origin}/mcp`);
  }, []);

  // Three config blocks. Memoised so re-renders (e.g. when the user
  // toggles "copied!" feedback) don't regenerate the JSON string and
  // re-trigger every Copy button.
  const configs = useMemo(
    () => ({
      claudeDesktop: JSON.stringify(
        {
          mcpServers: {
            'k7s-local': {
              url,
            },
          },
        },
        null,
        2
      ),
      claudeCodeJson: JSON.stringify(
        {
          mcpServers: {
            'k7s-local': {
              url,
            },
          },
        },
        null,
        2
      ),
      claudeCodeCli: `claude mcp add k7s-local --transport http ${url}`,
      cursor: JSON.stringify(
        {
          mcpServers: {
            'k7s-local': {
              url,
            },
          },
        },
        null,
        2
      ),
    }),
    [url]
  );

  return (
    <div className={styles.mcpSection}>
      <div className={styles.mcpHeader}>
        <div className={styles.mcpHeaderText}>
          <div className={styles.mcpTitle}>
            {t('settings.mcp.sectionTitle')}
            <span className={styles.mcpBadge}>MCP</span>
          </div>
          <div className={styles.mcpHint}>
            {t('settings.mcp.sectionHint', url)}
            <br />
            {t('settings.mcp.tools', TOOL_COUNT)}
            <br />
            <span className={styles.mcpStdioNote}>{t('settings.mcp.stdioNote')}</span>
          </div>
        </div>
      </div>

      <div className={styles.mcpCards}>
        <McpCard
          title={t('settings.mcp.claudeDesktop.title')}
          hint={t('settings.mcp.claudeDesktop.hint')}
          configPath={t('settings.mcp.claudeDesktop.configPath')}
          code={configs.claudeDesktop}
          copyLabel={t('chrome.copy')}
          copiedLabel={t('chrome.copied')}
          failedLabel={t('chrome.copyFailed')}
        />

        <McpCard
          title={t('settings.mcp.claudeCode.title')}
          hint={t('settings.mcp.claudeCode.hint')}
          configPath={t('settings.mcp.claudeCode.configPath')}
          code={configs.claudeCodeJson}
          copyLabel={t('chrome.copy')}
          copiedLabel={t('chrome.copied')}
          failedLabel={t('chrome.copyFailed')}
          extraCode={configs.claudeCodeCli}
          extraLabel={t('settings.mcp.claudeCode.cliHint')}
        />

        <McpCard
          title={t('settings.mcp.cursor.title')}
          hint={t('settings.mcp.cursor.hint')}
          configPath={t('settings.mcp.cursor.configPath')}
          code={configs.cursor}
          copyLabel={t('chrome.copy')}
          copiedLabel={t('chrome.copied')}
          failedLabel={t('chrome.copyFailed')}
        />
      </div>
    </div>
  );
}

/** One config card: title, hint, file path, JSON code block, copy button. */
function McpCard({
  title,
  hint,
  configPath,
  code,
  copyLabel,
  copiedLabel,
  failedLabel,
  extraCode,
  extraLabel,
}: {
  title: string;
  hint: string;
  configPath: string;
  code: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
  /** Optional second copyable block (Claude Code shows the CLI form too). */
  extraCode?: string;
  extraLabel?: string;
}) {
  return (
    <div className={styles.mcpCard}>
      <div className={styles.mcpCardHeader}>
        <div>
          <div className={styles.mcpCardTitle}>{title}</div>
          <div className={styles.mcpCardHint}>{hint}</div>
          <div className={styles.mcpCardPath}>{configPath}</div>
        </div>
      </div>
      <pre className={styles.mcpCode}>
        <code>{code}</code>
        <CopyButton
          text={code}
          copyLabel={copyLabel}
          copiedLabel={copiedLabel}
          failedLabel={failedLabel}
        />
      </pre>
      {extraCode !== undefined && extraLabel !== undefined && (
        <>
          <div className={styles.mcpExtraLabel}>{extraLabel}</div>
          <pre className={styles.mcpCode}>
            <code>{extraCode}</code>
            <CopyButton
              text={extraCode}
              copyLabel={copyLabel}
              copiedLabel={copiedLabel}
              failedLabel={failedLabel}
            />
          </pre>
        </>
      )}
    </div>
  );
}

/**
 * Tiny "copy" button that uses the Clipboard API. We accept a fall-through
 * to a hidden `<textarea>` + `document.execCommand` for the rare browser
 * without async clipboard support, but the modern path handles everything
 * we ship to. Feedback lasts 1.5s; failure shows a permanent red label
 * so the user knows it didn't work.
 */
function CopyButton({
  text,
  copyLabel,
  copiedLabel,
  failedLabel,
}: {
  text: string;
  copyLabel: string;
  copiedLabel: string;
  failedLabel: string;
}) {
  // "idle" | "ok" | "err" — kept local; a 1.5s revert is enough.
  const [state, setState] = useState<'idle' | 'ok' | 'err'>('idle');
  const label = state === 'ok' ? copiedLabel : state === 'err' ? failedLabel : copyLabel;

  const onClick = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Last-resort fallback for very old WebView-based clients.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('execCommand copy returned false');
      }
      setState('ok');
    } catch {
      setState('err');
    } finally {
      // Reset feedback after a beat — long enough to read, short enough
      // that the user can hit copy again without an awkward delay.
      setTimeout(() => setState('idle'), 1500);
    }
  };

  return (
    <button
      type="button"
      className={
        state === 'err'
          ? `${styles.mcpCopy} ${styles.mcpCopyErr}`
          : state === 'ok'
            ? `${styles.mcpCopy} ${styles.mcpCopyOk}`
            : styles.mcpCopy
      }
      onClick={onClick}
      title={copyLabel}
    >
      {label}
    </button>
  );
}
