export interface VoltClawAgentOptions {
  llm?: LLMProvider | LLMConfig;
  channel?: Channel | ChannelConfig | (Channel | ChannelConfig)[];
  transport?: Channel | ChannelConfig; // Deprecated alias
  persistence?: Store | PersistenceConfig;
  call?: CallConfig;
  history?: HistoryConfig;
  tools?: Tool[] | ToolsConfig;
  hooks?: HooksConfig;
  middleware?: Middleware[];
  logger?: Logger | LoggerConfig;
  interactive?: boolean;
  plugins?: (string | import('./plugin.js').VoltClawPlugin)[];
  circuitBreaker?: CircuitBreakerConfig;
  retry?: RetryConfig;
  fallbacks?: Record<string, string>;
  dlq?: DLQConfig;
  audit?: { path?: string };
  permissions?: PermissionConfig;
  rlm?: CodeExecConfig;
  lcm?: LCMConfig;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  profiles?: Record<string, any>;
}

export interface LCMConfig {
  enabled: boolean;
  compressionLevel?: string;
}

export interface CodeExecConfig {
  enabled?: boolean;
  rlmTimeoutMs?: number;
  contextSizeThreshold?: number;
}

export type Role = 'admin' | 'user' | 'agent' | 'subagent';

export interface PermissionConfig {
  admins?: string[]; // Public keys of admins
  users?: string[]; // Public keys of users
  agents?: string[]; // Public keys of agents
  policy?: 'allow_all' | 'deny_all'; // Default policy if no role specified on tool
}

export interface DLQConfig {
  type: 'memory' | 'file';
  path?: string;
  enableTools?: boolean;
}

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterFactor?: number;
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
}

export interface LLMConfig {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
  maxPerMinute: number;
}

export interface ChannelConfig {
  type: 'nostr' | 'websocket' | 'stdio' | 'memory' | 'telegram' | 'discord' | 'irc';
  relays?: string[];
  privateKey?: string;
  port?: number;
  token?: string;
  server?: string;
  nick?: string;
  channels?: string[];
  password?: string;
}

// Deprecated alias
export type TransportConfig = ChannelConfig;

export interface PersistenceConfig {
  type: 'file' | 'sqlite' | 'memory';
  path?: string;
}

export interface CallConfig {
  maxDepth?: number;
  maxCalls?: number;
  budgetUSD?: number;
  timeoutMs?: number;
  largeResultThreshold?: number;
}

export interface HistoryConfig {
  maxMessages?: number;
  autoPruneInterval?: number;
  preserveLast?: number;
  contextWindowSize?: number;
}

export interface ToolsConfig {
  builtins?: string[];
  directories?: string[];
}

export interface HooksConfig {
  onMessage?: (ctx: MessageContext) => Promise<void>;
  onReply?: (ctx: ReplyContext) => Promise<void>;
  onCall?: (ctx: CallContext) => Promise<void>;
  onError?: (ctx: ErrorContext) => Promise<void>;
  onLog?: (ctx: LogContext) => Promise<void>;
  onToolApproval?: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
  onStart?: () => Promise<void>;
  onStop?: () => Promise<void>;
}

export interface LoggerConfig {
  level?: 'debug' | 'info' | 'warn' | 'error';
  format?: 'pretty' | 'json';
}

export interface MessageContext {
  from: string;
  content: string;
  timestamp: Date;
  metadata: MessageMeta;
}

export interface ReplyContext {
  to: string;
  content: string;
  timestamp: Date;
  inReplyTo?: string;
}

export interface CallContext {
  taskId: string;
  task: string;
  depth: number;
  parentPubkey?: string;
}

export interface ErrorContext {
  error: Error;
  context?: Record<string, unknown>;
  timestamp: Date;
}

export interface LogContext {
  subId: string;
  taskId?: string;
  message: string;
  level: 'info' | 'error';
  timestamp: Date;
}

export type Middleware = (
  ctx: MiddlewareContext,
  next: () => Promise<void>
) => Promise<void>;

export interface MiddlewareContext {
  from: string;
  message: string;
  reply?: string;
  session: Session;
  metadata: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface QueryOptions {
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export type Unsubscribe = () => void;

export type EventMap = {
  message: [MessageContext];
  reply: [ReplyContext];
  call: [CallContext];
  error: [ErrorContext];
  log: [LogContext];
  start: [];
  stop: [];
};

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools?: boolean;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  stream?(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>;
  embed?(text: string): Promise<number[]>;
  countTokens?(text: string): number;
}

export interface ChatChunk {
  content?: string;
  toolCalls?: Partial<ToolCall>;
  done?: boolean;
}

export interface ChatOptions {
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
}

export interface Channel {
  readonly type: string;
  readonly identity: { publicKey: string };
  start(): Promise<void>;
  stop(): Promise<void>;
  send(to: string, content: string): Promise<void>;
  subscribe(handler: MessageHandler): Unsubscribe;
  on(event: 'connected' | 'disconnected' | 'error', handler: EventHandler): void;
}

// Deprecated alias
export type Transport = Channel;

export type MessageHandler = (
  from: string,
  content: string,
  meta: MessageMeta
) => Promise<void>;

export type EventHandler = (...args: unknown[]) => void;

export interface MessageMeta {
  eventId?: string;
  timestamp?: number;
  kind?: number;
  tags?: string[][];
}

export interface Store {
  get(key: string, isSelf?: boolean): Session;
  getAll(): Record<string, Session>;
  load(): Promise<void>;
  save(): Promise<void>;
  clear(): void;
  // Optional MemoryStore interface methods
  createMemory?(entry: Omit<MemoryEntry, 'id' | 'timestamp'>): Promise<string>;
  searchMemories?(query: MemoryQuery): Promise<MemoryEntry[]>;
  updateMemory?(id: string, updates: Partial<MemoryEntry>): Promise<void>;
  removeMemory?(id: string): Promise<void>;
  exportMemories?(): Promise<MemoryEntry[]>;
  consolidateMemories?(): Promise<void>;
  // Graph methods
  addGraphNode?(node: GraphNode): Promise<void>;
  addGraphEdge?(edge: GraphEdge): Promise<void>;
  getGraphNode?(id: string): Promise<GraphNode | undefined>;
  getGraphEdges?(query: GraphQuery): Promise<GraphEdge[]>;
  searchGraphNodes?(query: string): Promise<GraphNode[]>;
  // Prompt methods
  getPromptTemplate?(id: string): Promise<PromptTemplate | undefined>;
  savePromptTemplate?(template: PromptTemplate): Promise<void>;
  getPromptVersion?(templateId: string, version: number): Promise<PromptVersion | undefined>;
  savePromptVersion?(version: PromptVersion): Promise<void>;
  listPromptTemplates?(): Promise<PromptTemplate[]>;
  // Scheduler methods
  scheduleTask?(task: ScheduledTask): Promise<void>;
  getScheduledTasks?(): Promise<ScheduledTask[]>;
  deleteScheduledTask?(id: string): Promise<void>;
}

export interface ScheduledTask {
  id: string;
  cron: string;
  task: string;
  createdAt: number;
  lastRun?: number;
  target?: string;
}

export interface PromptTemplate {
  id: string;
  description: string;
  latestVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface PromptVersion {
  templateId: string;
  version: number;
  content: string;
  changelog?: string;
  metrics?: {
    successCount: number;
    failureCount: number;
    avgCost: number;
  };
  createdAt: number;
}

export interface GraphNode {
  id: string; // Entity name or unique ID
  label: string; // Type of entity (e.g., Person, Place)
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string; // Usually source_relation_target
  source: string; // Node ID
  target: string; // Node ID
  relation: string; // e.g., KNOWS, LOCATED_IN
  weight?: number; // 0.0-1.0
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface GraphQuery {
  source?: string;
  target?: string;
  relation?: string;
  limit?: number;
}

export interface MemoryEntry {
  id: string;
  type: 'working' | 'long_term' | 'episodic';
  level: number; // 0-4
  lastAccess: number;
  content: string;
  embedding?: number[];
  tags?: string[];
  importance?: number;
  timestamp: number;
  expiresAt?: number;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryQuery {
  id?: string;
  type?: MemoryEntry['type'];
  level?: number;
  tags?: string[];
  content?: string; // Simple text search
  embedding?: number[]; // Vector search
  contextId?: string;
  limit?: number;
  offset?: number;
}

export interface Session {
  id?: string;
  parentId?: string;
  rootId?: string;
  sharedData?: Record<string, unknown>;
  history: ChatMessage[];
  callCount: number;
  estCostUSD: number;
  actualTokensUsed: number;
  subTasks: Record<string, SubTaskInfo>;
  depth: number;
  topLevelStartedAt: number;
}

export interface SubTaskInfo {
  createdAt: number;
  task: string;
  schema?: Record<string, unknown> | string;
  arrived: boolean;
  result?: string;
  error?: string;
  resolve?: (value: string) => void;
  reject?: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

export interface Tool {
  name: string;
  description: string;
  parameters?: ToolParameters;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (args: Record<string, unknown>, agent?: any, session?: any, from?: string) => Promise<ToolCallResult> | ToolCallResult;
  maxDepth?: number;
  costMultiplier?: number;
  requiredRoles?: Role[];
}

export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolParameterProperty {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: ToolParameters;
}

export interface ToolCallResult {
  [key: string]: unknown;
  error?: string;
  status?: string;
  result?: string;
  subId?: string;
  depth?: number;
  estCost?: number;
}
