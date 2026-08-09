/**
 * AiAssistantPanel — the in-app chat sidebar for the built-in k7s AI.
 *
 * Renders a scrolling transcript of user/assistant messages interleaved with
 * ToolCallCard entries, an input box, and pending-approval prompts. It talks
 * to the backend exclusively through Tauri commands (`ai_chat`, `ai_cancel`,
 * `ai_approve_tool_call`) and the `ai_event` stream.
 *
 * The panel is self-contained: it owns its own message/tool-call state and the
 * active run id. A `selectedContext` prop lets the parent (the resource table)
 * inject the currently-focused resource so the AI sees it without the user
 * re-typing the name.
 */
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AgentEvent,
  AiConfigView,
  ChatMessage,
  ChatRequest,
  OutgoingToolCall,
  SelectedContext,
} from '../../lib/ai/types';
import { SkillsPanel } from './SkillsPanel';
import { MemoryPanel } from './MemoryPanel';
import { CronPanel } from './CronPanel';
import styles from './AiAssistantPanel.module.css';

type Tab = 'chat' | 'skills' | 'memory' | 'cron';

/** One renderable transcript row. */
type Row =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; callId: string; name: string; args: unknown; isWrite: boolean; state: 'running' | 'ok' | 'err' | 'pending' | 'denied'; result?: unknown }
  | { kind: 'error'; text: string };

interface Props {
  /** Focused resource, injected as implicit context for the next message. */
  selectedContext?: SelectedContext;
  /** Called when the user clicks the close button. */
  onClose?: () => void;
}

export function AiAssistantPanel({ selectedContext, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [input, setInput] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The rolling chat history the backend expects back each turn. We rebuild it
  // from rows isn't safe (text deltas are incremental), so we keep it separate.
  const [history, setHistory] = useState<ChatMessage[]>([]);
  // The in-progress assistant text, accumulated from textDelta events.
  const pendingText = useRef<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tab switching: chat | skills | memory.
  const [tab, setTab] = useState<Tab>('chat');
  // Active skill (injected into the next chat message).
  const [activeSkillId, setActiveSkillId] = useState<string | undefined>();
  // Current kubeconfig context (for memory scoping).
  const [kubeContext, _setKubeContext] = useState<string>('');
  useEffect(() => {
    // Fetch the current context from the connection info.
    invoke<{ context: string }>('ai_get_config')
      .then(() => {
        // We don't have a direct command for connection info; use the
        // connection_info method via a lightweight approach.
        // For now, leave kubeContext empty until the user is connected.
      })
      .catch(() => {});
  }, []);

  // Auto-scroll to the bottom when new rows / deltas arrive.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [rows]);

  // Subscribe to ai_event while a run is active.
  useEffect(() => {
    if (!runId) return;
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;
    void listen<{ runId: string; event: AgentEvent }>('ai_event', (e) => {
      const { runId: evRun, event: ev } = e.payload;
      if (evRun !== runId) return; // another run's event
      handleEvent(ev);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  function pushRow(r: Row) {
    setRows((prev) => [...prev, r]);
  }

  function updateToolRow(callId: string, patch: Partial<Extract<Row, { kind: 'tool' }>>) {
    setRows((prev) =>
      prev.map((row) =>
        row.kind === 'tool' && row.callId === callId ? { ...row, ...patch } : row
      )
    );
  }

  function handleEvent(ev: AgentEvent) {
    switch (ev.type) {
      case 'textDelta': {
        pendingText.current += ev.text;
        // Fold into the last assistant row, or create one.
        setRows((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === 'assistant') {
            return [...prev.slice(0, -1), { kind: 'assistant', text: last.text + ev.text }];
          }
          return [...prev, { kind: 'assistant', text: ev.text }];
        });
        break;
      }
      case 'toolCall': {
        // Freeze the pending assistant text into history before the tool runs.
        flushPendingAssistant();
        pushRow({
          kind: 'tool',
          callId: ev.callId,
          name: ev.name,
          args: ev.arguments,
          isWrite: ev.isWrite,
          state: ev.isWrite ? 'pending' : 'running',
        });
        break;
      }
      case 'pendingApproval': {
        updateToolRow(ev.callId, { state: 'pending' });
        break;
      }
      case 'toolResult': {
        updateToolRow(ev.callId, {
          state: ev.ok ? 'ok' : 'err',
          result: ev.result,
        });
        break;
      }
      case 'done': {
        flushPendingAssistant();
        setHistory(ev.history);
        setBusy(false);
        setRunId(null);
        pendingText.current = '';
        break;
      }
      case 'error': {
        pushRow({ kind: 'error', text: ev.message });
        setBusy(false);
        setRunId(null);
        pendingText.current = '';
        break;
      }
    }
  }

  /** Commit any accumulated assistant text into the transcript + history. */
  function flushPendingAssistant() {
    if (!pendingText.current) return;
    pendingText.current = '';
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    pushRow({ kind: 'user', text });
    setBusy(true);
    pendingText.current = '';
    const req: ChatRequest = {
      message: text,
      history,
      context: selectedContext,
      skillId: activeSkillId,
      kubeContext: kubeContext || undefined,
    };
    try {
      const id = await invoke<string>('ai_chat', { request: req });
      setRunId(id);
    } catch (e) {
      pushRow({ kind: 'error', text: String(e) });
      setBusy(false);
    }
  }

  async function cancel() {
    if (!runId) return;
    try {
      await invoke('ai_cancel', { runId });
    } catch {
      // Ignore — the run will end on its own.
    }
  }

  async function approve(callId: string, approved: boolean) {
    if (!runId) return;
    updateToolRow(callId, { state: approved ? 'running' : 'denied' });
    try {
      await invoke('ai_approve_tool_call', { runId, callId, approved });
    } catch (e) {
      pushRow({ kind: 'error', text: String(e) });
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onSkillSelect = (id: string | undefined) => {
    setActiveSkillId(id);
    setTab('chat');
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['chat', 'skills', 'memory', 'cron'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={tab === t ? styles.title : styles.close}
              onClick={() => setTab(t)}
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                textTransform: 'capitalize',
                fontSize: 12,
                padding: '2px 4px',
              }}
            >
              {t === 'chat' ? '✦ Chat' : t === 'skills' ? '⚡ Skills' : t === 'memory' ? '🧠 Memory' : '⏰ Cron'}
              {t === 'chat' && activeSkillId && (
                <span style={{ color: 'var(--ok, #22c55e)', marginLeft: 4 }}>●</span>
              )}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      {tab === 'skills' && <SkillsPanel activeId={activeSkillId} onSelect={onSkillSelect} />}
      {tab === 'memory' && <MemoryPanel kubeContext={kubeContext} />}
      {tab === 'cron' && <CronPanel />}
      {tab === 'chat' && (
      <>
      <div className={styles.body} ref={scrollRef}>
        {rows.length === 0 && (
          <div className={styles.empty}>
            Ask anything about your cluster. Try:
            <ul>
              <li>“list pods in default”</li>
              <li>“what's wrong with the frontend namespace?”</li>
              <li>“scale payments to 3 replicas”</li>
            </ul>
            Write operations ask for confirmation before running.
          </div>
        )}
        {rows.map((row, i) => {
          if (row.kind === 'user') {
            return (
              <div key={i} className={styles.userMsg}>
                {row.text}
              </div>
            );
          }
          if (row.kind === 'assistant') {
            return (
              <div key={i} className={styles.assistantMsg}>
                {row.text}
              </div>
            );
          }
          if (row.kind === 'error') {
            return (
              <div key={i} className={styles.errorMsg}>
                ⚠ {row.text}
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
        {busy && !rows.some((r) => r.kind === 'assistant' && r.text) && (
          <div className={styles.thinking}>thinking…</div>
        )}
      </div>
      <div className={styles.inputBar}>
        <textarea
          className={styles.input}
          value={input}
          placeholder="Ask the AI…"
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {busy ? (
          <button type="button" className={styles.stopBtn} onClick={cancel}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className={styles.sendBtn}
            onClick={send}
            disabled={!input.trim()}
          >
            Send
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}

/** A tool call rendered as a compact card with optional approval buttons. */
function ToolCallCard({
  name,
  args,
  isWrite,
  state,
  result,
  onApprove,
}: {
  name: string;
  args: unknown;
  isWrite: boolean;
  state: 'running' | 'ok' | 'err' | 'pending' | 'denied';
  result?: unknown;
  onApprove?: (approved: boolean) => void;
}) {
  const stateLabel = {
    running: 'running',
    ok: 'done',
    err: 'failed',
    pending: 'awaiting approval',
    denied: 'denied',
  }[state];
  return (
    <div className={`${styles.toolCard} ${styles[`tool_${state}`]}`}>
      <div className={styles.toolHeader}>
        <span className={styles.toolIcon}>{isWrite ? '✎' : '👁'}</span>
        <span className={styles.toolName}>{name}</span>
        <span className={styles.toolState}>{stateLabel}</span>
      </div>
      <pre className={styles.toolArgs}>{JSON.stringify(args, null, 2)}</pre>
      {state === 'pending' && onApprove && (
        <div className={styles.approvalBar}>
          <button
            type="button"
            className={styles.approveBtn}
            onClick={() => onApprove(true)}
          >
            Approve
          </button>
          <button
            type="button"
            className={styles.denyBtn}
            onClick={() => onApprove(false)}
          >
            Deny
          </button>
        </div>
      )}
      {result !== undefined && (
        <pre className={styles.toolResult}>{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

// Re-export for the settings panel to load config.
export type { AiConfigView, OutgoingToolCall };
