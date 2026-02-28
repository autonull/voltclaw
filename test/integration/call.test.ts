import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoltClawAgent } from '../../src/core/agent.js';
import { createCallTool } from '../../src/tools/call.js';
import { createCodeExecTool } from '../../src/tools/code_exec.js';
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

describe('Call Integration', () => {
    const storePath = path.join(process.cwd(), 'test-call.json');
    let agent: VoltClawAgent;

    beforeEach(() => {
        if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    });

    afterEach(async () => {
        if (agent) await agent.stop();
        if (fs.existsSync(storePath)) fs.unlinkSync(storePath);
    });

    it('calls sub-agent task and returns result', async () => {
        const mockLLM = new MockLLM({
            handler: async (messages) => {
                const last = messages[messages.length - 1];
                const system = messages.find(m => m.role === 'system')?.content || '';

                if (last.role === 'user' && last.content?.includes('Perform subtask')) {
                    return {
                        content: "Calling subtask...",
                        toolCalls: [{
                            id: 'call1',
                            name: 'call',
                            arguments: {
                                task: 'Say Hello',
                                summary: 'Just say hello'
                            }
                        }]
                    };
                }

                if (system.includes('Depth: 1')) {
                    return { content: 'Hello from sub-agent!' };
                }

                if (last.role === 'tool') {
                    if (last.content?.includes('Hello from sub-agent!')) {
                        return { content: "Subtask complete: " + last.content };
                    } else {
                        // Debug logging
                        console.log('Tool content mismatch:', last.content);
                    }
                }

                return { content: "Thinking..." };
            }
        });

        agent = new VoltClawAgent({
            llm: mockLLM,
            channel: new MockChannel(),
            persistence: new FileStore({ path: storePath }),
            rlm: { enabled: true },
            tools: [
                createCallTool({
                    onCall: async () => ({}), // Handled by agent
                    currentDepth: 0,
                    maxDepth: 4
                })
            ],
            call: {
                maxDepth: 4,
                timeoutMs: 2000
            }
        });

        await agent.start();
        const response = await agent.query("Perform subtask");
        expect(response).toContain("Subtask complete");
    });

    it('sub-agent performs multi-step task with tool use', async () => {
        let childCalls = 0;
        const mockLLM = new MockLLM({
            handler: async (messages) => {
                const last = messages[messages.length - 1];
                const system = messages.find(m => m.role === 'system')?.content || '';

                // Parent
                if (last.role === 'user' && last.content?.includes('Complex subtask')) {
                    return {
                        content: "Delegating...",
                        toolCalls: [{
                            id: 'call1',
                            name: 'call',
                            arguments: { task: 'Calculate 1+1 using code' }
                        }]
                    };
                }

                // Child (Turn 1): Decides to use code_exec
                if (system.includes('Depth: 1') && last.role === 'user' && last.content.includes('Task:')) {
                    childCalls++;
                    return {
                        content: "I will calculate it.",
                        toolCalls: [{
                            id: 'child_tool1',
                            name: 'code_exec',
                            arguments: { code: '1 + 1' }
                        }]
                    };
                }

                // Child (Turn 2): Receives result
                if (system.includes('Depth: 1') && last.role === 'tool') {
                    childCalls++;
                    return { content: "The answer is 2." };
                }

                // Parent: Receives final answer from subtask
                if (system.includes('Depth: 0') && last.role === 'tool') {
                    if (last.content?.includes('The answer is 2.')) {
                        return { content: "Final result: 2" };
                    } else {
                        console.log('Tool content mismatch (multi):', last.content);
                    }
                }

                return { content: "Thinking..." };
            }
        });

        agent = new VoltClawAgent({
            llm: mockLLM,
            channel: new MockChannel(),
            persistence: new FileStore({ path: storePath }),
            rlm: { enabled: true },
            tools: [
                createCallTool({ onCall: async () => ({}), currentDepth: 0, maxDepth: 4 }),
                createCodeExecTool()
            ],
            call: { maxDepth: 4, timeoutMs: 5000 }
        });

        await agent.start();
        const response = await agent.query("Complex subtask");
        expect(response).toBe("Final result: 2");
        expect(childCalls).toBeGreaterThanOrEqual(2);
    });
});
