
import { test, expect } from 'vitest';
import { VoltClawAgent } from '../../src/core/agent.js';
import { MockLLM } from '../../src/testing/mock-llm.js';
import fs from 'fs';
import path from 'path';

test('Integration: Sub-agent receives full RLM prompt', async () => {
  const mockLLM = new MockLLM();
  let capturedMessages: any[] = [];

  // Intercept chat calls
  mockLLM.chat = async (messages: any[], options?: any) => {
    // Only capture subtask messages
    const userMsg = messages.find((m: any) => m.role === 'user');
    if (userMsg && userMsg.content.includes('Task: Calculate Fibonacci recursively')) {
        capturedMessages = messages;
    }
    return {
      content: 'OK',
      toolCalls: []
    };
  };

  // Temp file for store
  const storePath = path.join('/tmp', `rlm-test-${Date.now()}.json`);

  const agent = new VoltClawAgent({
    llm: mockLLM,
    channel: {
        type: 'memory',
        subscribe: () => () => {},
        send: async () => {},
        start: async () => {},
        stop: async () => {},
        identity: { publicKey: 'self' }
    } as any,
    persistence: {
        type: 'file',
        path: storePath
    } as any,
    // Enable RLM to auto-register code_exec
    rlm: { enabled: true, rlmTimeoutMs: 1000 }
  });

  await agent.start();

  const subtaskMsg = JSON.stringify({
      type: 'subtask',
      subId: 'test-rlm-1',
      task: 'Calculate Fibonacci recursively',
      depth: 1,
      parentPubkey: 'self',
      contextSummary: 'Use RLM.'
  });

  // Trigger subtask handling
  // @ts-ignore
  await agent.handleMessage('self', subtaskMsg, {});

  await agent.stop();
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);

  // Assertions
  const systemMsg = capturedMessages.find((m: any) => m.role === 'system');
  const userMsg = capturedMessages.find((m: any) => m.role === 'user');

  expect(systemMsg).toBeDefined();
  expect(userMsg).toBeDefined();

  // Check System Prompt content
  expect(systemMsg.content).toContain('You are VoltClaw');
  expect(systemMsg.content).toContain('RLM ENVIRONMENT:');
  expect(systemMsg.content).toContain("Use 'rlm_call(task)'");
  // Check that new globals are present
  expect(systemMsg.content).toContain("rlm_map");
  expect(systemMsg.content).toContain("rlm_filter");
  expect(systemMsg.content).toContain("rlm_reduce");
  expect(systemMsg.content).toContain("rlm_shared_increment");

  // Check User Prompt content
  expect(userMsg.content).toContain('Task: Calculate Fibonacci recursively');
  expect(userMsg.content).toContain('Parent context: Use RLM.');
});
