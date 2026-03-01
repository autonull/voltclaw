import { BaseLLMProvider } from './provider.js';
import type {
  ChatMessage,
  ChatResponse,
  ChatOptions,
  LLMProviderConfig,
  ChatChunk
} from './types.js';

interface OllamaToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: string | Record<string, unknown>;
  };
}

interface OllamaResponse {
  message?: {
    content?: string;
    tool_calls?: OllamaToolCall[];
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  content?: string;
  tool_calls?: OllamaToolCall[];
}

export class OllamaProvider extends BaseLLMProvider {
  readonly name = 'ollama';
  readonly model: string;
  readonly supportsTools = true;
  
  private baseUrl: string;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    await this.checkRateLimit();

    const toolDefs = options?.tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters ?? { type: 'object' as const, properties: {} }
      }
    }));

    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => this.formatMessage(m)),
      stream: false,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens
      }
    };

    if (toolDefs && toolDefs.length > 0) {
      body['tools'] = toolDefs;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      
      if (errorText.includes('does not support tools')) {
        return this.chatWithoutTools(messages, options);
      }
      
      throw new Error(`Ollama error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as OllamaResponse;
    const message = data.message ?? { content: data.content, tool_calls: data.tool_calls };
    
    const result: ChatResponse = {
      content: message.content ?? ''
    };
    
    if (message.tool_calls && message.tool_calls.length > 0) {
      result.toolCalls = message.tool_calls.map(tc => this.parseToolCall(tc));
    }
    
    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0
      };
    }
    
    return result;
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => this.formatMessage(m)),
      stream: true,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens
      }
    };

    if (options?.tools && options.tools.length > 0) {
      body['tools'] = options.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters ?? { type: 'object' as const, properties: {} }
        }
      }));
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Ollama stream error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line) as OllamaResponse & { done?: boolean };

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
          if (data.done) {
            yield { done: true };
            return;
          }

          const message = data.message;
          if (message) {
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (message.content) {
              yield { content: message.content };
            }
            if (message.tool_calls) {
                for (const tc of message.tool_calls) {
                    yield {
                        toolCalls: this.parseToolCall(tc)
                    };
                }
            }
          }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
          // ignore
        }
      }
    }
  }

  private async chatWithoutTools(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map(m => this.formatMessage(m)),
      stream: false,
      options: {
        temperature: options?.temperature,
        num_predict: options?.maxTokens
      }
    };

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as OllamaResponse;
    const message = data.message ?? { content: data.content };
    
    const result: ChatResponse = {
      content: message.content ?? ''
    };
    
    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0
      };
    }
    
    return result;
  }

  private formatMessage(msg: ChatMessage): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      role: msg.role,
      content: msg.content ?? ''
    };
    
    if (msg.toolCalls) {
      formatted['tool_calls'] = msg.toolCalls.map(tc => ({
        function: {
          name: tc.name,
          arguments: tc.arguments
        }
      }));
    }
    
    // Ollama typically handles tool results as role: 'tool' content
    // But some versions might look for tool_call_id linkage differently.
    // For now, standard chat APIs usually just need role: tool.
    
    return formatted;
  }

  private parseToolCall(tc: OllamaToolCall): { id: string; name: string; arguments: Record<string, unknown> } {
    return {
      id: tc.id ?? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: tc.function?.name ?? '',
      arguments: typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function?.arguments ?? {}
    };
  }

  async embed(text: string): Promise<number[]> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: text
    };

    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`Ollama embedding error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }
}
