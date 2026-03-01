import { BaseLLMProvider } from './provider.js';
import type {
  ChatMessage,
  ChatResponse,
  ChatOptions,
  ToolCall,
  LLMProviderConfig,
  ChatChunk
} from './types.js';

interface OpenAIResponse {
  choices: Array<{
    message?: {
      content?: string;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export class OpenAIProvider extends BaseLLMProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly supportsTools = true;
  
  private baseUrl: string;
  private apiKey: string;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com/v1';
    this.apiKey = config.apiKey ?? '';
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required');
    }
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk> {
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
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      stream: true
    };

    if (toolDefs && toolDefs.length > 0) {
      body['tools'] = toolDefs;
    }

    if (options?.stopSequences) {
      body['stop'] = options.stopSequences;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unable to read error');
        throw new Error(`OpenAI stream error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const toolCallBuffer: Record<number, { id?: string; name?: string; arguments: string }> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') continue;
        if (line.trim() === 'data: [DONE]') return;
        if (!line.startsWith('data: ')) continue;

        const dataStr = line.slice(6);
        try {
            const data = JSON.parse(dataStr);
            const choice = data.choices[0];
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (!choice) continue;

            const delta = choice.delta;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (delta.content) {
                yield { content: delta.content };
            }

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const index = tc.index;
                    if (!toolCallBuffer[index]) {
                        toolCallBuffer[index] = { arguments: '' };
                    }
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                    if (tc.id) toolCallBuffer[index].id = tc.id;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                    if (tc.function?.name) toolCallBuffer[index].name = tc.function.name;
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                    if (tc.function?.arguments) toolCallBuffer[index].arguments += tc.function.arguments;
                }
            }

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (choice.finish_reason === 'tool_calls' || (choice.finish_reason && Object.keys(toolCallBuffer).length > 0)) {
                for (const index of Object.keys(toolCallBuffer)) {
                    const buffered = toolCallBuffer[Number(index)];

// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
                    if (buffered && buffered.id && buffered.name) {
                         try {
                             yield {
                                 toolCalls: {
                                     id: buffered.id,
                                     name: buffered.name,
                                     arguments: JSON.parse(buffered.arguments)
                                 }
                             };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
                         } catch (e) {
                             // Ignore
                         }
                    }
                }
            }
// eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (e) {
            // Ignore
        }
      }
    }
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
      temperature: options?.temperature,
      max_tokens: options?.maxTokens
    };

    if (toolDefs && toolDefs.length > 0) {
      body['tools'] = toolDefs;
    }

    if (options?.stopSequences) {
      body['stop'] = options.stopSequences;
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error');
      throw new Error(`OpenAI error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as OpenAIResponse;

    const choice = data.choices[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    const result: ChatResponse = {
      content: choice.message?.content ?? ''
    };
    
    if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
      result.toolCalls = choice.message.tool_calls.map(tc => this.parseToolCall(tc));
    }
    
    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      };
    }
    
    return result;
  }

  private formatMessage(msg: ChatMessage): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      role: msg.role === 'tool' ? 'tool' : msg.role,
      content: msg.content
    };
    
    if (msg.toolCalls) {
      formatted['tool_calls'] = msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments)
        }
      }));
    }
    
// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (msg.toolCallId) {
      formatted['tool_call_id'] = msg.toolCallId;
    }
    
    return formatted;
  }

  private parseToolCall(tc: OpenAIToolCall): ToolCall {
    return {
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    };
  }

  async embed(text: string): Promise<number[]> {
    const body: Record<string, unknown> = {
      model: this.model.startsWith('gpt-') ? 'text-embedding-3-small' : this.model,
      input: text
    };

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`OpenAI embedding error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { data: [{ embedding: number[] }] };
    return data.data[0].embedding;
  }
}
