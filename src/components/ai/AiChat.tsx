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

  // Persistent SSE subscription — one EventSource for the lifetime of the
  // component. Events are filtered by the current runId via a ref so we
  // never miss events due to React's async rendering.
  const activeRunId = useRef<string | null>(null);

  useEffect(() => {
    const isTauri = '__TAURI__' in window;
    if (isTauri) {
      let unlistenFn: (() => void) | null = null;
      import('@tauri-apps/api/event').then(({ listen }) => {
        void listen<{ runId: string; event: AgentEvent }>('ai_event', (e) => {
          if (e.payload.runId !== activeRunId.current) return;
          processEvent(e.payload.event);
        }).then((fn) => { unlistenFn = fn; });
      });
      return () => { unlistenFn?.(); };
    } else {
      // Web mode: use fetch+ReadableStream (same as SharedEventBus) to avoid
      // EventSource connection issues with many concurrent SSE streams.
      const controller = new AbortController();
      void (async () => {
        try {
          const res = await fetch('/api/events', { signal: controller.signal });
          if (!res.ok || !res.body) return;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          let currentEvent: string | null = null;
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nl).replace(/\r$/, '');
              buf = buf.slice(nl + 1);
              if (line === '') {
                currentEvent = null;
              } else if (line.startsWith('event: ')) {
                currentEvent = line.slice(7);
              } else if (line.startsWith('data: ') && currentEvent === 'ai_event') {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.runId === activeRunId.current) {
                    processEvent(data.event);
                  }
                } catch { /* ignore */ }
              }
            }
          }
        } catch (e) {
          if ((e as Error).name !== 'AbortError') console.warn('[AI] SSE error:', e);
        }
      })();
      return () => { controller.abort(); };
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Set the active runId on the ref FIRST so the persistent SSE listener
      // starts accepting events for this run immediately. Then update state
      // to trigger re-render (for the stop button etc.).
      activeRunId.current = id;
      setRunId(id);
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
          <span className={styles.headerTitle}>✦ k7s AI</span>
          {activeSkillId && <span className={styles.skillBadge}>{activeSkillId}</span>}
        </div>
        <div className={styles.headerRight}>
          {([['chat', '💬 Chat'], ['skills', '⚡ Skills'], ['memory', '🧠 Memory'], ['cron', '⏰ Cron']] as [Tab, string][]).map(
            ([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                className={tab === tabId ? styles.headerTabActive : styles.headerTab}
                onClick={() => setTab(tabId)}
                title={label}
              >
                {label}
              </button>
            )
          )}
          {tab === 'chat' && rows.length > 0 && (
            <button type="button" className={styles.headerTab} onClick={newChat} title="New conversation">
              🔄
            </button>
          )}
          {onClose && (
            <button type="button" className={styles.headerTab} onClick={onClose} title="Close">
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
                    <div className={styles.userLabel}>You</div>
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
                    <div className={styles.assistantLabel}>✦ k7s AI</div>
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

          {/* Input */}
          <div className={styles.inputArea}>
            <textarea
              ref={inputRef}
              className={styles.input}
              value={input}
              placeholder={aiEnabled ? 'Ask anything about your cluster…' : 'Enable AI in Settings first…'}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy || !aiEnabled}
            />
            <div className={styles.inputActions}>
              {busy ? (
                <button type="button" className={styles.stopBtn} onClick={cancel}>
                  Stop
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

// ── Sub-components ──────────────────────────────────────────────────────

/** Collapsible reasoning block. */
function ReasoningBlock({
  text,
  defaultExpanded = false,
}: {
  text: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className={styles.reasoningBlock}>
      <button
        type="button"
        className={styles.reasoningToggle}
        onClick={() => setExpanded(!expanded)}
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>💭 AI thinking</span>
        <span className={styles.reasoningLen}>{text.length} chars</span>
      </button>
      {expanded && <div className={styles.reasoningContent}>{text}</div>}
    </div>
  );
}

/** Context injection badge. */
function ContextBadge({
  blockType,
  summary,
}: {
  blockType: string;
  summary: string;
}) {
  const icons: Record<string, string> = {
    skill: '⚡',
    memory: '🧠',
    evolution: '📈',
    sandbox: '🔒',
    preferences: '⚙️',
  };
  return (
    <div className={styles.contextBadge}>
      <span>{icons[blockType] || '📋'}</span>
      <span>{summary}</span>
    </div>
  );
}
