
import { test, expect } from 'vitest';
import { VoltClawAgent } from '../../src/core/agent.js';
import { codeExecTool } from '../../src/tools/code_exec.js';
import { MockLLM } from '../../src/testing/mock-llm.js';
import fs from 'fs';
import path from 'path';

class LoopbackChannel {
    public readonly type = 'memory';
    public readonly identity = { publicKey: 'self' };
    private handlers: ((to: string, content: string, meta: any) => void)[] = [];

    async start() {}
    async stop() {}
    async send(to: string, content: string) {
        // Simple loopback
        const meta = { timestamp: Date.now() };
        // Simulate async network delay
        setTimeout(() => {
            for (const h of this.handlers) {
                h(to, content, meta);
            }
        }, 10);
    }
    subscribe(handler: any) {
        this.handlers.push(handler);
        return () => {};
    }
}

test('Integration: RLM shared primitives execution', async () => {
  const storePath = path.join('/tmp', `rlm-exec-${Date.now()}.json`);

  const mockLLM = new MockLLM();
  mockLLM.chat = async (messages: any[]) => {
    const last = messages[messages.length - 1];

    // Parent: executes code
    if (last.role === 'user' && last.content.includes('Execute shared increment')) {
        return {
            content: "Executing...",
            toolCalls: [{
                id: 'exec1',
                name: 'code_exec',
                arguments: {
                    code: `
                        (async () => {
                            await rlm_shared_set('counter', 10);
                            await rlm_shared_increment('counter', 5);
                            const val = await rlm_shared_get('counter');
                            return val;
                        })()
                    `
                }
            }]
        };
    }

    // Tool result
    if (last.role === 'tool') {
        const res = JSON.parse(last.content);
        if (res.output !== undefined) {
             return { content: `Result: ${res.output}` };
        }
    }

    return { content: "Thinking... MSG: " + JSON.stringify(last) };
  };

  const agent = new VoltClawAgent({
    llm: mockLLM,
    channel: new LoopbackChannel() as any,
    persistence: {
        type: 'file',
        path: storePath
    } as any,
    tools: [codeExecTool],
    rlm: { enabled: true, rlmTimeoutMs: 5000 }
  });

  await agent.start();

  const response = await agent.query("Execute shared increment");

  expect(response).toBe("Result: 15");

  await agent.stop();
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
}, 20000);

test('Integration: RLM map execution', async () => {
  const storePath = path.join('/tmp', `rlm-map-${Date.now()}.json`);

  const mockLLM = new MockLLM();
  mockLLM.chat = async (messages: any[]) => {
    const last = messages[messages.length - 1];

    // Parent: executes map
    if (last.role === 'user' && last.content.includes('Execute map')) {
        return {
            content: "Executing map...",
            toolCalls: [{
                id: 'exec_map',
                name: 'code_exec',
                arguments: {
                    code: `
                        (async () => {
                            const results = await rlm_map([1, 2], (num) => ({
                                task: 'Square ' + num
                            }));
                            // results is array of { ..., result: "..." }
                            return results.map(r => r.result).join(',');
                        })()
                    `,
                    sessionId: 'test2-session'
                }
            }]
        };
    }

    // Subtask 1
    if (last.role === 'user' && last.content.includes('Square 1')) {
        return { content: "1" };
    }

    // Subtask 2
    if (last.role === 'user' && last.content.includes('Square 2')) {
        return { content: "4" };
    }

    // Parent receives result
    if (last.role === 'tool') {
        const res = JSON.parse(last.content);
        if (res.output !== undefined) {
             return { content: `Result: ${res.output}` };
        }
    }

    return { content: "Thinking..." };
  };

  const agent = new VoltClawAgent({
    llm: mockLLM,
    channel: new LoopbackChannel() as any,
    persistence: {
        type: 'file',
        path: storePath
    } as any,
    tools: [codeExecTool],
    rlm: { enabled: true, rlmTimeoutMs: 5000 }
  });

  await agent.start();

  const response = await agent.query("Execute map");

  expect(response).toBe("Result: 1,4");

  await agent.stop();
  if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
}, 20000);
