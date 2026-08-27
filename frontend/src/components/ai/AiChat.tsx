/**
 * AiChat — the AI assistant panel with proper turn grouping and history collapsing.
 *
 * Key design decisions:
 * - Messages are grouped into "turns" (user msg + reasoning + tool calls + response).
 * - Current turn's tool calls are expanded; past turns' are collapsed.
 * - Context badges are shown inline (not as separate rows).
 * - History stored in backend includes tool results; displayed version strips them.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { getProvider } from '../../providers';
import { apiHeaders } from '../../providers/transport';
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
import { pollAiRun } from './pollAiRun';
import { AiStatusBar } from './AiStatusBar';
import { SkillsPanel } from './SkillsPanel';
import { MemoryPanel } from './MemoryPanel';
import { CronPanel } from './CronPanel';
import { useTranslation } from '../../hooks/useI18n';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useStore } from '../../store';
import { ReasoningBlock } from './ReasoningBlock';
import { ContextBadge } from './ContextBadge';
import styles from './AiChat.module.css';

type Tab = 'chat' | 'skills' | 'memory' | 'cron';

// ── Row types ──────────────────────────────────────────────────────────

interface UserRow { kind: 'user'; text: string }
interface AssistantRow { kind: 'assistant'; text: string }
interface ReasoningRow { kind: 'reasoning'; text: string }
interface ContextRow { kind: 'context'; blockType: string; summary: string }
interface ToolRow {
  kind: 'tool';
  callId: string;
  name: string;
  args: unknown;
  isWrite: boolean;
  state: 'running' | 'ok' | 'err' | 'pending' | 'denied';
  result?: unknown;
}
interface ErrorRow { kind: 'error'; text: string }

type Row = UserRow | AssistantRow | ReasoningRow | ContextRow | ToolRow | ErrorRow;

// ── Component ──────────────────────────────────────────────────────────

interface Props {
  selectedContext?: SelectedContext;
  onClose?: () => void;
}

export function AiChat({ selectedContext, onClose }: Props) {
  const { t } = useTranslation();
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const [rows, setRows] = useState<Row[]>([]);
  const [turnBoundaries, setTurnBoundaries] = useState<number[]>([0]); // indices where turns start
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
  // Overflow menu for the advanced AI tabs (Skills/Memory/Cron) — kept folded
  // behind a "⋯" so the default header shows only Chat, lowering the first-use
  // cognitive load. The three tabs are advanced Agent concepts most users never
  // touch; they remain one click away.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  useClickOutside(overflowRef, () => setOverflowOpen(false), overflowOpen);

  // Load config + context on mount.
  useEffect(() => {
    getProvider().aiGetConfig().then(setConfig).catch(() => {});
    getProvider()
      .aiGetContext()
      .then((ctx) => {
        if (ctx) setKubeContext(ctx);
      })
      .catch(() => {});
  }, []);

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [rows]);

  // Consume a pending message set by another component (e.g. "Explain YAML").
  const aiPendingMessage = useStore((s) => s.aiPendingMessage);
  const setAiPendingMessage = useStore((s) => s.setAiPendingMessage);
  useEffect(() => {
    if (aiPendingMessage && !busy) {
      const msg = aiPendingMessage;
      setAiPendingMessage(undefined);
      void send(msg);
    }
    // Only fire when the pending message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPendingMessage]);

  // Active run tracking.
  const activeRunId = useRef<string | null>(null);
  const processEventRef = useRef(processEvent);
  processEventRef.current = processEvent;
  // Set to true on unmount so the poll loop in send() stops itself instead of
  // continuing to fire requests and setState on a gone component.
  const pollCancelRef = useRef(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      pollCancelRef.current = true;
      pollAbortRef.current?.abort();
    };
  }, []);

  // No persistent SSE subscription — a per-run EventSource is created in
  // the send() function to avoid connection-limit issues with the
  // SharedEventBus and stale closure problems.

  const pushRow = useCallback((r: Row) => {
    setRows((prev) => [...prev, r]);
  }, []);

  const updateToolRow = useCallback(
    (callId: string, patch: Partial<ToolRow>) => {
      setRows((prev) =>
        prev.map((r) =>
          r.kind === 'tool' && r.callId === callId ? { ...r, ...patch } : r
        )
      );
    },
    []
  );

  function processEvent(ev: AgentEvent) {
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
      case 'reasoningDelta':
        setRows((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === 'reasoning') {
            return [...prev.slice(0, -1), { kind: 'reasoning', text: last.text + ev.text }];
          }
          return [...prev, { kind: 'reasoning', text: ev.text }];
        });
        break;
      case 'contextInjected':
        pushRow({ kind: 'context', blockType: ev.blockType, summary: ev.summary });
        break;
      case 'toolCall':
        pushRow({
          kind: 'tool',
          callId: ev.callId,
          name: ev.name,
          args: ev.arguments,
          isWrite: ev.isWrite,
          state: ev.isWrite ? 'pending' : 'running',
        });
        break;
      case 'pendingApproval':
        updateToolRow(ev.callId, { state: 'pending' });
        break;
      case 'toolResult':
        updateToolRow(ev.callId, { state: ev.ok ? 'ok' : 'err', result: ev.result });
        break;
      case 'done':
        // Push the final assistant message if the backend sent one and we
        // don't already have an assistant row (common when the LLM returns
        // empty content after tool calls — the backend constructs a fallback).
        if (ev.finalMessage) {
          setRows((prev) => {
            const hasAssistant = prev.some((r) => r.kind === 'assistant');
            if (hasAssistant) return prev;
            return [...prev, { kind: 'assistant', text: ev.finalMessage! }];
          });
        }
        setHistory(ev.history);
        setBusy(false);
        activeRunId.current = null;
        setRunId(null);
        break;
      case 'error':
        pushRow({ kind: 'error', text: ev.message });
        setBusy(false);
        activeRunId.current = null;
        setRunId(null);
        break;
    }
  }

  async function send(text?: string) {
    const msg = (text || input).trim();
    if (!msg || busy) return;
    setInput('');
    // Record turn boundary (index of the user message we're about to push).
    setTurnBoundaries((prev) => [...prev, rows.length]);
    pushRow({ kind: 'user', text: msg });
    setBusy(true);
    setTab('chat');
    const req: ChatRequest = {
      message: msg,
      history,
      context: selectedContext,
      skillId: activeSkillId,
      kubeContext: kubeContext || undefined,
    };
    try {
      const id = await getProvider().aiChat(req);
      activeRunId.current = id;
      setRunId(id);
      // Poll for events instead of SSE (avoids browser connection-limit issues).
      // The loop and its error contract live in pollAiRun (tested there):
      // ok:false and N consecutive failures both push an error row and clear
      // the busy/runId state, so a lost run can no longer wedge the panel.
      pollCancelRef.current = false;
      void pollAiRun(id, {
        fetchImpl: fetch,
        headers: apiHeaders,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        isCancelled: () => pollCancelRef.current,
        // One AbortController per iteration so an in-flight request is
        // cancelled when the component unmounts (pollAbortRef.abort() in
        // the cleanup effect).
        signalFor: () => {
          const ac = new AbortController();
          pollAbortRef.current = ac;
          return ac.signal;
        },
        onEvent: (ev) => processEventRef.current(ev),
        onError: (message) => pushRow({ kind: 'error', text: message }),
        onFinish: () => {
          setBusy(false);
          activeRunId.current = null;
          setRunId(null);
        },
      });
    } catch (e) {
      pushRow({ kind: 'error', text: String(e) });
      setBusy(false);
    }
  }

  async function cancel() {
    if (!runId) return;
    try {
      await getProvider().aiCancel(runId);
    } catch {
      /* ignore */
    }
  }

  async function approve(callId: string, approved: boolean) {
    if (!runId) return;
    updateToolRow(callId, { state: approved ? 'running' : 'denied' });
    try {
      await getProvider().aiApproveToolCall(runId, callId, approved);
    } catch (e) {
      pushRow({ kind: 'error', text: String(e) });
    }
  }

  function newChat() {
    setRows([]);
    setTurnBoundaries([0]);
    setHistory([]);
    setRunId(null);
    setBusy(false);
    setActiveSkillId(undefined);
    inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const onSkillSelect = (id: string | undefined) => {
    setActiveSkillId(id);
    setTab('chat');
  };

  const aiEnabled = config?.enabled ?? false;

  // Determine which turn is "current" (the last one).
  const currentTurnStart = turnBoundaries.length > 0 ? turnBoundaries[turnBoundaries.length - 1] : 0;

  return (
    <div className={styles.panel} data-surface="panel">
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>{t('ai.chat.title')}</span>
          {activeSkillId && <span className={styles.skillBadge}>{activeSkillId}</span>}
        </div>
        <div className={styles.headerRight}>
          {/* Chat is the primary tab — always visible. */}
          <button
            type="button"
            className={tab === 'chat' ? styles.headerTabActive : styles.headerTab}
            onClick={() => setTab('chat')}
            title={t('ai.chat.tabChat')}
          >
            {t('ai.chat.tabChat')}
          </button>
          {/* Skills / Memory / Cron — advanced Agent tabs, folded behind "⋯". */}
          <div className={styles.overflowWrap} ref={overflowRef}>
            <button
              type="button"
              className={
                tab !== 'chat' ? styles.headerTabActive : styles.headerTab
              }
              onClick={() => setOverflowOpen((o) => !o)}
              title={t('ai.chat.moreTabs')}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
            >
              ⋯
            </button>
            {overflowOpen && (
              <div className={styles.overflowMenu} role="menu">
                {(
                  [
                    ['skills', t('ai.chat.tabSkills')],
                    ['memory', t('ai.chat.tabMemory')],
                    ['cron', t('ai.chat.tabCron')],
                  ] as [Tab, string][]
                ).map(([tabId, label]) => (
                  <button
                    key={tabId}
                    type="button"
                    role="menuitemradio"
                    aria-checked={tab === tabId}
                    className={`${styles.overflowRow} ${tab === tabId ? styles.overflowRowSelected : ''}`}
                    onClick={() => {
                      setTab(tabId);
                      setOverflowOpen(false);
                    }}
                  >
                    <span className={styles.overflowCheck}>{tab === tabId ? '✓' : ''}</span>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
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

      {/* Content area */}
      {tab === 'skills' && <SkillsPanel activeId={activeSkillId} onSelect={onSkillSelect} />}
      {tab === 'memory' && <MemoryPanel kubeContext={kubeContext} />}
      {tab === 'cron' && <CronPanel />}

      {/* Chat tab */}
      {tab === 'chat' && (
        <>
          {!busy && (
            <QuickActions
              selectedContext={selectedContext}
              onAction={send}
              disabled={busy || !aiEnabled}
            />
          )}

          <div className={styles.body} ref={scrollRef}>
            {rows.length === 0 && (
              <AiWelcome onExampleClick={send} aiEnabled={aiEnabled} />
            )}
            {rows.map((row, i) => {
              const isCurrentTurn = i >= currentTurnStart;

              if (row.kind === 'user') {
                return (
                  <div key={i} className={styles.userMsg}>
                    <div className={styles.userLabel}>{t('ai.chat.you')}</div>
                    {row.text}
                  </div>
                );
              }

              if (row.kind === 'context') {
                // Only show context badges for the current turn — past turns
                // have the same context and don't need to repeat it.
                if (!isCurrentTurn) return null;
                return <ContextBadge key={i} blockType={row.blockType} summary={row.summary} />;
              }

              if (row.kind === 'reasoning') {
                // Past turns: always collapsed. Current turn: collapsed by default.
                return <ReasoningBlock key={i} text={row.text} defaultExpanded={false} />;
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

              // Tool call card.
              return (
                <ToolCallCard
                  key={i}
                  name={row.name}
                  args={row.args}
                  isWrite={row.isWrite}
                  state={row.state}
                  result={row.result}
                  // Past turns: collapsed. Current turn pending: expanded.
                  defaultExpanded={isCurrentTurn && row.state === 'pending'}
                  onApprove={
                    row.state === 'pending'
                      ? (ap) => approve(row.callId, ap)
                      : undefined
                  }
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

          {/* When AI is disabled, surface a one-click path to the config rather
              than leaving the user to find the settings gear themselves. */}
          {!aiEnabled && (
            <button
              type="button"
              className={styles.enableHint}
              onClick={() => setSettingsOpen(true, 'ai')}
            >
              ⚙️ {t('ai.welcome.openSettings')}
            </button>
          )}

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

      <AiStatusBar config={config} connected={!!kubeContext} contextName={kubeContext} />
    </div>
  );
}

// Sub-components extracted to separate files:
// - ReasoningBlock: ./ReasoningBlock.tsx
// - ContextBadge: ./ContextBadge.tsx
