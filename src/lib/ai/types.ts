/**
 * Types for the built-in AI assistant, mirroring the Rust `ai` module's wire
 * shapes (see src-tauri/src/ai/). These are the payloads that cross the Tauri
 * command boundary and the `ai_event` stream.
 */

/** Permission modes — matches `PermissionMode` in `ai/config.rs`. */
export type PermissionMode = 'readOnly' | 'readConfirmWrite' | 'fullAuto';

/** Non-secret LLM provider config. */
export interface LlmProviderConfig {
  baseUrl: string;
  model: string;
  temperature?: number;
}

/** The whole persisted AI config (the api_key is never sent to the UI). */
export interface AiConfig {
  enabled: boolean;
  provider: LlmProviderConfig;
  permission: PermissionMode;
  maxTurns: number;
}

/** What `ai_get_config` returns: config + a flag for whether a key is stored. */
export interface AiConfigView extends AiConfig {
  hasApiKey: boolean;
}

/** A resource the UI has focused, attached to a chat for implicit context. */
export interface SelectedContext {
  kind?: string;
  namespace?: string;
  name?: string;
}

/** Chat-history message — matches `Message` in `ai/llm/mod.rs`. */
export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content?: string;
      toolCalls?: OutgoingToolCall[];
    }
  | { role: 'tool'; toolCallId: string; content: string };

export interface OutgoingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** The request body for `ai_chat`. */
export interface ChatRequest {
  message: string;
  history: ChatMessage[];
  context?: SelectedContext;
  /** Run with a specific skill active (injects prompt + filters tools). */
  skillId?: string;
  /** Kubeconfig context name (used to scope memory). */
  kubeContext?: string;
}

/** A k8s skill — matches `Skill` in `ai/skills/mod.rs`. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  systemPromptSuffix: string;
  toolWhitelist: string[];
  examples: { user: string; assistant: string }[];
  category: string;
}

/** Memory tier — matches `Tier` in `ai/memory.rs`. */
export type MemoryTier = 'shortTerm' | 'longTerm' | 'knowledgeVault';

/** A memory entry — matches `MemoryEntry` in `ai/memory.rs`. */
export interface MemoryEntry {
  id: string;
  tier: MemoryTier;
  createdAt: string;
  content: string;
  tags: string[];
  source: 'user' | 'ai';
  referenceCount: number;
  promoteAt: number;
}

/** A user preference learned from conversations. */
export interface UserPreference {
  key: string;
  value: string;
  learnedAt: string;
  confidence: number;
}

/** A scheduled AI task — matches `CronTask` in `ai/cron.rs`. */
export interface CronTask {
  id: string;
  name: string;
  cronExpr: string;
  prompt: string;
  enabled: boolean;
  skillId?: string;
  lastRun?: string;
  lastResult?: string;
  lastStatus: 'never' | 'success' | 'failed';
}

/** A plan step — matches `PlanStep` in `ai/planner.rs`. */
export interface PlanStep {
  index: number;
  description: string;
  message: string;
  dependsOn: number[];
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
}

/** An execution plan — matches `ExecutionPlan` in `ai/planner.rs`. */
export interface ExecutionPlan {
  request: string;
  steps: PlanStep[];
  status: 'planning' | 'executing' | 'completed' | 'failed';
}

/** AgentEvent variants — matches `AgentEvent` in `ai/agent.rs`. */
export type AgentEvent =
  | { type: 'textDelta'; text: string }
  | {
      type: 'toolCall';
      callId: string;
      name: string;
      arguments: unknown;
      isWrite: boolean;
    }
  | {
      type: 'pendingApproval';
      callId: string;
      name: string;
      arguments: unknown;
      summary: string;
    }
  | { type: 'toolResult'; callId: string; ok: boolean; result: unknown }
  | { type: 'done'; finalMessage?: string; history: ChatMessage[] }
  | { type: 'error'; message: string };

/** Wrapper the backend emits on the `ai_event` Tauri event. */
export interface AiEventEnvelope {
  runId: string;
  event: AgentEvent;
}
