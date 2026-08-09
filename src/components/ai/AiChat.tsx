/**
 * AiChat — the redesigned AI assistant panel.
 *
 * Replaces AiAssistantPanel with a production-quality UX:
 * - Markdown rendering for assistant replies
 * - Collapsible tool call cards
 * - Context-sensitive quick actions
 * - Welcome guide for first-time users
 * - Status bar with model/connection/permission info
 * - Tab-less design: skills/memory/cron are accessible via header buttons
 *
 * Talks to the backend through the same Tauri commands as before.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../hooks/useI18n';
import { getProvider } from '../../providers';
import type {
  AgentEvent,
  AiConfigView,
  ChatMessage,
  ChatRequest,
  SelectedContext,
} from '../../lib/ai/types';
import { MarkdownMessage } from './MarkdownMessage';
import { ToolCallCard } from './ToolCallCard';
import { QuickActions } from './QuickActions';
import { AiWelcome } from './AiWelcome';
import { AiStatusBar } from './AiStatusBar';
import { SkillsPanel } from './SkillsPanel';
import { MemoryPanel } from './MemoryPanel';
import { CronPanel } from './CronPanel';
import styles from './AiChat.module.css';

type Tab = 'chat' | 'skills' | 'memory' | 'cron';

/** One renderable transcript row. */
type Row =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | {
      kind: 'tool';
      callId: string;
      name: string;
      args: unknown;
      isWrite: boolean;
      state: 'running' | 'ok' | 'err' | 'pending' | 'denied';
      result?: unknown;
    }
  | { kind: 'error'; text: string };

interface Props {
  selectedContext?: SelectedContext;
  onClose?: () => void;
}

export function AiChat({ selectedContext, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [tab, setTab] = useState<Tab>('chat');
  const [activeSkillId, setActiveSkillId] = useState<string | undefined>();
  const [kubeContext, setKubeContext] = useState('');
  const [config, setConfig] = useState<AiConfigView | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { t } = useTranslation();

  // Load config + context on mount.
  useEffect(() => {
    getProvider().aiGetConfig().then(setConfig).catch(() => {});
    getProvider().aiGetContext().then((ctx) => { if (ctx) setKubeContext(ctx); }).catch(() => {});
  }, []);

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [rows]);

  // Subscribe to ai_event while a run is active.
  // Uses Tauri listen in desktop mode, SSE EventSource in web mode.
  useEffect(() => {
    if (!runId) return;
    let cleanup: (() => void) | null = null;
    const handler = (ev: AgentEvent) => {
      const envelope = ev as unknown as { runId?: string; event?: AgentEvent };
      // The event payload might be the envelope or the event directly.
      const event = envelope.event ?? (ev as AgentEvent);
      const evRunId = envelope.runId ?? runId;
      if (evRunId !== runId) return;
      handleEvent(event);
    };

    // Check if we're in Tauri mode.
    const isTauri = '__TAURI__' in window;
    if (isTauri) {
      // Dynamic import to avoid bundling Tauri API in web builds.
      import('@tauri-apps/api/event').then(({ listen }) => {
        let unlistenFn: (() => void) | null = null;
        void listen<{ runId: string; event: AgentEvent }>('ai_event', (e) => {
          if (e.payload.runId !== runId) return;
          handleEvent(e.payload.event);
        }).then((fn) => { unlistenFn = fn; });
        cleanup = () => { unlistenFn?.(); };
      });
    } else {
      // Web mode: subscribe to SSE events.
      const es = new EventSource('/api/events');
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.name === 'ai_event') {
            handler(data.data);
          }
        } catch { /* ignore parse errors */ }
      };
      cleanup = () => { es.close(); };
    }
    return () => { cleanup?.(); };
  }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps

  function pushRow(r: Row) { setRows((prev) => [...prev, r]); }

  function updateToolRow(callId: string, patch: Partial<Extract<Row, { kind: 'tool' }>>) {
    setRows((prev) =>
      prev.map((r) => (r.kind === 'tool' && r.callId === callId ? { ...r, ...patch } : r))
    );
  }

  function handleEvent(ev: AgentEvent) {
    switch (ev.type) {
      case 'textDelta':
        setRows((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === 'assistant') {
            return [...prev.slice(0, -1), { kind: 'assistant', text: last.text + ev.text }];
          }
          return [...prev, { kind: 'assistant', text: ev.text }];
        });
        break;
      case 'toolCall':
        pushRow({ kind: 'tool', callId: ev.callId, name: ev.name, args: ev.arguments, isWrite: ev.isWrite, state: ev.isWrite ? 'pending' : 'running' });
        break;
      case 'pendingApproval':
        updateToolRow(ev.callId, { state: 'pending' });
        break;
      case 'toolResult':
        updateToolRow(ev.callId, { state: ev.ok ? 'ok' : 'err', result: ev.result });
        break;
      case 'done':
        setHistory(ev.history);
        setBusy(false);
        setRunId(null);
        break;
      case 'error':
        pushRow({ kind: 'error', text: ev.message });
        setBusy(false);
        setRunId(null);
        break;
    }
  }

  async function send(text?: string) {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');
    pushRow({ kind: 'user', text: msg });
    setBusy(true);
    setTab('chat'); // switch to chat tab when sending
    const req: ChatRequest = {
      message: msg,
      history,
      context: selectedContext,
      skillId: activeSkillId,
      kubeContext: kubeContext || undefined,
    };
    try {
      const id = await getProvider().aiChat(req);
      setRunId(id);
    } catch (e) {
      pushRow({ kind: 'error', text: String(e) });
      setBusy(false);
    }
  }

  async function cancel() {
    if (!runId) return;
    try { await getProvider().aiCancel(runId); } catch { /* ignore */ }
  }

  async function approve(callId: string, approved: boolean) {
    if (!runId) return;
    updateToolRow(callId, { state: approved ? 'running' : 'denied' });
    try { await getProvider().aiApproveToolCall(runId, callId, approved); } catch (e) { pushRow({ kind: 'error', text: String(e) }); }
  }

  function newChat() {
    setRows([]);
    setHistory([]);
    setRunId(null);
    setBusy(false);
    setActiveSkillId(undefined);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  }

  const onSkillSelect = (id: string | undefined) => {
    setActiveSkillId(id);
    setTab('chat');
  };

  const aiEnabled = config?.enabled ?? false;

  return (
    <div className={styles.panel} data-surface="panel">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>{t('ai.chat.title')}</span>
          {activeSkillId && (
            <span className={styles.skillBadge}>{activeSkillId}</span>
          )}
        </div>
        <div className={styles.headerRight}>
          {([
            ['chat', t('ai.chat.tabChat')],
            ['skills', t('ai.chat.tabSkills')],
            ['memory', t('ai.chat.tabMemory')],
            ['cron', t('ai.chat.tabCron')],
          ] as [Tab, string][]).map(([tabId, label]) => (
            <button
              key={tabId}
              type="button"
              className={tab === tabId ? styles.headerTabActive : styles.headerTab}
              onClick={() => setTab(tabId)}
              title={label}
            >
              {label}
            </button>
          ))}
          {tab === 'chat' && rows.length > 0 && (
            <button type="button" className={styles.headerTab} onClick={newChat} title={t('ai.chat.newConversation')}>
              🔄
            </button>
          )}
          {onClose && (
            <button type="button" className={styles.headerTab} onClick={onClose} title={t('ai.chat.close')}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content area — switchable tabs */}
      {tab === 'skills' && <SkillsPanel activeId={activeSkillId} onSelect={onSkillSelect} />}
      {tab === 'memory' && <MemoryPanel kubeContext={kubeContext} />}
      {tab === 'cron' && <CronPanel />}

      {/* Chat tab */}
      {tab === 'chat' && (
        <>
          {/* Quick actions */}
          {!busy && <QuickActions selectedContext={selectedContext} onAction={send} disabled={busy || !aiEnabled} />}

          {/* Messages */}
          <div className={styles.body} ref={scrollRef}>
            {rows.length === 0 && (
              <AiWelcome onExampleClick={send} aiEnabled={aiEnabled} />
            )}
            {rows.map((row, i) => {
              if (row.kind === 'user') {
                return (
                  <div key={i} className={styles.userMsg}>
                    <div className={styles.userLabel}>{t('ai.chat.you')}</div>
                    {row.text}
                  </div>
                );
              }
              if (row.kind === 'assistant') {
                return (
                  <div key={i} className={styles.assistantMsg}>
                    <div className={styles.assistantLabel}>{t('ai.chat.assistant')}</div>
                    <MarkdownMessage content={row.text} />
                  </div>
                );
              }
              if (row.kind === 'error') {
                return (
                  <div key={i} className={styles.errorMsg}>
                    <span className={styles.errorIcon}>⚠</span>
                    {row.text}
                  </div>
                );
              }
              return (
                <ToolCallCard
                  key={i}
                  name={row.name}
                  args={row.args}
                  isWrite={row.isWrite}
                  state={row.state}
                  result={row.result}
                  onApprove={row.state === 'pending' ? (ap) => approve(row.callId, ap) : undefined}
                />
              );
            })}
            {busy && !rows.some((r) => r.kind === 'assistant') && (
              <div className={styles.thinking}>
                <span className={styles.thinkingDot} />
                <span className={styles.thinkingDot} />
                <span className={styles.thinkingDot} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className={styles.inputArea}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={input}
              placeholder={aiEnabled ? t('ai.chat.placeholder') : t('ai.chat.placeholderDisabled')}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy || !aiEnabled}
            />
            <div className={styles.inputActions}>
              {busy ? (
                <button type="button" className={styles.stopBtn} onClick={cancel}>
                  {t('ai.chat.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.sendBtn}
                  onClick={() => send()}
                  disabled={!input.trim() || !aiEnabled}
                >
                  ➤
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Status bar */}
      <AiStatusBar config={config} connected={!!kubeContext} contextName={kubeContext} />
    </div>
  );
}
