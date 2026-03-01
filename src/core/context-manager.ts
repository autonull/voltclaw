import type { LLMProvider, ChatMessage } from './types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { GraphManager } from '../memory/graph.js';

export interface ContextManagerOptions {
  maxMessages?: number;
  preserveLast?: number;
  memory?: MemoryManager;
  graph?: GraphManager;
  lcmEnabled?: boolean;
}

export class ContextManager {
  private readonly llm: LLMProvider;
  private readonly maxMessages: number;
  private readonly preserveLast: number;
  private readonly memory?: MemoryManager;
  private readonly graph?: GraphManager;
  private readonly lcmEnabled: boolean;

  constructor(llm: LLMProvider, options: ContextManagerOptions = {}) {
    this.llm = llm;
    this.maxMessages = options.maxMessages ?? 50;
    this.preserveLast = options.preserveLast ?? 20;
    this.memory = options.memory;
    this.graph = options.graph;
    this.lcmEnabled = options.lcmEnabled ?? false;
  }

  async manageContext(messages: ChatMessage[]): Promise<ChatMessage[]> {
    // console.debug(`manageContext: total=${messages.length}, max=${this.maxMessages}`);
    if (messages.length <= this.maxMessages) {
      return messages;
    }

    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    if (nonSystemMessages.length <= this.maxMessages) {
      return messages;
    }

    const toSummarize = nonSystemMessages.slice(0, nonSystemMessages.length - this.preserveLast);
    const toKeep = nonSystemMessages.slice(nonSystemMessages.length - this.preserveLast);

    if (toSummarize.length === 0) {
      return messages;
    }

    if (!this.lcmEnabled) {
      // If LCM is disabled, simply truncate the older messages (lossy context)
      return [...systemMessages, ...toKeep];
    }

    // LCM Enabled: Offload to long-term memory/graph before summarizing
    const textToOffload = toSummarize
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      .map(m => `${m.role.toUpperCase()}: ${m.content || '[tool call]'}`)
      .join('\n');

    if (this.graph) {
        // We do this optimistically without awaiting to block execution minimally
        // console.debug('Offloading to graph:', textToOffload.slice(0, 50));
        this.graph.extractAndStore(textToOffload).catch(e => console.error('Graph offload failed:', e));
    } else if (this.memory) {
        this.memory.storeMemory(textToOffload, 'episodic', ['conversation_history'], 3).catch(e => console.error('Memory offload failed:', e));
    }

    const summary = await this.summarize(toSummarize);

    const summaryMessage: ChatMessage = {
      role: 'system',
      content: `Previous conversation summary:\n${summary}`
    };

    return [...systemMessages, summaryMessage, ...toKeep];
  }

  private async summarize(messages: ChatMessage[]): Promise<string> {
    const text = messages
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      .map(m => `${m.role.toUpperCase()}: ${m.content || '[tool call]'}`)
      .join('\n');

    const prompt = `Summarize the following conversation history concisely, capturing key decisions, tool outputs, and user requests. Focus on what is relevant for future actions.\n\n${text}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: prompt }
      ]);
      return response.content;
    } catch (error) {
      console.warn('Context summarization failed, returning truncated history instead.', error);
      return '[Summary generation failed]';
    }
  }
}
