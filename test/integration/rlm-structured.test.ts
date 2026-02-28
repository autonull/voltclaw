import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoltClawAgent } from '../../src/core/agent.js';
import { codeExecTool } from '../../src/tools/code_exec.js';
import { createCallTool } from '../../src/tools/call.js';
import { MockLLM } from '../../src/testing/mock-llm.js';
import { FileStore } from '../../src/memory/file-store.js';
import path from 'path';
import fs from 'fs';
import type { Channel, MessageHandler, Unsubscribe } from '../../src/core/types.js';

class MockChannel implements Channel {
    readonly type = 'mock';
    readonly identity = { publicKey: 'mock-pubkey' };
    private handlers: MessageHandler[] = [];

    async start() {}
    async stop() {}
    async send(to: string, content: string) {
        if (to === this.identity.publicKey) {
             const meta = { timestamp: Date.now() };
             setTimeout(() => {
                 for (const h of this.handlers) h(to, content, meta);
             }, 0);
        }
    }
    subscribe(handler: MessageHandler): Unsubscribe {
        this.handlers.push(handler);
        return () => {};
    }
    on() {}
}

describe('RLM Structured Integration', () => {
    const storePath = path.join(process.cwd(), 'test-rlm-struct.json');
    let agent: VoltClawAgent;

    beforeEach(() => {
        if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    });

    afterEach(async () => {
        if (agent) await agent.stop();
        if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    });

    it('should parse JSON from rlm_call automatically', async () => {
        const mockLLM = new MockLLM({
            handler: async (messages) => {
                const last = messages[messages.length - 1];
                const system = messages.find(m => m.role === 'system')?.content || '';

                // 1. Parent Agent: receives user query "Start RLM"
                if (last.role === 'user' && last.content?.includes('Start RLM')) {
                    return {
                        content: "Starting RLM...",
                        toolCalls: [{
                            id: 'call1',
                            name: 'code_exec',
                            arguments: {
                                code: `
                                    (async () => {
                                        try {
                                            const result = await rlm_call('subtask');
                                            return result.foo;
                                        } catch (e) { return 'error: ' + e.message; }
                                    })()
                                `,
                                sessionId: 'parent-session'
                            }
                        }]
                    };
                }

                // 2. Child Agent: receives subtask
                if (system.includes('Depth: 1')) {
                    return { content: '{"foo": "bar", "num": 123}' };
                }

                // 3. Parent Agent: receives result from code_exec
                if (last.role === 'tool') {
                    if (last.content?.includes('"output":"bar"')) {
                        return { content: "Final Answer: bar" };
                    }
                }

                return { content: "Thinking..." };
            }
        });

        agent = new VoltClawAgent({
            llm: mockLLM,
            channel: new MockChannel(),
            persistence: new FileStore({ path: storePath }),
            tools: [codeExecTool],
            rlm: { enabled: true },
            call: {
                maxDepth: 4,
                timeoutMs: 5000
            }
        });

        await agent.start();
        const response = await agent.query("Start RLM");

        expect(response).toBe("Final Answer: bar");
    }, 10000);
});
