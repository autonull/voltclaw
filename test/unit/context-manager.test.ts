import { describe, it, expect } from 'vitest';
import { ContextManager } from '../../src/core/context-manager.js';
import type { LLMProvider, ChatMessage } from '../../src/core/types.js';

describe('ContextManager', () => {
  const mockLLM: LLMProvider = {
    name: 'mock',
    model: 'mock',
    chat: async () => ({
      content: 'This is a summary.'
    })
  };

  it('should return original messages if count <= maxMessages', async () => {
    const manager = new ContextManager(mockLLM, { maxMessages: 5 });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' }
    ];

    const result = await manager.manageContext(messages);
    expect(result).toHaveLength(3);
    expect(result).toEqual(messages);
  });

  it('should summarize older messages if count > maxMessages', async () => {
    const manager = new ContextManager(mockLLM, { maxMessages: 4, preserveLast: 2, lcmEnabled: true });
    // Total 6 messages (1 system + 5 chat)
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '1' },
      { role: 'assistant', content: '2' },
      { role: 'user', content: '3' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: '5' }
    ];

    const result = await manager.manageContext(messages);

    // Expected:
    // 1. System prompt
    // 2. Summary message
    // 3. Last 2 messages ('4', '5')
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('sys');

    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('Previous conversation summary');

    expect(result[2].content).toBe('4');
    expect(result[3].content).toBe('5');
  });

  it('should not summarize if only system messages exceed limit (edge case)', async () => {
    const manager = new ContextManager(mockLLM, { maxMessages: 2 });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys1' },
      { role: 'system', content: 'sys2' },
      { role: 'system', content: 'sys3' }
    ];

    const result = await manager.manageContext(messages);
    // Should return original because filtering non-system yields 0, which is <= maxMessages
    expect(result).toHaveLength(3);
  });
});
