import { bootstrap, loadSystemPrompt, VOLTCLAW_DIR, TOOLS_DIR } from './bootstrap.js';
export { bootstrap, loadSystemPrompt, VOLTCLAW_DIR, TOOLS_DIR };

import { OllamaProvider, OpenAIProvider, AnthropicProvider } from '../llm/index.js';
import { NostrClient } from '../channels/nostr/index.js';
import { TelegramChannel } from '../channels/telegram.js';
import { DiscordChannel } from '../channels/discord.js';
import { StdioChannel } from '../channels/stdio.js';
import { IrcChannel } from '../channels/irc.js';
import { CompositeChannel } from '../channels/composite.js';
import { FileStore } from '../memory/index.js';
import { SQLiteStore } from '../memory/sqlite.js';
import { Workspace } from './workspace.js';
import { PluginManager } from './plugin.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { Retrier } from './retry.js';
import { DeadLetterQueue, InMemoryDLQ, FileDLQ } from './dlq.js';
import { createDLQTools } from '../tools/dlq.js';
import { FileAuditLog, type AuditLog } from './audit.js';
import { MemoryManager, GraphManager } from '../memory/index.js';
import { createMemoryTools } from '../tools/memory.js';
import { createGraphTools } from '../tools/graph.js';
import { createSelfTestTool } from '../tools/self-test.js';
import { createDocumentationTools } from '../tools/documentation.js';
import { createPromptTools } from '../tools/prompt.js';
import { createCodeExecTool } from '../tools/code_exec.js';
import { ContextManager } from './context-manager.js';
import { SelfTestFramework } from './self-test.js';
import { DocumentationManager } from './documentation.js';
import { PromptManager } from './prompt-manager.js';
import { HeartbeatManager } from './heartbeat.js';
import { SpawnManager, createSpawnTool } from './spawn.js';
import { SkillLoader } from './skills.js';
import { createBrowserTools } from '../tools/browser.js';
import { Scheduler } from './scheduler.js';
import { createSchedulerTools } from '../tools/scheduler.js';
import { webSearchTool } from '../tools/web_search.js';

import type {
  VoltClawAgentOptions,
  LLMProvider,
  Channel,
  Store,
  Tool,
  Middleware,
  Logger,
  MessageContext,
  ReplyContext,
  CallContext,
  ErrorContext,
  LogContext,
  QueryOptions,
  Unsubscribe,
  Session,
  ChatMessage,
  MessageMeta,
  ToolCallResult,
  LLMConfig,
  ChannelConfig,
  PersistenceConfig,
  CircuitBreakerConfig,
  RetryConfig,
  PermissionConfig,
  Role
} from './types.js';
import {
  VoltClawError,
  ConfigurationError,
  AuthorizationError,
  MaxDepthExceededError,
  BudgetExceededError,
  TimeoutError,
  isRetryable
} from './errors.js';

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_CALLS = 25;
const DEFAULT_BUDGET_USD = 0.75;
const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_MAX_HISTORY = 60;
const DEFAULT_PRUNE_INTERVAL = 300000;
const DEFAULT_CB_THRESHOLD = 5;
const DEFAULT_CB_RESET_MS = 60000;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY = 1000;
const DEFAULT_RETRY_MAX_DELAY = 10000;
const DEFAULT_RETRY_JITTER = 0.1;

interface AgentState {
  isRunning: boolean;
  isPaused: boolean;
}

export class VoltClawAgent {
  private readonly llm: LLMProvider;
  private readonly channel: Channel;
  private readonly store: Store;
  private readonly workspace: Workspace;
  private readonly pluginManager: PluginManager;
  private workspaceContext: string = '';
  private readonly tools: Map<string, Tool> = new Map();
  private readonly circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private readonly circuitBreakerConfig: CircuitBreakerConfig;
  private readonly retrier: Retrier;
  private readonly fallbacks: Record<string, string>;
  public readonly dlq: DeadLetterQueue;
  public readonly memory: MemoryManager;
  public readonly graph: GraphManager;
  public readonly contextManager: ContextManager;
  public readonly selfTest: SelfTestFramework;
  public readonly docs: DocumentationManager;
  public readonly prompts: PromptManager;
  public readonly heartbeat: HeartbeatManager;
  public readonly spawner: SpawnManager;
  public readonly skills: SkillLoader;
  public readonly scheduler: Scheduler;
  private readonly auditLog?: AuditLog;
  private readonly permissions: PermissionConfig;
  private readonly middleware: Middleware[] = [];
  private readonly hooks: {
    onMessage?: (ctx: MessageContext) => Promise<void>;
    onReply?: (ctx: ReplyContext) => Promise<void>;
    onCall?: (ctx: CallContext) => Promise<void>;
    onError?: (ctx: ErrorContext) => Promise<void>;
    onLog?: (ctx: LogContext) => Promise<void>;
    onToolApproval?: (tool: string, args: Record<string, unknown>) => Promise<boolean>;
    onStart?: () => Promise<void>;
    onStop?: () => Promise<void>;
  } = {};
  private readonly logger: Logger;
  private readonly maxDepth: number;
  private readonly maxCalls: number;
  private readonly budgetUSD: number;
  private readonly timeoutMs: number;
  private readonly largeResultThreshold: number;
  private readonly maxHistory: number;
  private readonly autoPruneInterval: number;
  private readonly eventHandlers: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private readonly state: AgentState = { isRunning: false, isPaused: false };
  private transportUnsubscribe?: Unsubscribe;
  private pruneTimer?: ReturnType<typeof setInterval>;
  private systemPromptTemplate?: string;
  private readonly rlmEnabled: boolean;
  private readonly lcmEnabled: boolean;

  constructor(options: VoltClawAgentOptions = {}) {
    this.llm = this.resolveLLM(options.llm);
    // Backward compatibility for 'transport' option
    const channelOption = options.channel ?? options.transport;
    this.channel = this.resolveChannel(channelOption);
    this.store = this.resolveStore(options.persistence);
    this.workspace = new Workspace();
    this.pluginManager = new PluginManager();
    
    this.maxDepth = options.call?.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxCalls = options.call?.maxCalls ?? DEFAULT_MAX_CALLS;
    this.budgetUSD = options.call?.budgetUSD ?? DEFAULT_BUDGET_USD;
    this.timeoutMs = options.call?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.largeResultThreshold = options.call?.largeResultThreshold ?? 5000;
    this.maxHistory = options.history?.maxMessages ?? DEFAULT_MAX_HISTORY;
    this.autoPruneInterval = options.history?.autoPruneInterval ?? DEFAULT_PRUNE_INTERVAL;

    this.circuitBreakerConfig = options.circuitBreaker ?? {
      failureThreshold: DEFAULT_CB_THRESHOLD,
      resetTimeoutMs: DEFAULT_CB_RESET_MS
    };

    const retryConfig: RetryConfig = options.retry ?? {
      maxAttempts: DEFAULT_RETRY_MAX_ATTEMPTS,
      baseDelayMs: DEFAULT_RETRY_BASE_DELAY,
      maxDelayMs: DEFAULT_RETRY_MAX_DELAY,
      jitterFactor: DEFAULT_RETRY_JITTER
    };
    this.retrier = new Retrier(retryConfig);

    this.fallbacks = options.fallbacks ?? {};

    // DLQ initialization
    if (options.dlq?.type === 'file' && options.dlq.path) {
      this.dlq = new DeadLetterQueue(new FileDLQ(options.dlq.path));
    } else {
      this.dlq = new DeadLetterQueue(new InMemoryDLQ());
    }

    // Audit Log initialization
    if (options.audit?.path) {
        this.auditLog = new FileAuditLog(options.audit.path);
    }

    this.rlmEnabled = options.rlm?.enabled ?? false;
    this.lcmEnabled = options.lcm?.enabled ?? false;

    this.memory = new MemoryManager(this.store, this.llm);
    this.graph = new GraphManager(this.store, this.llm);
    this.contextManager = new ContextManager(this.llm, {
      maxMessages: options.history?.contextWindowSize ?? this.maxHistory,
      preserveLast: options.history?.preserveLast ?? 20,
      memory: this.memory,
      graph: this.graph,
      lcmEnabled: this.lcmEnabled
    });
    this.selfTest = new SelfTestFramework(this);
    this.docs = new DocumentationManager(this);
    this.prompts = new PromptManager(this.store, this.llm);
    this.heartbeat = new HeartbeatManager(this);
    this.spawner = new SpawnManager(this);
    this.skills = new SkillLoader();
    this.scheduler = new Scheduler(this);

    this.permissions = options.permissions ?? { policy: 'allow_all' };

    // Default tools + user provided tools
    const coreTools: Tool[] = [
      createSelfTestTool(this.selfTest),
      ...createDocumentationTools(this.docs),
      ...createBrowserTools(), // Enable browser by default if installed
      createSpawnTool(this.spawner),
      ...createSchedulerTools(this.scheduler),
      webSearchTool
    ];

    if (options.tools) {
      // If user provides tools, merge them
      this.registerTools(coreTools);
      this.registerTools(options.tools);
    } else {
      this.registerTools(coreTools);

      if (this.rlmEnabled) {
          const rlmConfig = {
              rlmTimeoutMs: options.call?.timeoutMs,
              ...options.rlm
          };
          this.registerTools([createCodeExecTool(rlmConfig)]);
      }
    }

    // Register prompt tools if store supports it
    if (this.store.savePromptTemplate) {
      this.registerTools(createPromptTools(this.prompts));
    }

    // Register DLQ tools
    if (options.dlq?.enableTools) {
      this.registerTools(createDLQTools(this));
    }

    // Register memory tools if store supports it
    if (this.store.createMemory) {
      this.registerTools(createMemoryTools(this.memory));
    }

    // Register graph tools if store supports it
    if (this.store.addGraphNode) {
      this.registerTools(createGraphTools(this.graph));
    }

    // Load dynamic skills and start watching
    this.skills.loadSkills().then(tools => {
        if (tools.length > 0) {
            this.registerTools(tools);
        }
    });
    this.skills.on('skillLoaded', (tool) => {
        this.registerTools([tool]);
    });
    this.skills.startWatching();

    if (options.middleware) {
      this.middleware = options.middleware;
    }

    if (options.plugins) {
      this.registerPlugins(options.plugins);
    }

    if (options.hooks) {
      this.hooks = options.hooks;
    }

    this.logger = this.resolveLogger(options.logger);
  }

  private resolveLLM(llm: VoltClawAgentOptions['llm']): LLMProvider {
    if (!llm) {
      throw new ConfigurationError('LLM provider is required');
    }
    if (typeof llm === 'object' && 'chat' in llm && typeof llm.chat === 'function') {
      return llm as LLMProvider;
    }
    if (typeof llm === 'object' && 'provider' in llm) {
      const config = llm as import('./types.js').LLMConfig;
      switch (config.provider) {
        case 'ollama': return new OllamaProvider(config);
        case 'openai': return new OpenAIProvider(config);
        case 'anthropic': return new AnthropicProvider(config);
        default: throw new ConfigurationError(`Unknown LLM provider: ${config.provider}`);
      }
    }
    throw new ConfigurationError('Invalid LLM configuration');
  }

  private resolveChannel(channel: VoltClawAgentOptions['channel']): Channel {
    if (!channel) {
      throw new ConfigurationError('Channel is required');
    }

    if (Array.isArray(channel)) {
      const channels = channel.map(c => this.resolveChannel(c));
      return new CompositeChannel(channels);
    }

    if (typeof channel === 'object' && 'subscribe' in channel && typeof channel.subscribe === 'function') {
      return channel as Channel;
    }
    if (typeof channel === 'object' && 'type' in channel) {
      const config = channel as import('./types.js').ChannelConfig;
      if (config.type === 'nostr') {
        return new NostrClient({
          relays: config.relays ?? [],
          privateKey: config.privateKey
        });
      }
      if (config.type === 'telegram') {
        if (!config.token) throw new ConfigurationError('Telegram token is required');
        return new TelegramChannel({ token: config.token });
      }
      if (config.type === 'discord') {
        if (!config.token) throw new ConfigurationError('Discord token is required');
        return new DiscordChannel({ token: config.token });
      }
      if (config.type === 'stdio') {
        return new StdioChannel();
      }
      if (config.type === 'irc') {
        if (!config.server || !config.nick) throw new ConfigurationError('IRC server and nick are required');
        return new IrcChannel({
          server: config.server,
          nick: config.nick,
          port: config.port,
          channels: config.channels,
          password: config.password
        });
      }
    }
    throw new ConfigurationError('Invalid channel configuration');
  }

  private resolveStore(persistence: VoltClawAgentOptions['persistence']): Store {
    if (!persistence) {
      throw new ConfigurationError('Persistence store is required');
    }
    if (typeof persistence === 'object' && 'get' in persistence && typeof persistence.get === 'function') {
      return persistence as Store;
    }
    if (typeof persistence === 'object' && 'type' in persistence) {
      const config = persistence as import('./types.js').PersistenceConfig;
      if (config.type === 'file') {
        return new FileStore({ path: config.path ?? `${VOLTCLAW_DIR}/data.json` });
      }
      if (config.type === 'sqlite') {
        return new SQLiteStore({ path: config.path });
      }
    }
    throw new ConfigurationError('Invalid persistence configuration');
  }

  private resolveLogger(logger: VoltClawAgentOptions['logger']): Logger {
    if (logger && typeof logger === 'object' && 'info' in logger) {
      return logger as Logger;
    }
    return {
      debug: (_message: string, _data?: Record<string, unknown>) => {},
      info: (_message: string, _data?: Record<string, unknown>) => {},
      warn: (_message: string, _data?: Record<string, unknown>) => {},
      error: (_message: string, _data?: Record<string, unknown>) => {}
    };
  }

  private getCircuitBreaker(name: string): CircuitBreaker {
    if (!this.circuitBreakers.has(name)) {
      this.circuitBreakers.set(name, new CircuitBreaker(this.circuitBreakerConfig));
    }
    return this.circuitBreakers.get(name)!;
  }

  private registerTools(tools: Tool[] | { builtins?: string[]; directories?: string[] }): void {
    if (Array.isArray(tools)) {
      for (const tool of tools) {
        this.tools.set(tool.name, tool);
      }
    }
  }

  private registerPlugins(plugins: (string | import('./plugin.js').VoltClawPlugin)[]): void {
    for (const plugin of plugins) {
      if (typeof plugin === 'string') {
        this.pluginManager.load(plugin).catch(e => this.logger.error('Failed to load plugin', { error: String(e) }));
      } else {
        this.pluginManager.register(plugin);
      }
    }

    // Register tools and middleware immediately for instances
    const tools = this.pluginManager.getTools();
    this.registerTools(tools);

    const middleware = this.pluginManager.getMiddleware();
    this.middleware.push(...middleware);
  }

  async start(): Promise<void> {
    if (this.state.isRunning) {
      return;
    }

    await this.auditLog?.log('system', 'start', {});

    // Try to bootstrap if needed
    try {
        await bootstrap();
        this.systemPromptTemplate = await loadSystemPrompt();
        await this.workspace.ensureExists();
        this.workspaceContext = await this.workspace.loadContext();
    } catch (e) {
        this.logger.warn("Failed to bootstrap configuration", { error: String(e) });
    }

    await this.channel.start();
    await this.store.load?.();

    // Start background managers
    this.heartbeat.start();
    this.scheduler.start().catch(e => this.logger.error('Failed to start scheduler', { error: String(e) }));
    this.spawner.setAgent(this);

    await this.pluginManager.initAll(this);
    await this.pluginManager.startAll(this);

    this.transportUnsubscribe = this.channel.subscribe(
      async (from: string, content: string, meta: MessageMeta) => {
        await this.handleMessage(from, content, meta);
      }
    );

    this.pruneTimer = setInterval(async () => {
      await this.pruneAllSessions();
    }, this.autoPruneInterval);

    this.state.isRunning = true;
    this.state.isPaused = false;
    await this.hooks.onStart?.();
    this.emit('start');
    this.logger.info('VoltClaw agent started');
  }

  async stop(): Promise<void> {
    if (!this.state.isRunning) {
      return;
    }

    this.transportUnsubscribe?.();
    this.transportUnsubscribe = undefined;

    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }

    this.heartbeat.stop();
    this.skills.stopWatching();
    await this.scheduler.stop();
    await this.spawner.waitForAll();

    await this.pluginManager.stopAll(this);
    await this.channel.stop();
    await this.store.save?.();

    this.state.isRunning = false;
    await this.hooks.onStop?.();
    await this.auditLog?.log('system', 'stop', {});
    this.emit('stop');
    this.logger.info('VoltClaw agent stopped');
  }

  pause(): void {
    this.state.isPaused = true;
    this.logger.info('Agent paused');
  }

  resume(): void {
    this.state.isPaused = false;
    this.logger.info('Agent resumed');
  }

  public async retryTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    const session = this.store.get('self', true);
    return this.executeTool(name, args, session, this.channel.identity.publicKey);
  }

  public getStore(): Store {
    return this.store;
  }

  public async send(to: string, content: string): Promise<void> {
    await this.channel.send(to, content);
  }

  async query(message: string, _options?: QueryOptions): Promise<string> {
    const session = this.store.get('self', true);

    // Ensure we start with a clean state for one-shot if needed, or handle session logic better
    // For now, simple append
    if (session.depth === undefined) session.depth = 0;

    session.rootId = session.id;
    session.parentId = undefined;
    if (!session.sharedData) session.sharedData = {};

    session.history.push({ role: 'user', content: message });
    
    // Use handleTopLevel logic but wait for result?
    // query() is synchronous-looking but really async.
    // We should reuse handleTopLevel logic but capture the final answer.
    // However, handleTopLevel sends via transport.
    // For local query, we want the result directly.
    
    // Adapted from handleTopLevel for direct response:
    session.subTasks = {};
    session.callCount = 0;
    session.estCostUSD = 0;
    session.actualTokensUsed = 0;
    session.topLevelStartedAt = Date.now();

    const systemPrompt = this.buildSystemPrompt(session.depth);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...session.history.slice(-this.maxHistory)
    ];

    const reply = await this.runAgentLoop(session, messages, 'self', session.depth);

    session.history.push({ role: 'assistant', content: reply });
    this.pruneHistory(session);
    await this.store.save?.();

    return reply;
  }

  private async runAgentLoop(
    session: Session,
    messages: ChatMessage[],
    from: string,
    toolDepth: number
  ): Promise<string> {
    messages = await this.contextManager.manageContext(messages);

    const cb = this.getCircuitBreaker('llm');
    let response = await cb.execute(() => this.retrier.execute(() => this.llm.chat(messages, {
      tools: this.getToolDefinitions(toolDepth)
    })));

    while (response.toolCalls && response.toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls
      });
      // Also push to session history if not already shared (assumes messages is separate)
      // But query/handleTopLevel pass references. Let's assume messages IS the history + prompt.
      // Wait, history is persisted. We need to be careful not to double push.
      // Actually, query/handleTopLevel construct `messages` from `session.history` + new prompt.
      // So pushing to `messages` is local to this loop.
      // But we need to persist the assistant response and tool outputs to `session.history`.
      // The current implementation does:
      /*
      messages.push(assistantResponse);
      for calls: execute, messages.push(toolResult);
      */
      // And at the END: session.history.push(assistantResponse) (only final?).
      // No, looking at `handleTopLevel`:
      /*
        while (response.toolCalls...) {
            messages.push(assistant...);
            for calls... execute... messages.push(tool...);
            response = llm.chat(messages...);
        }
        const reply = response.content;
        session.history.push({ role: 'user', content }); // pushed before loop
        session.history.push({ role: 'assistant', content: reply }); // pushed after loop
      */
      // It seems intermediate tool calls are NOT persisted to session.history in `handleTopLevel`?
      // Wait, let's check `handleTopLevel` implementation again.
      // Yes, `handleTopLevel` only pushes the final reply to `session.history`.
      // `handleSubtask` sets `session.history = messages;` at the end, so it persists EVERYTHING.

      // This is an inconsistency. Subtasks persist full trace, top-level only persists final Q/A.
      // RLM usually benefits from full traces.
      // I will standardize on `session.history = messages` (minus system prompt) or similar.
      // But `handleTopLevel` constructs `messages` as `[System, ...History, User]`.
      // If we set `session.history = messages`, we duplicate System prompt and old history?
      // We should probably append new interactions to history.

      for (const call of response.toolCalls) {
        const result = await this.executeTool(call.name, call.arguments, session, from);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify(result)
        });
      }

      response = await cb.execute(() => this.retrier.execute(() => this.llm.chat(messages, {
        tools: this.getToolDefinitions(toolDepth)
      })));
    }

    return response.content || '[error]';
  }

  async *queryStream(message: string, _options?: QueryOptions): AsyncIterable<string> {
    const session = this.store.get('self', true);

    if (session.depth === undefined) session.depth = 0;

    session.rootId = session.id;
    session.parentId = undefined;
    if (!session.sharedData) session.sharedData = {};

    session.history.push({ role: 'user', content: message });

    session.subTasks = {};
    session.callCount = 0;
    session.estCostUSD = 0;
    session.actualTokensUsed = 0;
    session.topLevelStartedAt = Date.now();

    const systemPrompt = this.buildSystemPrompt(session.depth);
    let messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...session.history.slice(-this.maxHistory)
    ];

    messages = await this.contextManager.manageContext(messages);

    if (!this.llm.stream) {
      const response = await this.query(message, _options);
      yield response;
      return;
    }

    let shouldContinue = true;
    while (shouldContinue) {
      shouldContinue = false;

      const stream = this.llm.stream(messages, {
        tools: this.getToolDefinitions(session.depth)
      });

      let fullContent = '';
      const toolCalls: import('./types.js').ToolCall[] = [];

      for await (const chunk of stream) {
        if (chunk.content) {
          fullContent += chunk.content;
          yield chunk.content;
        }
        if (chunk.toolCalls) {
          const tc = chunk.toolCalls;
          if (tc.id && tc.name && tc.arguments) {
             toolCalls.push(tc as import('./types.js').ToolCall);
          }
        }
      }

      if (toolCalls.length > 0) {
        shouldContinue = true;

        // Push assistant response with tool calls to session history
        session.history.push({
          role: 'assistant',
          content: fullContent,
          toolCalls: toolCalls
        });

        // Also push to local messages array for next turn
        messages.push({
          role: 'assistant',
          content: fullContent,
          toolCalls: toolCalls
        });

        for (const call of toolCalls) {
          const result = await this.executeTool(call.name, call.arguments, session, 'self');
          const resultStr = JSON.stringify(result);

          // Push tool result to session history
          session.history.push({
            role: 'tool',
            toolCallId: call.id,
            content: resultStr
          });

          // Also push to local messages array
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            content: resultStr
          });
        }

        // Save session state after tool execution loop
        this.pruneHistory(session);
        await this.store.save?.();
      } else {
        const reply = fullContent || '[error]';
        session.history.push({ role: 'assistant', content: reply });
        this.pruneHistory(session);
        await this.store.save?.();
      }
    }
  }

  private async handleMessage(from: string, content: string, meta: MessageMeta): Promise<void> {
    if (this.state.isPaused) {
      this.logger.debug('Message ignored - agent paused', { from });
      return;
    }

    const isSelf = from === this.channel.identity.publicKey;
    const session = this.store.get(isSelf ? 'self' : from, isSelf);

    const ctx: MessageContext = {
      from,
      content,
      timestamp: new Date(),
      metadata: meta
    };
    await this.auditLog?.log(from, 'message_received', { content });
    await this.hooks.onMessage?.(ctx);
    this.emit('message', ctx);

    try {
      const parsed = this.tryParseJSON(content);
      
      if (parsed?.type === 'subtask') {
        // Use a dedicated session for the subtask to prevent polluting the main session
        // or mixing concurrent subtasks.
        const subId = parsed.subId as string;
        // Must pass false for isSelf to ensure we use the specific subtask key, not 'self'
        const subSession = this.store.get(`subtask:${subId}`, false);
        await this.handleSubtask(subSession, parsed, from);
      } else if (parsed?.type === 'subtask_result') {
        // Resolve the session that initiated the task using parentPubkey if available
        const targetSession = session;
        if (parsed.parentPubkey) {
            const pKey = parsed.parentPubkey as string;
            const isSelfParent = pKey === this.channel.identity.publicKey;
            // If parent was self, we map to 'self' (or subtask session if we had that logic,
            // but currently recursive calls from subtasks might need handling).

            // Wait, if a subtask calls a subtask:
            // handleSubtask (session: subtask:ID1) -> executeCall (from: self)
            // payload parentPubkey = self.
            // subtask_result parentPubkey = self.
            // Here we map self -> 'self'.
            // But the subtask was in 'subtask:ID1'.
            // 'self' session does not have the subtask!

            // We need the ACTUAL session ID/Key passed around.
            // We can't rely on pubkey for internal sessions (subtask:...).
        }
        await this.handleSubtaskResult(targetSession, parsed, from);
      } else if (parsed?.type === 'subtask_log') {
        const logCtx: LogContext = {
          subId: parsed.subId as string,
          taskId: parsed.taskId as string,
          message: parsed.message as string,
          level: (parsed.level as 'info' | 'error') ?? 'info',
          timestamp: new Date()
        };
        await this.hooks.onLog?.(logCtx);
        this.emit('log', logCtx);
      } else {
        await this.handleTopLevel(session, content, from);
      }
    } catch (error) {
      const errCtx: ErrorContext = {
        error: error instanceof Error ? error : new Error(String(error)),
        context: { from, content: content.slice(0, 100) },
        timestamp: new Date()
      };
      await this.hooks.onError?.(errCtx);
      this.emit('error', errCtx);
      this.logger.error('Error handling message', { error: String(error), from });
    }
  }

  private tryParseJSON(text: string): Record<string, unknown> | null {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async handleTopLevel(
    session: Session,
    content: string,
    from: string
  ): Promise<void> {
    session.depth = 0;
    session.rootId = session.id;
    session.parentId = undefined;
    if (!session.sharedData) session.sharedData = {};
    session.subTasks = {};
    session.callCount = 0;
    session.estCostUSD = 0;
    session.actualTokensUsed = 0;
    session.topLevelStartedAt = Date.now();

    const systemPrompt = this.buildSystemPrompt(session.depth);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...session.history.slice(-this.maxHistory),
      { role: 'user', content }
    ];

    const reply = await this.runAgentLoop(session, messages, from, session.depth);

    session.history.push({ role: 'user', content });
    session.history.push({ role: 'assistant', content: reply });
    this.pruneHistory(session);
    await this.store.save?.();

    await this.channel.send(from, reply);
    
    const replyCtx: ReplyContext = {
      to: from,
      content: reply,
      timestamp: new Date()
    };
    await this.hooks.onReply?.(replyCtx);
    this.emit('reply', replyCtx);
  }

  private async handleSubtask(
    session: Session,
    parsed: Record<string, unknown>,
    _from: string
  ): Promise<void> {
    const depth = (parsed.depth as number) ?? session.depth + 1;
    const task = parsed.task as string;
    const contextSummary = (parsed.contextSummary as string) ?? '';
    const schema = parsed.schema as Record<string, unknown> | string | undefined;
    const subId = parsed.subId as string;
    const parentPubkey = parsed.parentPubkey as string | undefined;
    const rootId = parsed.rootId as string | undefined;
    const parentId = parsed.parentId as string | undefined;

    session.depth = depth;
    session.rootId = rootId;
    session.parentId = parentId;

    const mustFinish = depth >= this.maxDepth - 1
      ? '\nMUST produce final concise answer NOW. No further calls.'
      : '';

    let contextInstruction = '';
    const memoryMatch = contextSummary.match(/RLM Context stored in memory\. Use memory_recall\(id='(.*?)'\)/);
    if (memoryMatch) {
      contextInstruction = `\n\n[IMPORTANT] Large context is stored in memory (ID: ${memoryMatch[1]}). Use 'memory_recall' to access it.`;
    }

    let schemaInstruction = '';
    if (schema) {
        const schemaStr = typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2);
        schemaInstruction = `\n\nOUTPUT REQUIREMENT:\nYou MUST produce a valid JSON object matching this schema:\n${schemaStr}\n\nDo not wrap the JSON in markdown code blocks. Just raw JSON.`;
    }

    const systemPrompt = this.buildSystemPrompt(depth);
    const userPrompt = `Task: ${task}
Parent context: ${contextSummary}${contextInstruction}${schemaInstruction}${mustFinish}`;

    // Initialize session state for subtask
    session.depth = depth;
    session.subTasks = {};
    session.callCount = 0;
    session.estCostUSD = 0;
    session.actualTokensUsed = 0;
    session.topLevelStartedAt = Date.now();

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      let result = await this.runAgentLoop(session, messages, 'self', depth);

      // Transparently offload large results to memory (if LCM is enabled)
      if (this.lcmEnabled && result.length > this.largeResultThreshold && this.memory) {
          try {
            const memId = await this.memory.storeMemory(
                result,
                'working',
                ['rlm_result', `subtask:${subId}`],
                5, // Medium importance
                1, // Level 1 (Recent)
                3600000, // TTL: 1 hour
                { overlap: 0 } // No overlap for clean reassembly
            );
            result = `[RLM_REF:${memId}]`;
          } catch (e) {
            // Fallback to sending raw result if memory store fails
            this.logger.error('Failed to offload large RLM result', { error: String(e) });
          }
      }

      await this.channel.send(
        this.channel.identity.publicKey,
        JSON.stringify({ type: 'subtask_result', subId, result, parentPubkey })
      );

      // Save history to session for auditing/debugging
      session.history = messages;
      await this.store.save?.();

      const callCtx: CallContext = {
        taskId: subId,
        task,
        depth,
        parentPubkey
      };
      await this.hooks.onCall?.(callCtx);
      this.emit('call', callCtx);
    } catch (error) {
      await this.channel.send(
        this.channel.identity.publicKey,
        JSON.stringify({ type: 'subtask_result', subId, error: String(error), parentPubkey })
      );
    }
  }

  private async handleSubtaskResult(
    session: Session,
    parsed: Record<string, unknown>,
    _from: string
  ): Promise<void> {
    const subId = parsed.subId as string;
    const sub = session.subTasks[subId];
    if (!sub) {
        // Debug logging for missing subtasks
        // console.log(`Subtask ${subId} not found. Available: ${Object.keys(session.subTasks).join(', ')}`);
        return;
    }

    if (sub.timer) {
      clearTimeout(sub.timer);
    }

    sub.arrived = true;
    if (parsed.error) {
      sub.error = parsed.error as string;
      sub.reject?.(new Error(sub.error));
    } else {
      sub.result = parsed.result as string;

      // Validate schema if one was requested
      if (sub.schema && sub.result) {
          try {
              JSON.parse(sub.result);
          } catch (e) {
              const err = e instanceof Error ? e : new Error(String(e));
              sub.result = undefined;
              sub.error = `Sub-agent output failed validation: ${err.message}. Output was: ${sub.result}`;
              sub.reject?.(new Error(sub.error));
              return;
          }
      }

      const addedTokens = Math.ceil((sub.result?.length ?? 0) / 4);
      session.actualTokensUsed += addedTokens;
      session.estCostUSD += (addedTokens / 1000) * 0.0005;
      sub.resolve?.(sub.result);
    }

    await this.store.save?.();

    const allDone = Object.values(session.subTasks).every(
      (s: { arrived: boolean; error?: string }) => s.arrived || s.error
    );
    
    if (allDone && session.topLevelStartedAt > 0) {
      await this.synthesize(session);
    }
  }

  private async synthesize(session: Session): Promise<string> {
    const results = Object.entries(session.subTasks)
      .map(([id, info]: [string, { arrived: boolean; result?: string; error?: string }]) => {
        const status = info.arrived ? info.result : (info.error ?? '[timeout/failed]');
        return `- ${id.slice(-8)}: ${status}`;
      })
      .join('\n');

    const prompt = `Synthesize sub-task results (or note failures/timeouts):\n${results}\n\nProduce coherent final answer.`;
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are VoltClaw – combine sub-results.' },
      { role: 'user', content: prompt }
    ];

    const cb = this.getCircuitBreaker('llm');
    const response = await cb.execute(() => this.retrier.execute(() => this.llm.chat(messages))).catch(() => ({
      content: 'Synthesis failed. Raw results:\n' + results
    }));

    return response.content;
  }

  public async executeTool(
    name: string,
    args: Record<string, unknown>,
    session: Session,
    from: string
  ): Promise<ToolCallResult> {
    try {
      if (name === 'call') {
        return await this.executeCall(args, session, from);
      }
      
      if (name === 'call_parallel') {
        return await this.executeCallParallel(args, session, from);
      }

      const tool = this.tools.get(name);
      if (!tool) {
        return { error: `Tool not found: ${name}` };
      }

      // Check RBAC
      const role = this.getRole(from);
      if (!this.checkPermission(tool, role)) {
        await this.auditLog?.log(from, 'tool_denied', { tool: name, reason: 'authorization' });
        throw new AuthorizationError(`User ${from.slice(0, 8)} (role: ${role}) not authorized for tool ${name}`);
      }

      if (this.hooks.onToolApproval) {
          const approved = await this.hooks.onToolApproval(name, args);
          if (!approved) {
              await this.auditLog?.log(from, 'tool_denied', { tool: name, reason: 'user_approval' });
              return { error: 'Tool execution denied by user' };
          }
      }

      await this.auditLog?.log(from, 'tool_execute', { tool: name, args });

      const cb = this.getCircuitBreaker(name);
      const fallbackName = this.fallbacks[name];
      const fallback = fallbackName
        ? () => this.executeTool(fallbackName, args, session, from).then(r => {
             if (r.error) throw new Error(r.error);
             return r;
           })
        : undefined;

      const result = await cb.execute(
        () => this.retrier.execute(async () => tool.execute(args, this, session, from)),
        fallback
      );

      await this.auditLog?.log(from, 'tool_result', { tool: name, result });

      return result as ToolCallResult;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // If we reach here, it means retries failed, circuit breaker failed (or open), and fallback failed (or missing).
      // Push to DLQ.
      await this.dlq.push(name, args, err);

      return { error: err.message };
    }
  }

  private async executeCall(
    args: Record<string, unknown>,
    session: Session,
    from: string
  ): Promise<ToolCallResult> {
    if (!this.rlmEnabled) {
      this.logger.warn('Attempted to use call tool while RLM is disabled.');
      return { error: 'RLM is disabled. The call tool cannot be used.' };
    }

    const task = args.task as string;
    const summary = args.summary as string | undefined;
    const schema = args.schema as Record<string, unknown> | string | undefined;
    const depth = session.depth + 1;

    if (depth > this.maxDepth) {
      throw new MaxDepthExceededError(this.maxDepth, depth);
    }

    if (session.callCount >= this.maxCalls) {
      return { error: 'Max calls exceeded' };
    }

    const baseEst = ((task.length + (summary?.length ?? 0)) / 4000) * 0.0005;
    const estNewCost = baseEst * 3;

    if (session.estCostUSD + estNewCost > this.budgetUSD * 0.8) {
      throw new BudgetExceededError(this.budgetUSD, session.estCostUSD);
    }

    session.callCount++;
    session.estCostUSD += estNewCost;

    const subId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    session.subTasks[subId] = {
      createdAt: Date.now(),
      task,
      schema,
      arrived: false,
      resolve: undefined,
      reject: undefined
    };
    const payload = JSON.stringify({
      type: 'subtask',
      parentPubkey: from,
      subId,
      task,
      contextSummary: summary ?? '',
      schema,
      depth,
      rootId: session.rootId,
      parentId: session.id
    });

    await this.channel.send(this.channel.identity.publicKey, payload);
    await this.store.save?.();

    // Wait for result
    try {
      const result = await this.waitForSubtaskResult(subId, session);
      return { status: 'completed', result, subId, depth };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        subId
      };
    }
  }

  private async executeCallParallel(
    args: Record<string, unknown>,
    session: Session,
    from: string
  ): Promise<ToolCallResult> {
    if (!this.rlmEnabled) {
      this.logger.warn('Attempted to use call_parallel tool while RLM is disabled.');
      return { error: 'RLM is disabled. The call_parallel tool cannot be used.' };
    }

    const tasks = args.tasks as Array<{ task: string; summary?: string; schema?: Record<string, unknown> }>;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { error: 'Invalid tasks argument' };
    }

    // Check depth
    const depth = session.depth + 1;
    if (depth > this.maxDepth) {
      throw new MaxDepthExceededError(this.maxDepth, depth);
    }

    // Check budget for all tasks
    let totalEstCost = 0;
    for (const t of tasks) {
      const baseEst = ((t.task.length + (t.summary?.length ?? 0)) / 4000) * 0.0005;
      totalEstCost += baseEst * 3;
    }

    if (session.estCostUSD + totalEstCost > this.budgetUSD * 0.8) {
      throw new BudgetExceededError(this.budgetUSD, session.estCostUSD);
    }

    if (session.callCount + tasks.length > this.maxCalls) {
      return { error: `Max calls exceeded. Can only call ${this.maxCalls - session.callCount} more tasks.` };
    }

    // Execute in parallel (start all, then wait for all)
    // We reuse logic from executeCall but we want to parallelize sending and waiting

    // First, start all subtasks
    const promises = tasks.map(async (t) => {
      // Logic duplicated from executeCall but without the budget check which we did already
      // And we need to be careful about session updates being atomic or at least consistent
      // JS is single threaded so synchronous updates are fine

      session.callCount++;
      // We already checked budget, just update it roughly
      const baseEst = ((t.task.length + (t.summary?.length ?? 0)) / 4000) * 0.0005;
      session.estCostUSD += baseEst * 3;

      const subId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      session.subTasks[subId] = {
        createdAt: Date.now(),
        task: t.task,
        schema: t.schema,
        arrived: false,
        resolve: undefined,
        reject: undefined
      };

      const payload = JSON.stringify({
        type: 'subtask',
        parentPubkey: from,
        subId,
        task: t.task,
        contextSummary: t.summary ?? '',
        schema: t.schema,
        depth,
        rootId: session.rootId,
        parentId: session.id
      });

      await this.channel.send(this.channel.identity.publicKey, payload);

      // Wait for result
      try {
        const result = await this.waitForSubtaskResult(subId, session);
        return { status: 'completed', result, subId, task: t.task };
      } catch (error) {
        return {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          subId,
          task: t.task
        };
      }
    });

    await this.store.save?.();

    const results = await Promise.all(promises);
    // Explicitly return a ToolCallResult compatible object (Record<string, unknown>)
    return { status: 'completed', results: results as unknown as Record<string, unknown> };
  }

  private async waitForSubtaskResult(
    subId: string,
    session: Session,
    timeoutMs: number = this.timeoutMs
  ): Promise<string> {
    const sub = session.subTasks[subId];
    if (!sub) {
      throw new Error(`Subtask ${subId} not found`);
    }

    if (sub.arrived) {
      if (sub.error) throw new Error(sub.error);
      return sub.result!;
    }

    return new Promise((resolve, reject) => {
      // Store resolvers for handleSubtaskResult to call
      sub.resolve = resolve;
      sub.reject = reject;

      // Timeout
      const timer = setTimeout(() => {
        sub.arrived = true;
        sub.error = `Timeout after ${timeoutMs}ms`;
        reject(new TimeoutError(timeoutMs, `Subtask ${subId} timed out`));
      }, timeoutMs);

      // Store timer for cleanup
      sub.timer = timer;
    });
  }

  private getRLMGuide(toolNames: string[]): string {
    if (!toolNames.includes('code_exec')) {
      return '';
    }
    return `
RLM ENVIRONMENT:
- You have a persistent JavaScript sandbox via 'code_exec'.
- Use 'rlm_call(task)' to recursively call yourself. Returns the result directly (large results are handled transparently).
- Use 'rlm_call_parallel([{task: ...}, ...])' for concurrent sub-tasks.
- Use 'rlm_shared_set(key, value)', 'rlm_shared_get(key)', 'rlm_shared_increment(key, delta)', 'rlm_shared_push(key, value)' to access shared memory across the recursion tree.
- Use 'rlm_map(items, mapper)', 'rlm_filter(items, predicate)', 'rlm_reduce(items, reducer, initial)' for functional operations over sub-agents.
- Use 'rlm_trace()' to inspect the call stack.
- Use 'load_context(id)' to retrieve specific memories by ID.
- Console logs (console.log) are captured and returned to you for debugging.
`;
  }

  private buildSystemPrompt(depth: number): string {
    const toolNames = Array.from(this.tools.keys())
      .filter(name => {
        const tool = this.tools.get(name);
        return tool && (tool.maxDepth ?? Infinity) >= depth;
      });
    
    if (this.rlmEnabled && depth < this.maxDepth) {
      toolNames.push('call');
    }
    
    const toolNamesStr = toolNames.join(', ');

    // Inject RLM Environment Guide if code_exec is available
    const rlmGuide = this.getRLMGuide(toolNames);

    let template = this.systemPromptTemplate;
    if (!template) {
        // Fallback if loadSystemPrompt failed or hasn't run
        template = `You are VoltClaw (depth {depth}/{maxDepth}).
A recursive autonomous coding agent.

OBJECTIVE:
You solve complex tasks by breaking them down into smaller subtasks and calling new instances of yourself using the 'call' tool.
You also have access to file system tools to read, write, and list files. Use these to manipulate code and data directly.

RECURSION STRATEGY:
1. Analyze the request. Is it simple? Solve it directly.
2. Is it complex? Break it down.
3. Use 'call' to spawn a sub-agent for each sub-task.
4. Combine the results.

TOOLS:
{tools}
{rlmGuide}
CONSTRAINTS:
- Budget: {budget}
- Max Depth: {maxDepth}
- Current Depth: {depth}
{depthWarning}

You are persistent, efficient, and recursive.`;
    } else if (!template.includes('{rlmGuide}')) {
        // Append guide if placeholder is missing in custom template
        template += '\n{rlmGuide}';
    }

    const depthWarning = depth >= this.maxDepth - 1
        ? '- WARNING: MAX DEPTH REACHED. DO NOT CALL. SOLVE DIRECTLY.'
        : '';

    return template
        .replace('{depth}', String(depth))
        .replace('{maxDepth}', String(this.maxDepth))
        .replace('{budget}', String(this.budgetUSD))
        .replace('{tools}', toolNamesStr)
        .replace('{rlmGuide}', rlmGuide)
        .replace('{depthWarning}', depthWarning)
        + this.workspaceContext;
  }

  private getRole(pubkey: string): Role {
    if (this.channel.identity.publicKey === pubkey) {
      return 'admin'; // Self is always admin
    }
    if (this.permissions.admins?.includes(pubkey)) {
      return 'admin';
    }
    if (this.permissions.agents?.includes(pubkey)) {
      return 'agent';
    }
    if (this.permissions.users?.includes(pubkey)) {
      return 'user';
    }

    return 'user'; // Default role
  }

  private checkPermission(tool: Tool, role: Role): boolean {
    if (role === 'admin') return true;

    // If tool specifies required roles, strictly enforce them
    if (tool.requiredRoles && tool.requiredRoles.length > 0) {
      return tool.requiredRoles.includes(role);
    }

    // If no specific roles required, fall back to global policy
    // 'allow_all' (default) means anyone can use tools that don't have specific requirements
    if (this.permissions.policy === 'deny_all') {
      return false;
    }

    return true;
  }

  private getToolDefinitions(depth: number): Array<{ name: string; description: string; parameters?: import('./types.js').ToolParameters }> {
    const definitions: Array<{ name: string; description: string; parameters?: import('./types.js').ToolParameters }> = 
      Array.from(this.tools.entries())
        .filter(([_, tool]) => (tool.maxDepth ?? Infinity) >= depth)
        .map(([name, tool]) => ({ name, description: tool.description, parameters: tool.parameters }));
    
    if (this.rlmEnabled && depth < this.maxDepth) {
      definitions.push({
        name: 'call',
        description: 'Call a child agent to handle a sub-task. Use for complex tasks that can be parallelized or decomposed.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The specific task to call the child agent with' },
            summary: { type: 'string', description: 'Optional context summary for the child agent' }
          },
          required: ['task']
        }
      });
      definitions.push({
        name: 'call_parallel',
        description: 'Call multiple independent tasks in parallel. Use when subtasks do not depend on each other.',
        parameters: {
          type: 'object',
          properties: {
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task: { type: 'string' },
                  summary: { type: 'string' }
                },
                required: ['task']
              },
              description: 'List of tasks to call in parallel (max 10)'
            }
          },
          required: ['tasks']
        }
      });
    }
    
    return definitions;
  }

  private pruneHistory(session: Session): void {
    if (session.history.length > this.maxHistory) {
      session.history = session.history.slice(-this.maxHistory);
    }
  }

  private async pruneAllSessions(): Promise<void> {
    const sessions = await this.store.getAll?.() ?? {};
    for (const session of Object.values(sessions)) {
      this.pruneHistory(session);
    }
    await this.store.save?.();
  }

  on<K extends keyof import('./types.js').EventMap>(
    event: K,
    handler: (...args: import('./types.js').EventMap[K]) => void
  ): Unsubscribe {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    const handlers = this.eventHandlers.get(event)!;
    handlers.add(handler as (...args: unknown[]) => void);
    return () => {
      handlers.delete(handler as (...args: unknown[]) => void);
    };
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }

  static builder(): VoltClawAgentBuilder {
    return new VoltClawAgentBuilder();
  }
}

class VoltClawAgentBuilder {
  private options: VoltClawAgentOptions = {};

  withLLM(llm: LLMProvider | LLMConfig | ((b: LLMBuilder) => LLMBuilder)): this {
    if (typeof llm === 'function') {
      this.options.llm = llm(new LLMBuilder()).build();
    } else {
      this.options.llm = llm;
    }
    return this;
  }

  withChannel(channel: Channel | ChannelConfig | ((b: ChannelBuilder) => ChannelBuilder)): this {
    if (typeof channel === 'function') {
      this.options.channel = channel(new ChannelBuilder()).build();
    } else {
      this.options.channel = channel;
    }
    return this;
  }

  // Deprecated alias
  withTransport(transport: Channel | ChannelConfig | ((b: ChannelBuilder) => ChannelBuilder)): this {
    return this.withChannel(transport);
  }

  withPersistence(store: Store): this {
    this.options.persistence = store;
    return this;
  }

  withCall(config: CallBuilder | ((b: CallBuilder) => CallBuilder)): this {
    const builder = typeof config === 'function' ? config(new CallBuilder()) : config;
    this.options.call = builder.build();
    return this;
  }

  withHooks(hooks: import('./types.js').HooksConfig): this {
    this.options.hooks = hooks;
    return this;
  }

  use(middleware: Middleware): this {
    this.options.middleware = [...(this.options.middleware ?? []), middleware];
    return this;
  }

  build(): VoltClawAgent {
    return new VoltClawAgent(this.options);
  }
}

class LLMBuilder {
  private config: Partial<import('./types.js').LLMConfig> = {};

  ollama(): this {
    this.config.provider = 'ollama';
    return this;
  }

  openai(): this {
    this.config.provider = 'openai';
    return this;
  }

  anthropic(): this {
    this.config.provider = 'anthropic';
    return this;
  }

  model(model: string): this {
    this.config.model = model;
    return this;
  }

  baseUrl(url: string): this {
    this.config.baseUrl = url;
    return this;
  }

  rateLimit(maxPerMinute: number): this {
    this.config.rateLimit = { maxPerMinute };
    return this;
  }

  build(): import('./types.js').LLMConfig {
    if (!this.config.provider || !this.config.model) {
      throw new ConfigurationError('LLM provider and model are required');
    }
    return this.config as import('./types.js').LLMConfig;
  }
}

class ChannelBuilder {
  private config: Partial<import('./types.js').ChannelConfig> = {};

  nostr(): this {
    this.config.type = 'nostr';
    return this;
  }

  websocket(): this {
    this.config.type = 'websocket';
    return this;
  }

  stdio(): this {
    this.config.type = 'stdio';
    return this;
  }

  memory(): this {
    this.config.type = 'memory';
    return this;
  }

  relays(...relays: string[]): this {
    this.config.relays = relays;
    return this;
  }

  privateKey(key: string): this {
    this.config.privateKey = key;
    return this;
  }

  build(): import('./types.js').ChannelConfig {
    if (!this.config.type) {
      throw new ConfigurationError('Channel type is required');
    }
    return this.config as import('./types.js').ChannelConfig;
  }
}

// Deprecated alias
class TransportBuilder extends ChannelBuilder {}

class CallBuilder {
  private config: import('./types.js').CallConfig = {};

  maxDepth(depth: number): this {
    this.config.maxDepth = depth;
    return this;
  }

  maxCalls(calls: number): this {
    this.config.maxCalls = calls;
    return this;
  }

  budget(usd: number): this {
    this.config.budgetUSD = usd;
    return this;
  }

  timeout(ms: number): this {
    this.config.timeoutMs = ms;
    return this;
  }

  largeResultThreshold(chars: number): this {
    this.config.largeResultThreshold = chars;
    return this;
  }

  build(): import('./types.js').CallConfig {
    return this.config;
  }
}

/**
 * @deprecated Use Retrier class instead
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number }
): Promise<T> {
  const retrier = new Retrier({
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    jitterFactor: 0
  });
  return retrier.execute(fn);
}

export { withRetry };
